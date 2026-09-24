const Organization = require('../models/organization_schema');
const Auth = require('../models/AuthCredentials');
const Users = require('../models/user_model');
const emailService = require('../services/emailService');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { isAllowedCredentialImage } = require('./credentialController');
const { belongsToOrganization } = require('../utils/managedStorage');

// Create
exports.createOrganization = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const requiredFields = ['name', 'admin_email', 'admin_phone', 'admin_first_name', 'admin_last_name', 'city', 'state', 'country'];
    for (const field of requiredFields) {
      if (typeof req.body[field] !== 'string' || !req.body[field].trim()) {
        return res.status(400).json({ error: `${field} is required` });
      }
    }
    const adminEmail = req.body.admin_email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(adminEmail)) {
      return res.status(400).json({ error: 'Invalid admin_email format' });
    }
    const phoneRegex = /^\+?[\d\s-]{7,15}$/;
    if (!phoneRegex.test(req.body.admin_phone)) {
      return res.status(400).json({ error: 'Invalid admin_phone format' });
    }
    const organization_code = 'ORG-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const activationToken = crypto.randomBytes(32).toString('base64url');
    const activationTokenHash = crypto.createHash('sha256').update(activationToken).digest('hex');
    const placeholderPassword = await bcrypt.hash(crypto.randomBytes(32).toString('base64url'), 12);
    let savedOrg;

    await session.withTransaction(async () => {
      [savedOrg] = await Organization.create([{
        organization_code,
        name: req.body.name.trim(),
        city: req.body.city.trim(),
        state: req.body.state.trim(),
        country: req.body.country.trim(),
        email: adminEmail,
        phone: req.body.admin_phone.trim(),
        status: 'TRIAL',
        plan: 'Free',
        users: 1,
      }], { session });
      await Auth.create([{
        username: adminEmail,
        password: placeholderPassword,
        user_role: 'admin',
        activation_token_hash: activationTokenHash,
        activation_expires_at: new Date(Date.now() + 60 * 60 * 1000),
        activation_password_preselected: false,
      }], { session });
      await Users.create([{
        username: adminEmail,
        organization_code,
        first_name: req.body.admin_first_name.trim(),
        last_name: req.body.admin_last_name.trim(),
        designation: 'Admin',
        city: req.body.city.trim(),
        state: req.body.state.trim(),
        country: req.body.country.trim(),
        email: adminEmail,
        phone: req.body.admin_phone.trim(),
        status: 'pending_activation',
        profile_picture_url: '',
      }], { session });
    });

    let activationEmailSent = true;
    try {
      await emailService.sendWelcomeEmail(adminEmail, savedOrg, adminEmail, activationToken, { requiresPasswordSetup: true });
    } catch {
      activationEmailSent = false;
    }
    return res.status(201).json({
      organization_code: savedOrg.organization_code,
      name: savedOrg.name,
      status: savedOrg.status,
      activation_email_sent: activationEmailSent,
    });
  } catch (err) {
    const duplicate = err?.code === 11000;
    return res.status(duplicate ? 409 : 400).json({ error: duplicate ? 'Organization administrator already exists' : err.message });
  } finally {
    await session.endSession();
  }
};

// Read All
exports.getAllOrganizations = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const skip = parseInt(req.query.skip) || 0;
    // Soft-deleted orgs (H-22) are excluded by default; a platform admin
    // can still pull them up explicitly for audit purposes.
    const includeDeleted = req.user.role === 'platform_admin' && req.query.include_deleted === 'true';
    const filter = req.user.role === 'platform_admin' ? {} : { organization_code: req.user.organization_code };
    if (!includeDeleted) filter.status = { $ne: 'DELETED' };
    const organizations = await Organization.find(filter)
      .skip(skip).limit(limit).lean();
    res.status(200).json(organizations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Authenticated settings endpoint. The public /code/:organization_code
// route deliberately omits private fields such as the certificate
// signature; this route always uses the organization from the verified
// session, never a browser-controlled organization code.
exports.getCurrentOrganization = async (req, res) => {
  try {
    if (!req.user?.organization_code) {
      return res.status(400).json({ message: 'No organization is associated with this account' });
    }
    const organization = await Organization.findOne({
      organization_code: req.user.organization_code,
      status: { $ne: 'DELETED' },
    });
    if (!organization) return res.status(404).json({ message: 'Organization not found' });
    return res.status(200).json(organization);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// Read by ID
exports.getOrganizationById = async (req, res) => {
  try {
    const org = await Organization.findById(req.params.id);
    if (!org) return res.status(404).json({ message: 'Organization not found' });
    if (req.user.role !== 'platform_admin' && req.user.organization_code && org.organization_code !== req.user.organization_code) {
      return res.status(403).json({ message: 'Not allowed to access another organization' });
    }
    res.status(200).json(org);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
// Read by code — intentionally public (branding/verification pages), so
// it only returns public-facing fields. It used to return the whole
// document, including `plan` and internal `status`/`users` count, which
// aren't meant for an anonymous visitor.
exports.getOrganizationByOrgCode = async (req, res) => {
  try {
    // A deleted organization (H-22) has no public branding/verification
    // page anymore, same as if it never existed to an anonymous visitor.
    const org = await Organization.findOne({organization_code: req.params.organization_code, status: { $ne: 'DELETED' }})
      .select('organization_code name city state country email phone logo');
    if (!org) return res.status(404).json({ message: 'Organization not found' });
    res.status(200).json(org);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
// Update
exports.updateOrganization = async (req, res) => {
  try {
    const target = await Organization.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'Organization not found' });
    // Was missing entirely — any admin could update ANY organization by
    // Mongo _id, not just their own (there's no org_code in this URL for
    // the usual requireOwnOrg middleware to check against _id directly).
    // Settings are always scoped to the authenticated organization.
    // SA-03 fix, narrowed after tests/platformCompanySettings.integration.
    // test.js caught the first version being too broad: platform_admin is
    // exempted from the cross-org check ONLY for the exact status-only
    // toggle Super Admin's Enable/Disable button sends (confirmed against
    // super_admin/organizations/page.js: `{ status: newStatus }`, nothing
    // else). The original unconditional exemption let platform_admin edit
    // ANY field (name, email, ...) on ANY tenant through this same
    // endpoint -- Super Admin's real purpose is the status toggle, not a
    // blanket "edit any organization" capability, and every other field
    // still has to go through the owning organization's own admin.
    const isPlatformStatusOnlyToggle = req.user.role === 'platform_admin'
      && ['ACTIVE', 'SUSPENDED'].includes(req.body?.status)
      && Object.keys(req.body || {}).every((key) => key === 'status');
    if (target.organization_code !== req.user.organization_code && !isPlatformStatusOnlyToggle) {
      return res.status(403).json({ message: "Not allowed to modify another organization" });
    }
    // Profile settings may never change plan, lifecycle or tenancy fields.
    const editableFields = ['name', 'city', 'state', 'country', 'email', 'phone', 'logo', 'signature'];
    const allowedFields = Object.fromEntries(
      editableFields
        .filter((field) => Object.prototype.hasOwnProperty.call(req.body || {}, field))
        .map((field) => [field, req.body[field]])
    );
    // SA-03 fix: Super Admin's Enable/Disable action posts { status }, but
    // status was excluded from editableFields entirely (see the original
    // comment above this block) -- the request silently no-op'd, so the
    // button always looked like it worked but never changed anything.
    // Scoped to platform_admin only, and only between the two real
    // operational states -- plan/lifecycle changes (TRIAL) and deletion
    // (DELETED, which needs deleteOrganization's cascade handling) still
    // cannot be reached through this endpoint.
    if (req.user.role === 'platform_admin' && ['ACTIVE', 'SUSPENDED'].includes(req.body?.status)) {
      allowedFields.status = req.body.status;
    }
    for (const assetField of ['logo', 'signature']) {
      const assetUrl = allowedFields[assetField];
      // An empty string intentionally clears the asset. Any replacement
      // must be a managed image uploaded for this same organization.
      if (assetUrl && !isAllowedCredentialImage(assetUrl)) {
        return res.status(400).json({ message: `${assetField} must be a managed-storage image` });
      }
      if (assetUrl && !await belongsToOrganization(assetUrl, target.organization_code)) {
        return res.status(403).json({ message: `${assetField} does not belong to this organization` });
      }
    }
    const updatedOrg = await Organization.findByIdAndUpdate(
      req.params.id,
      allowedFields,
      { new: true, runValidators: true }
    );
    res.status(200).json(updatedOrg);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Delete — soft delete (E2E audit H-22). A hard delete here left every
// credential, user, design, contract, etc. under the organization
// silently orphaned (no cascade), with no way to recover from an
// accidental or malicious delete. This instead marks the organization as
// deleted and keeps its data and the data of everything under it intact
// for audit/retention; the controlled permanent purge after the retention
// window is a separate mechanism (services/organizationPurgeService.js,
// scheduled job in queues/scheduledJobsQueue.js — see PRODUCTION_RUNBOOK.md
// section 3.b), not something this endpoint does itself.
exports.deleteOrganization = async (req, res) => {
  try {
    const target = await Organization.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'Organization not found' });
    if (target.status === 'DELETED') {
      return res.status(409).json({ message: 'Organization is already deleted' });
    }
    target.status = 'DELETED';
    target.deleted_at = new Date();
    await target.save();
    res.status(200).json({ message: 'Organization deleted successfully', deleted_at: target.deleted_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Explicit, separate endpoint for changing plan — deliberately not folded
// into the generic updateOrganization above, so a plan change is always a
// distinct, auditable action rather than one field among many in a broad
// PATCH. What triggers this in practice (a billing webhook, a manual
// upgrade approval, self-service checkout) is a business decision outside
// this code's scope — this is just the mechanism that applies it.
exports.changeOrganizationPlan = async (req, res) => {
  try {
    const { plan } = req.body;
    const Plan = require('../models/plan_schema');
    const validPlan = await Plan.findOne({ name: plan });
    if (!validPlan) {
      return res.status(400).json({ message: `Unknown plan "${plan}"` });
    }

    const organization = await Organization.findOne({ organization_code: req.params.organization_code });
    if (!organization) return res.status(404).json({ message: 'Organization not found' });
    organization.plan = plan;
    await organization.save();
    res.status(200).json({ message: `Plan changed to ${plan}`, organization_code: organization.organization_code, plan });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Current usage vs plan limits — visibility, not just blocking. An org
// admin (or their dashboard) can check "how close am I to my limits"
// without waiting to actually hit a 402 on a real action.
exports.getOrganizationUsage = async (req, res) => {
  try {
    const { getPlanContext } = require('../middleware/enforcePlanLimits');
    const Users = require('../models/user_model');
    const Credential = require('../models/credentialSchema');
    const UsageCounter = require('../models/usageCounter');

    const ctx = await getPlanContext(req);
    if (!ctx) return res.status(404).json({ message: 'Organization or plan not found' });

    const userCount = await Users.countDocuments({ organization_code: ctx.organization.organization_code });
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const credentialCount = await Credential.countDocuments({
      organization_code: ctx.organization.organization_code,
      createdAt: { $gte: monthStart },
    });
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const usageCounter = await UsageCounter.findOne({ organization_code: ctx.organization.organization_code, period });

    res.status(200).json({
      plan: ctx.plan.name,
      users: { used: userCount, limit: ctx.plan.max_users },
      credentials_this_month: { used: credentialCount, limit: ctx.plan.max_credentials_per_month },
      api_calls_this_month: { used: usageCounter?.api_calls || 0, limit: ctx.plan.max_api_calls_per_month },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// SA-03 fix: Super Admin's Dashboard called GET /api/summary/overview, a
// route that never existed anywhere in this backend -- the page could
// never load anything but its own error state. This is a real aggregate
// over real collections (Organization for company counts, PendingOrgSignup
// for revenue/transaction history -- the same source Payment Proofs and
// Transactions already reconcile against), not synthesized data.
// Plan + consumption for ONE organization.
//
// Tenant isolation is the whole security surface of this endpoint: an
// admin may only ever read its own organization. A platform admin may
// read any, because that is precisely its job (see the consolidated
// endpoint below). The check is deliberately written as an explicit
// allow-list of the two legitimate cases rather than "deny if X", so a
// future role cannot fall through into cross-tenant access by accident.
exports.getPlanUsage = async (req, res) => {
  try {
    const { getPlanUsage } = require('../services/planUsageService');
    const requested = (req.params.organization_code || '').trim() || req.user.organization_code;
    const isPlatformAdmin = req.user.role === 'platform_admin';
    const isOwnOrganization = requested === req.user.organization_code;

    if (!isPlatformAdmin && !isOwnOrganization) {
      return res.status(403).json({ message: 'Not allowed to read another organization' });
    }
    if (!requested) {
      return res.status(400).json({ message: 'No organization to report on' });
    }

    const result = await getPlanUsage(requested);
    if (!result) return res.status(404).json({ message: 'Organization not found' });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load plan usage', error: error.message });
  }
};

// Consolidated plan + consumption across every organization. Platform
// admin only (enforced by requirePlatformAdmin on the route as well --
// this is the second, independent check, matching how the rest of this
// controller layers route-level and handler-level authorization).
exports.getPlanUsageForAllOrganizations = async (req, res) => {
  try {
    if (req.user.role !== 'platform_admin') {
      return res.status(403).json({ message: 'Platform administrator access required' });
    }
    const { getPlanUsageForAllOrganizations } = require('../services/planUsageService');
    const organizations = await getPlanUsageForAllOrganizations({
      includeDeleted: req.query.include_deleted === 'true',
    });
    return res.status(200).json({ organizations, count: organizations.length });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load consolidated plan usage', error: error.message });
  }
};

exports.getPlatformOverview = async (req, res) => {
  try {
    const PendingOrgSignup = require('../models/pendingOrgSignup');

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [totalCompanies, activeCompanies, trialCompanies, suspendedCompanies, recentCompleted] = await Promise.all([
      Organization.countDocuments({ status: { $ne: 'DELETED' } }),
      Organization.countDocuments({ status: 'ACTIVE' }),
      Organization.countDocuments({ status: 'TRIAL' }),
      Organization.countDocuments({ status: 'SUSPENDED' }),
      PendingOrgSignup.find({ status: 'completed' }).sort({ createdAt: -1 }).limit(10).lean(),
    ]);

    // Revenue = verified_amount_cents recorded at manual approval time
    // (see selfServiceSignup.js's approveSignup) -- the one place a real,
    // confirmed payment amount is stored in this system.
    const revenueAgg = await PendingOrgSignup.aggregate([
      { $match: { status: 'completed', 'manual_verification.verified_at': { $exists: true } } },
      {
        $group: {
          _id: {
            year: { $year: '$manual_verification.verified_at' },
            month: { $month: '$manual_verification.verified_at' },
          },
          total_cents: { $sum: '$manual_verification.verified_amount_cents' },
        },
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 12 },
    ]);

    const monthKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
    const revenueByMonth = Object.fromEntries(revenueAgg.map(r => [monthKey(r._id.year, r._id.month), r.total_cents / 100]));
    const revenueThisMonth = revenueByMonth[monthKey(now.getFullYear(), now.getMonth() + 1)] || 0;
    const revenueLastMonth = revenueByMonth[monthKey(lastMonthStart.getFullYear(), lastMonthStart.getMonth() + 1)] || 0;

    const chartDetails = [...revenueAgg].reverse().map(r => ({
      month: new Date(r._id.year, r._id.month - 1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' }),
      subscription_payment: r.total_cents / 100,
      payments_due: 0,
    }));

    res.status(200).json({
      total_companies: totalCompanies,
      active_companies: activeCompanies,
      companies_on_trial: trialCompanies,
      companies_past_due: suspendedCompanies,
      revenue_this_month: revenueThisMonth,
      revenue_last_month: revenueLastMonth,
      financial_summary: [{ details: chartDetails }],
      transactions: recentCompleted.map(t => ({
        transaction_code: t.payment_reference,
        date: t.manual_verification?.verified_at || t.createdAt,
        amount: (t.manual_verification?.verified_amount_cents ?? t.expected_amount_cents) / 100,
        status: 'Completed',
      })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
