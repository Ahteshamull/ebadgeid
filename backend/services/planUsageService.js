// services/planUsageService.js
//
// One source of truth for "what plan does this organization have, and how
// much of it has it used". Both the Admin dashboard (own organization)
// and the Super Admin dashboard (any organization, and the consolidated
// list) read the SAME function here, so the two can never drift apart or
// disagree about a number -- which is the whole point of centralizing it
// instead of computing usage separately in each caller, let alone in the
// browser.
//
// Every figure is derived the same way middleware/enforcePlanLimits.js
// derives it when it actually blocks a request. That matters: a dashboard
// that computes "credentials used" differently from the code that
// enforces the limit will eventually tell a customer they have room left
// while the API refuses them. These deliberately share the definition:
//   - users        -> Users.countDocuments({ organization_code })
//   - credentials  -> Credential.countDocuments since the 1st of the month
//   - api calls    -> UsageCounter for the "YYYY-MM" period
//
// A note on what is NOT here, on purpose: this product's plans define
// exactly three limits (max_users, max_credentials_per_month,
// max_api_calls_per_month -- see models/plan_schema.js). There is no
// separate "badges" limit because in this system a badge IS a credential
// (one Credential document, one issued badge), and there is no contract
// limit at all. Contracts are therefore reported as a usage count with a
// null limit rather than being given an invented quota, and badges are
// reported as the same figure as credentials rather than a second,
// fabricated number. Inventing either would put a number on a customer's
// dashboard that nothing in the system actually enforces.
const Organization = require('../models/organization_schema');
const Plan = require('../models/plan_schema');
const Users = require('../models/user_model');
const Credential = require('../models/credentialSchema');
const UsageCounter = require('../models/usageCounter');
const DigitalContract = require('../models/digitalContract');

const UNLIMITED = -1;

// Organizations created before this schema gained `timestamps: true` have
// no createdAt at all -- confirmed against the real production data,
// where the operator's own organization predates it. Rather than show a
// dash (or worse, invent a date), fall back to the timestamp MongoDB
// already embeds in every ObjectId, which IS the document's real creation
// time. Returns null only when there is genuinely nothing to read.
const creationDate = (doc) => {
  if (doc.createdAt) return doc.createdAt;
  try {
    return doc._id?.getTimestamp ? doc._id.getTimestamp() : null;
  } catch {
    return null;
  }
};

const currentPeriod = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

// Builds one { limit, used, remaining, unlimited } block. `limit` of -1
// means the plan places no cap on this dimension; `remaining` is then
// null rather than a misleading negative or a made-up ceiling. A limit of
// null means this product defines no quota for that dimension at all --
// distinct from unlimited, and reported honestly as such.
const buildMetric = (limit, used) => {
  if (limit === null || limit === undefined) {
    return { limit: null, used, remaining: null, unlimited: false, metered: false };
  }
  if (limit === UNLIMITED) {
    return { limit: UNLIMITED, used, remaining: null, unlimited: true, metered: true };
  }
  return {
    limit,
    used,
    remaining: Math.max(0, limit - used),
    unlimited: false,
    metered: true,
    percent_used: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0,
  };
};

// Returns null when the organization does not exist, so callers can 404
// rather than guess. Throws only on a real database failure.
async function getPlanUsage(organizationCode, { now = new Date() } = {}) {
  const organization = await Organization.findOne({ organization_code: organizationCode }).lean();
  if (!organization) return null;

  const plan = await Plan.findOne({ name: organization.plan }).lean();

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  // The monthly quotas reset on the 1st -- that date IS the renewal for
  // everything this system meters, so it is reported rather than an
  // invented subscription end date (no such field exists on the
  // organization; see models/organization_schema.js).
  const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [userCount, credentialsThisMonth, credentialsTotal, contractsTotal, usageCounter] = await Promise.all([
    Users.countDocuments({ organization_code: organizationCode }),
    Credential.countDocuments({ organization_code: organizationCode, createdAt: { $gte: monthStart } }),
    Credential.countDocuments({ organization_code: organizationCode }),
    DigitalContract.countDocuments({ organization_code: organizationCode }).catch(() => 0),
    UsageCounter.findOne({ organization_code: organizationCode, period: currentPeriod(now) }).lean(),
  ]);

  return {
    organization: {
      organization_code: organization.organization_code,
      name: organization.name,
      status: organization.status,
      created_at: creationDate(organization),
    },
    plan: {
      name: organization.plan,
      // A plan name on the organization with no matching Plan document is
      // real data drift -- surfaced instead of silently showing zeroes,
      // because enforcePlanLimits fails CLOSED on the same condition and
      // the customer would be blocked with no explanation otherwise.
      configured: Boolean(plan),
      is_free: plan ? plan.is_free : null,
      price_cents: plan ? plan.price_cents : null,
      status: organization.status,
      started_at: creationDate(organization),
      // Quotas are monthly and reset on the 1st; this is the real,
      // meaningful "renews on" date for this product.
      period: currentPeriod(now),
      quota_resets_at: nextReset,
    },
    usage: {
      users: buildMetric(plan ? plan.max_users : null, userCount),
      // Badges and credentials are the same object in this product -- one
      // issued badge is one Credential document. Reported under both names
      // so each dashboard can label it the way its users speak, without
      // implying two separate quotas exist.
      credentials_this_month: buildMetric(plan ? plan.max_credentials_per_month : null, credentialsThisMonth),
      badges_this_month: buildMetric(plan ? plan.max_credentials_per_month : null, credentialsThisMonth),
      api_calls_this_month: buildMetric(plan ? plan.max_api_calls_per_month : null, usageCounter ? usageCounter.api_calls : 0),
      // No plan tier caps contracts, so this carries a null limit: a real
      // usage figure with an honest "not metered" marker, not a fake quota.
      contracts: buildMetric(null, contractsTotal),
      credentials_all_time: credentialsTotal,
    },
  };
}

// Consolidated view for the Super Admin: the same per-organization shape
// as above, for every organization, built from the same function so the
// list and the detail view can never disagree.
async function getPlanUsageForAllOrganizations({ now = new Date(), includeDeleted = false } = {}) {
  const filter = includeDeleted ? {} : { status: { $ne: 'DELETED' } };
  const organizations = await Organization.find(filter).select('organization_code').lean();
  const rows = await Promise.all(
    organizations.map(org => getPlanUsage(org.organization_code, { now })),
  );
  return rows.filter(Boolean);
}

module.exports = { getPlanUsage, getPlanUsageForAllOrganizations };
