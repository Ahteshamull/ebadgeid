const Plan = require('../models/plan_schema');
const Organization = require('../models/organization_schema');
const Users = require('../models/user_model');
const Credential = require('../models/credentialSchema');
const UsageCounter = require('../models/usageCounter');
const logger = require('../utils/logger');

// -1 in a Plan document means "unlimited" for that dimension.
const UNLIMITED = -1;

// Looks up the caller's organization + its plan's limits. Cached per
// request via req._planContext so the three checks below (user/credential/
// api-call) don't each re-query Organization+Plan if more than one is
// ever chained on the same route.
async function getPlanContext(req) {
  if (req._planContext) return req._planContext;
  const orgCode = req.user?.organization_code;
  if (!orgCode) return null;

  const organization = await Organization.findOne({ organization_code: orgCode });
  if (!organization) return null;

  const plan = await Plan.findOne({ name: organization.plan });
  if (!plan) {
    // A plan name on the org that doesn't match any seeded Plan document —
    // fail closed (block) rather than silently allowing unlimited usage,
    // and log it since this indicates real data drift worth investigating.
    logger.error('plan_not_found', { organization_code: orgCode, plan_name: organization.plan });
    return null;
  }

  req._planContext = { organization, plan };
  return req._planContext;
}

const currentPeriod = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

// Security fix, found during an audit round: the user-limit check above
// only ever ran on POST /api/users (an admin creating a user directly).
// The actual real-world path most users go through -- an admin generates
// an invitation, the invitee accepts it via POST /users/self-signup --
// never called this at all, in either step. An org on the Free plan
// (max_users: 5) could generate and accept unlimited invitations with no
// 402 ever returned. This is the same by-organization-code lookup as
// getPlanContext above, but callable with an explicit organization_code
// instead of req.user -- self-signup's invitee has no session yet, so
// there is no req.user to read one from.
//
// HIGH-02 fix (audit finding, confirmed real by code review): this used to
// count Users documents, then the caller separately inserted a new one --
// not a reservation. Two invitations accepted at the same moment could
// both read the same under-the-limit count inside their own transaction
// before either committed (they insert different new User/Auth documents,
// which don't conflict with each other), so both would pass and the org
// could end up over max_users. Now the check itself IS the atomic
// reservation: organization_schema.js's seat_count field is incremented
// via a single findOneAndUpdate with a `{ $lt: max_users }` filter --
// MongoDB guarantees only one of two callers racing to update the SAME
// document can ever win that filter, so only one of two concurrent
// self-signups for the last open seat can ever succeed. Must be called
// inside the caller's own transaction (the `session` this already
// accepted) so that if a LATER step in that same transaction fails for an
// unrelated reason (duplicate email, say), the whole transaction --
// including this reservation -- rolls back automatically; nothing here
// needs to manually "release" a seat.
async function wouldExceedUserLimit(organizationCode, { session } = {}) {
  const organization = await Organization.findOne({ organization_code: organizationCode }).session(session || null);
  if (!organization) return { exceeded: true, reason: 'organization_not_found' };

  const plan = await Plan.findOne({ name: organization.plan }).session(session || null);
  if (!plan) {
    logger.error('plan_not_found', { organization_code: organizationCode, plan_name: organization.plan });
    return { exceeded: true, reason: 'plan_not_found' };
  }
  if (plan.max_users === UNLIMITED) return { exceeded: false };

  const reserved = await Organization.findOneAndUpdate(
    { organization_code: organizationCode, seat_count: { $lt: plan.max_users } },
    { $inc: { seat_count: 1 } },
    { session, new: true }
  );
  if (!reserved) {
    const current = await Users.countDocuments({ organization_code: organizationCode }).session(session || null);
    return { exceeded: true, reason: 'limit_reached', limit: plan.max_users, current, planName: plan.name };
  }
  return { exceeded: false };
}

// Blocks creating a new user once the organization's plan.max_users is
// reached. Applied to POST /api/users and POST /invitations/generate.
const checkUserLimit = async (req, res, next) => {
  try {
    const ctx = await getPlanContext(req);
    if (!ctx) return res.status(403).json({ message: 'Unable to verify plan limits for this organization' });
    if (ctx.plan.max_users === UNLIMITED) return next();

    const currentCount = await Users.countDocuments({ organization_code: ctx.organization.organization_code });
    if (currentCount >= ctx.plan.max_users) {
      return res.status(402).json({
        message: `User limit reached for the ${ctx.plan.name} plan (${ctx.plan.max_users} users). Upgrade to add more.`,
        limit: ctx.plan.max_users,
        current: currentCount,
      });
    }
    next();
  } catch (err) {
    logger.error('check_user_limit_failed', { message: err.message });
    res.status(500).json({ message: 'Server error checking plan limits' });
  }
};

// Blocks issuing a new credential once the organization's
// plan.max_credentials_per_month is reached for the current calendar
// month. Derived live from a count query against real issued credentials
// (using the createdAt timestamp — see AUDIT_FIXES.md on why timestamps
// were missing before) rather than a separate counter, so it can never
// drift out of sync with what was actually issued.
const checkCredentialLimit = async (req, res, next) => {
  try {
    const ctx = await getPlanContext(req);
    if (!ctx) return res.status(403).json({ message: 'Unable to verify plan limits for this organization' });
    if (ctx.plan.max_credentials_per_month === UNLIMITED) return next();

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentCount = await Credential.countDocuments({
      organization_code: ctx.organization.organization_code,
      createdAt: { $gte: monthStart },
    });
    if (currentCount >= ctx.plan.max_credentials_per_month) {
      return res.status(402).json({
        message: `Monthly credential limit reached for the ${ctx.plan.name} plan (${ctx.plan.max_credentials_per_month}/month). Upgrade to issue more this month.`,
        limit: ctx.plan.max_credentials_per_month,
        current: currentCount,
      });
    }
    next();
  } catch (err) {
    logger.error('check_credential_limit_failed', { message: err.message });
    res.status(500).json({ message: 'Server error checking plan limits' });
  }
};

// Increments and enforces the organization's monthly API-call budget. This
// is separate from the per-API-key requests-per-minute limiter in
// requireApiKey.js — that one guards against a single key bursting the
// server; this one is the actual monthly quota the plan promises.
const trackAndCheckApiUsage = async (req, res, next) => {
  try {
    const ctx = await getPlanContext(req);
    if (!ctx) return next(); // don't block on a missing org context here — this runs on every request

    if (ctx.plan.max_api_calls_per_month !== UNLIMITED) {
      const period = currentPeriod();
      const counter = await UsageCounter.findOneAndUpdate(
        { organization_code: ctx.organization.organization_code, period },
        { $inc: { api_calls: 1 } },
        { upsert: true, new: true }
      );
      if (counter.api_calls > ctx.plan.max_api_calls_per_month) {
        return res.status(402).json({
          message: `Monthly API call limit reached for the ${ctx.plan.name} plan (${ctx.plan.max_api_calls_per_month}/month).`,
          limit: ctx.plan.max_api_calls_per_month,
          current: counter.api_calls,
        });
      }
    }
    next();
  } catch (err) {
    logger.error('track_api_usage_failed', { message: err.message });
    next(); // usage tracking failing shouldn't take down the actual request
  }
};

// How much monthly credential quota an organization has left right now.
//
// checkCredentialLimit above guards ONE issuance at a time, as request
// middleware. Bulk issuance never passes through it: the worker calls the
// controllers directly (see queues/bulkIssuanceWorker.js), so a batch of
// 2000 could be enqueued by an organization whose plan allows 25 a month
// and every one of them would be written. This is the shared calculation
// the bulk route uses to refuse an oversized batch UP FRONT, with real
// numbers, instead of accepting the job and failing partway through --
// which would leave the customer with a half-issued batch and no clear
// reason why.
//
// Deliberately the same definition of "used" as checkCredentialLimit
// (documents created since the 1st of the month), so the pre-flight
// answer and the per-request guard can never disagree.
async function getCredentialAllowance(organizationCode) {
  const organization = await Organization.findOne({ organization_code: organizationCode }).lean();
  if (!organization) return { ok: false, reason: 'organization_not_found' };

  const plan = await Plan.findOne({ name: organization.plan }).lean();
  if (!plan) {
    // Same fail-closed posture as getPlanContext: a plan name with no
    // definition must never be treated as unlimited.
    logger.error('plan_not_found', { organization_code: organizationCode, plan_name: organization.plan });
    return { ok: false, reason: 'plan_not_found', plan_name: organization.plan };
  }

  if (plan.max_credentials_per_month === UNLIMITED) {
    return { ok: true, unlimited: true, plan_name: plan.name, limit: UNLIMITED, used: null, remaining: null };
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const used = await Credential.countDocuments({
    organization_code: organizationCode,
    createdAt: { $gte: monthStart },
  });

  return {
    ok: true,
    unlimited: false,
    plan_name: plan.name,
    limit: plan.max_credentials_per_month,
    used,
    remaining: Math.max(0, plan.max_credentials_per_month - used),
  };
}

// Atomically RESERVES quota for a bulk batch, or refuses it.
//
// getCredentialAllowance above answers "how much is left", which is enough
// to show a number on a confirmation screen but NOT enough to decide
// whether a batch may proceed: reading the allowance and then enqueueing is
// two steps, and two admins submitting 15 each against 15 remaining would
// both read 15, both pass, and 30 credentials would be issued on a
// 25-a-month plan. Nothing about checking harder fixes that -- the check
// has to BE the reservation.
//
// So the conditional $inc below is the decision. MongoDB serializes updates
// to a single document, so of two racing requests for the last of the quota
// exactly one can match the filter and win; the other finds the counter
// already raised and is refused. Same mechanism as seat_count for users
// (see wouldExceedUserLimit).
//
// Returns { ok: true, unlimited } when the batch may proceed -- the caller
// MUST release the reservation (releaseCredentialQuota) if it then fails to
// enqueue, or the quota stays consumed by a batch that never ran.
async function reserveCredentialQuota(organizationCode, requested) {
  const allowance = await getCredentialAllowance(organizationCode);
  if (!allowance.ok) return { ok: false, ...allowance };
  // An unlimited plan has nothing to reserve against.
  if (allowance.unlimited) return { ok: true, unlimited: true, plan_name: allowance.plan_name };

  const period = currentPeriod();

  // Roll the counter over at the start of a new month. Idempotent, so two
  // requests racing on the 1st both write the same values harmlessly.
  await Organization.updateOne(
    { organization_code: organizationCode, bulk_reserved_period: { $ne: period } },
    { $set: { bulk_reserved_period: period, bulk_reserved_count: 0 } },
  );

  // `remaining` already subtracts what has been ISSUED this month; this
  // subtracts what is reserved-but-not-yet-written on top of it.
  const reserved = await Organization.findOneAndUpdate(
    {
      organization_code: organizationCode,
      bulk_reserved_period: period,
      $expr: { $lte: [{ $add: ['$bulk_reserved_count', requested] }, allowance.remaining] },
    },
    { $inc: { bulk_reserved_count: requested } },
    { new: true },
  );

  if (!reserved) {
    // Refused. Re-read so the numbers reported back include whatever another
    // request reserved a moment ago, rather than the stale figure this
    // request started from.
    const current = await Organization.findOne({ organization_code: organizationCode })
      .select('bulk_reserved_count bulk_reserved_period').lean();
    const inFlight = current && current.bulk_reserved_period === period ? current.bulk_reserved_count : 0;
    return {
      ok: false,
      reason: 'quota_exceeded',
      plan_name: allowance.plan_name,
      limit: allowance.limit,
      used: allowance.used,
      remaining: Math.max(0, allowance.remaining - inFlight),
      in_flight: inFlight,
      requested,
    };
  }

  return { ok: true, unlimited: false, plan_name: allowance.plan_name };
}

// Gives reserved quota back. Called when a batch could not be enqueued after
// all, and by the worker as each credential is actually written -- at that
// point the credential is counted by the issued-this-month query instead, so
// leaving it reserved as well would charge the organization twice for it.
// Never lets the counter go negative.
async function releaseCredentialQuota(organizationCode, count = 1) {
  if (!count) return;
  const period = currentPeriod();
  await Organization.updateOne(
    { organization_code: organizationCode, bulk_reserved_period: period, bulk_reserved_count: { $gte: count } },
    { $inc: { bulk_reserved_count: -count } },
  );
}

module.exports = { checkUserLimit, checkCredentialLimit, trackAndCheckApiUsage, getPlanContext, wouldExceedUserLimit, getCredentialAllowance, reserveCredentialQuota, releaseCredentialQuota };
