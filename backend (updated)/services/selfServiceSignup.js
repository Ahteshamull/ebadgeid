// services/selfServiceSignup.js
//
// Self-service organization signup -- previously only a platform_admin
// could create an organization (POST /api/organizations). A plan with
// is_free:true (see plan_schema.js) provisions immediately.
//
// A paid plan goes through a real Tilopay hosted payment page first. The
// organization and its first admin account are NEVER created from the
// customer's browser being redirected back (handleTilopayReturn below) --
// a browser redirect is a customer-navigation event, not payment proof
// (Tilopay does not publish a signature to verify it with, see
// tilopayClient.js's header comment). The redirect only moves the pending
// record to `awaiting_verification` and notifies both the onboarding team
// and the customer; actual provisioning only happens once a
// platform_admin manually confirms the transaction in Tilopay's own
// dashboard and calls approveSignup below (security remediation round;
// see REMEDIATION_REPORT.md).
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const Organization = require('../models/organization_schema');
const AuthCredentials = require('../models/AuthCredentials');
const Users = require('../models/user_model');
const Plan = require('../models/plan_schema');
const PendingOrgSignup = require('../models/pendingOrgSignup');
const AuditLog = require('../models/auditLog');
const tilopay = require('./tilopayClient');
const logger = require('../utils/logger');
const emailService = require('./emailService');

// Same fire-and-forget pattern as credentialController.js's recordAudit --
// a manual payment approval provisions a whole paying organization, exactly
// the kind of high-stakes admin action this table exists for elsewhere in
// the app. Never blocks or fails the actual approval/rejection just because
// the audit write itself had a problem.
const recordAudit = (event, { entityId, organizationCode, actorUsername, metadata }) => {
  AuditLog.create({
    entity_type: 'organization_signup',
    entity_id: entityId,
    event,
    organization_code: organizationCode,
    actor_username: actorUsername || null,
    metadata,
  }).catch((err) => logger.error('audit_log_write_failed', { event, message: err.message }));
};

function isConfigured() {
  return tilopay.isConfigured();
}

// A short, URL-safe, collision-resistant code derived from the org's own
// name (not trusted verbatim from the client, and not left for the
// client to pick outright -- avoids both collisions and someone
// deliberately squatting a recognizable competitor's code).
function generateOrganizationCode(name) {
  const slug = String(name || 'org').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'org';
  return `${slug}-${crypto.randomBytes(3).toString('hex')}`;
}

// The one real "create everything" step, shared by the Free-plan direct
// path and the manual payment-approval path -- so there is exactly one
// place organization+admin provisioning actually happens, not two
// parallel implementations that could drift. Runs as a real MongoDB
// transaction with a bounded retry on an organization_code collision, so
// a paid account can never end up half-created.
async function provisionOrganization({ organization, plan_name, admin, requireActivation = true }) {
  const session = await Organization.startSession();
  let organization_code;
  const activationToken = requireActivation ? crypto.randomBytes(32).toString('base64url') : null;
  const activationTokenHash = activationToken
    ? crypto.createHash('sha256').update(activationToken).digest('hex')
    : null;
  try {
    await session.withTransaction(async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        organization_code = generateOrganizationCode(organization.name);
        try {
          await Organization.create([{
            organization_code,
            name: organization.name,
            city: organization.city,
            state: organization.state,
            country: organization.country,
            email: organization.email,
            phone: organization.phone,
            status: 'ACTIVE',
            plan: plan_name,
          }], { session });
          break;
        } catch (error) {
          if (error?.code !== 11000 || attempt === 4) throw error;
        }
      }

      await AuthCredentials.create([{
        username: admin.username,
        password: admin.password_hash,
        user_role: 'admin',
        ...(activationTokenHash ? {
          activation_token_hash: activationTokenHash,
          activation_expires_at: new Date(Date.now() + 60 * 60 * 1000),
          activation_password_preselected: true,
        } : {}),
      }], { session });
      await Users.create([{
        username: admin.username,
        organization_code,
        first_name: admin.first_name,
        last_name: admin.last_name,
        designation: admin.designation || 'Administrator',
        city: organization.city,
        state: organization.state,
        country: organization.country,
        email: admin.email,
        phone: organization.phone,
        status: requireActivation ? 'pending_activation' : 'active',
      }], { session });
    });
  } catch (error) {
    if (error?.code === 11000 && /username/i.test(error.message || '')) {
      throw Object.assign(new Error('That admin username is already taken'), { statusCode: 409 });
    }
    throw error;
  } finally {
    await session.endSession();
  }

  logger.info('self_service_organization_provisioned', { organization_code, plan_name });
  return { organization_code, activationToken };
}

async function validateSignupInput({ organization, plan_name, admin }, { requirePasswordConfirmation = false } = {}) {
  if (!organization?.name || !organization?.city || !organization?.state || !organization?.country || !organization?.email || !organization?.phone) {
    throw Object.assign(new Error('organization requires name, city, state, country, email, phone'), { statusCode: 400 });
  }
  if (!admin?.username || typeof admin.password !== 'string' || admin.password.length < 12 || !admin?.first_name || !admin?.last_name || !admin?.email) {
    throw Object.assign(new Error('admin requires username, a password of at least 12 characters, first_name, last_name, email'), { statusCode: 400 });
  }
  if (requirePasswordConfirmation && admin.password !== admin.confirmPassword) {
    throw Object.assign(new Error('Passwords do not match'), { statusCode: 400 });
  }
  const plan = await Plan.findOne({ name: plan_name });
  if (!plan) throw Object.assign(new Error(`Unknown plan: ${plan_name}`), { statusCode: 400 });
  const existingUsername = await AuthCredentials.findOne({ username: admin.username });
  if (existingUsername) throw Object.assign(new Error('That admin username is already taken'), { statusCode: 409 });
  return plan;
}

// Real billing address fields Tilopay's processPayment requires that
// aren't already part of the base organization/admin signup shape.
function validateBilling(billing) {
  if (!billing?.address || !billing?.zip || !billing?.telephone) {
    throw Object.assign(new Error('billing requires address, zip, telephone (and optionally address2, state) for a paid plan'), { statusCode: 400 });
  }
}

// Returns { free: true, organization_code } for an immediate signup, or
// { free: false, paymentUrl } for a paid plan that needs to complete a
// real Tilopay hosted-payment-page flow first (see handleTilopayReturn
// below for what happens when the customer's browser comes back).
// `returnBaseUrl` is this API's own publicly reachable origin (computed
// by the route handler from PUBLIC_API_BASE_URL if set, otherwise from
// the real incoming request -- same configured-value-or-derive-from-req
// pattern already used by controllers/uploadController.js's fileUrl for
// the same underlying reason: Tilopay's redirect is a real customer
// browser GET, so it needs a real, absolute, externally-resolvable URL).
async function startSignup({ organization, plan_name, admin, billing, returnBaseUrl }) {
  const plan = await validateSignupInput({ organization, plan_name, admin });
  // 12 rounds, matching every other real-password bcrypt.hash call in the
  // app (authController.js, userController.js) -- this one was left at
  // the weaker 10, an inconsistency with no reason behind it (found
  // during an audit round).
  const password_hash = await bcrypt.hash(admin.password, 12);

  if (plan.is_free) {
    const result = await provisionOrganization({
      organization,
      plan_name,
      admin: {
        username: admin.username,
        password_hash,
        first_name: admin.first_name,
        last_name: admin.last_name,
        email: admin.email,
        designation: admin.designation,
      },
    });
    let activationEmailSent = false;
    try {
      await emailService.sendWelcomeEmail(admin.email, { ...organization, organization_code: result.organization_code }, admin.username, result.activationToken);
      activationEmailSent = true;
    } catch (error) {
      // The account intentionally remains pending, never active, if delivery
      // is transiently unavailable. The public resend endpoint is the safe
      // recovery path; the raw activation token is never written to logs.
      logger.error('self_service_activation_email_failed', { organization_code: result.organization_code, message: error.message });
    }
    return { free: true, organization_code: result.organization_code, activation_email_sent: activationEmailSent };
  }

  // A paid plan (is_free: false) must have a real price configured before
  // anyone can be charged for it. Security fix, found live during an
  // audit round: this used to be inferred from `!plan.price_cents`, so a
  // freshly-deployed paid tier (price not set yet -- pricing is a
  // business decision made after deploy, see plan_schema.js) fell through
  // to the free branch above and provisioned immediately, no payment, no
  // platform_admin approval. Refusing outright here is deliberate: a
  // misconfigured price must never silently become "free", for any plan
  // that isn't actually meant to be free.
  if (!plan.price_cents) {
    throw Object.assign(new Error(`Plan "${plan_name}" is not yet configured with a price on this deployment — contact the platform operator`), { statusCode: 503 });
  }

  if (!tilopay.isConfigured()) {
    throw Object.assign(new Error('Tilopay is not configured (TILOPAY_API_USER/PASSWORD/KEY) — paid self-service signup is not available on this deployment'), { statusCode: 503 });
  }
  validateBilling(billing);

  // Unguessable by construction (crypto.randomBytes, not a counter/
  // timestamp) -- see services/tilopayClient.js's header comment on why
  // this is this flow's real defense against a forged return-redirect,
  // in the absence of a publicly documented signature to verify instead.
  const paymentReference = `EBID-${crypto.randomBytes(10).toString('hex').toUpperCase()}`;
  const apiBase = returnBaseUrl.replace(/\/$/, '');

  const payment = await tilopay.createPayment({
    orderNumber: paymentReference,
    amount: (plan.price_cents / 100).toFixed(2),
    currency: 'USD',
    // Tilopay GETs this URL with the outcome in the query string once the
    // customer finishes on their hosted page -- this has to be a real
    // backend route (not a frontend page directly) because provisioning
    // the organization is server logic that has to run before the
    // customer ever sees a "you're signed up" screen.
    redirect: `${apiBase}/api/organizations/self-signup/tilopay-return`,
    billTo: {
      firstName: admin.first_name,
      lastName: admin.last_name,
      address: billing.address,
      address2: billing.address2,
      city: organization.city,
      state: billing.state || organization.state,
      zip: billing.zip,
      country: organization.country,
      telephone: billing.telephone,
      email: admin.email,
    },
    platform: 'ebadgeid-self-signup',
  });

  await PendingOrgSignup.create({
    payment_reference: paymentReference,
    organization,
    plan_name,
    expected_amount_cents: plan.price_cents,
    expected_currency: 'USD',
    admin: { username: admin.username, password_hash, first_name: admin.first_name, last_name: admin.last_name, email: admin.email, designation: admin.designation },
    status: 'pending',
  });

  return { free: false, paymentUrl: payment.url };
}

// Called from the GET route Tilopay redirects the customer's browser to.
// A browser redirect is not an authenticated payment notification, so it
// must never provision an account or even mark a payment as approved.
// The record moves to `awaiting_verification` for a platform_admin to
// confirm manually (approveSignup below) against Tilopay's own dashboard.
async function handleTilopayReturn({ code, order }) {
  // Security fix, found during an audit round: `order` comes straight
  // from req.query.order (an unauthenticated redirect) with no type
  // check -- Express's query parser supports ?order[$ne]=x, which would
  // otherwise reach Mongo as a real query operator instead of a literal
  // payment_reference match. Same pattern as organizationAssetController.js's
  // asset_type / help_backend's user_type.
  if (typeof order !== 'string') {
    logger.error('self_service_tilopay_return_invalid_order_type', { order_type: typeof order });
    return { ok: false, reason: 'unknown_reference' };
  }
  const pending = await PendingOrgSignup.findOne({ payment_reference: order }).select('+admin');
  if (!pending) {
    logger.error('self_service_tilopay_return_unknown_reference', { order });
    return { ok: false, reason: 'unknown_reference' };
  }
  if (pending.status === 'completed') return { ok: true, organization_code: pending.organization_code, already_processed: true };
  if (String(code) !== '1') {
    if (pending.status === 'pending') {
      await PendingOrgSignup.updateOne({ _id: pending._id, status: 'pending' }, { $set: { status: 'failed' } });
    }
    logger.info('self_service_tilopay_redirect_not_approved', { order, code: String(code || '') });
    return { ok: false, reason: 'payment_not_approved' };
  }
  if (pending.status === 'pending') {
    await PendingOrgSignup.updateOne(
      { _id: pending._id, status: 'pending' },
      { $set: { status: 'awaiting_verification' } }
    );
  }
  // Notify sales/onboarding exactly once. This is intentionally an
  // operational lead, not an automated account activation.
  const claimedForNotification = process.env.ONBOARDING_NOTIFICATION_EMAIL
    ? await PendingOrgSignup.findOneAndUpdate(
      { _id: pending._id, onboarding_notified_at: { $exists: false } },
      { $set: { onboarding_notified_at: new Date() } },
      { new: true }
    ).select('+admin')
    : null;
  if (claimedForNotification) {
    try {
      const result = await emailService.sendOnboardingRequest(process.env.ONBOARDING_NOTIFICATION_EMAIL, claimedForNotification);
      logger.info('self_service_onboarding_request_notified', { order, sent: Boolean(result.success), skipped: Boolean(result.skipped) });
    } catch (error) {
      // Let a retry of the redirect attempt delivery again instead of
      // permanently losing an onboarding request when SMTP is transiently down.
      await PendingOrgSignup.updateOne({ _id: pending._id }, { $unset: { onboarding_notified_at: 1 } });
      logger.error('self_service_onboarding_notification_failed', { order, message: error.message });
    }
  }
  // The customer gets a separate acknowledgement with the stated
  // 18-hour response commitment. It is sent once and deliberately does
  // not call the payment completed: confirmation still happens through
  // approveSignup below, not from this redirect.
  const claimedForCustomerConfirmation = await PendingOrgSignup.findOneAndUpdate(
    { _id: pending._id, customer_onboarding_notified_at: { $exists: false } },
    { $set: { customer_onboarding_notified_at: new Date() } },
    { new: true }
  ).select('+admin');
  if (claimedForCustomerConfirmation) {
    try {
      const result = await emailService.sendCustomerOnboardingConfirmation(
        claimedForCustomerConfirmation.admin?.email,
        claimedForCustomerConfirmation
      );
      logger.info('self_service_customer_onboarding_confirmation_sent', { order, sent: Boolean(result.success), skipped: Boolean(result.skipped) });
    } catch (error) {
      await PendingOrgSignup.updateOne({ _id: pending._id }, { $unset: { customer_onboarding_notified_at: 1 } });
      logger.error('self_service_customer_onboarding_confirmation_failed', { order, message: error.message });
    }
  }
  logger.info('self_service_tilopay_redirect_received_untrusted', { order, code: String(code || '') });
  return { ok: false, reason: 'payment_verification_pending' };
}

// The completion of the loop handleTilopayReturn deliberately does not
// close: a platform_admin, after manually confirming the transaction in
// Tilopay's own dashboard (amount, currency, capture status), calls this
// to actually provision the organization. Without this, a paid signup
// would be a permanent dead end at `awaiting_verification` -- this is
// what makes the manual-review mitigation a real, completable substitute
// for the authenticated provider confirmation Tilopay doesn't publish.
// admin is select: false on the schema (it carries password_hash) -- a
// platform_admin reviewing a payment still needs to know who they'd be
// approving, so this explicitly re-selects it and strips password_hash
// before returning, rather than exposing the field wholesale.
async function listPendingSignups({ status = 'awaiting_verification' } = {}) {
  const rows = await PendingOrgSignup.find({ status }).select('+admin').sort({ createdAt: -1 }).lean();
  return rows.map(row => {
    if (row.admin) {
      const { password_hash, ...adminContact } = row.admin;
      row.admin = adminContact;
    }
    return row;
  });
}

async function approveSignup({ pendingId, verifiedBy, evidenceReference, verifiedAmountCents, verifiedCurrency, note }) {
  if (!mongoose.isValidObjectId(pendingId)) {
    throw Object.assign(new Error('Invalid pending signup id'), { statusCode: 400 });
  }
  if (!verifiedBy || !evidenceReference || !Number.isFinite(verifiedAmountCents) || !verifiedCurrency) {
    throw Object.assign(new Error('verifiedBy, evidenceReference, verifiedAmountCents, and verifiedCurrency are all required to approve a payment'), { statusCode: 400 });
  }
  // Claimed atomically so two admins clicking "approve" at the same time
  // can never both provision the same pending signup.
  const pending = await PendingOrgSignup.findOneAndUpdate(
    { _id: pendingId, status: 'awaiting_verification' },
    { $set: { status: 'provisioning' } },
    { new: true }
  ).select('+admin');
  if (!pending) {
    throw Object.assign(new Error('Pending signup not found, or not awaiting verification'), { statusCode: 404 });
  }
  if (verifiedAmountCents !== pending.expected_amount_cents || verifiedCurrency.toUpperCase() !== pending.expected_currency) {
    await PendingOrgSignup.updateOne({ _id: pending._id, status: 'provisioning' }, { $set: { status: 'awaiting_verification' } });
    throw Object.assign(new Error('Verified amount/currency do not match the expected amount/currency for this signup'), { statusCode: 409 });
  }

  // Real recovery fix (found live, reproduced for real): provisionOrganization
  // can genuinely fail after the status above was already flipped to
  // 'provisioning' (a duplicate username collision, a transient Mongo
  // error, etc.) -- without this catch, the record was left stuck in
  // 'provisioning' forever: not 'awaiting_verification' (so it silently
  // disappeared from the review queue) and not 'completed' (so no
  // organization exists), with no automatic way back and no record of
  // what happened. This makes the state machine actually closed: any
  // failure here reverts the claim atomically (only from 'provisioning',
  // so it can never clobber a concurrent successful approval) and puts
  // the signup back in the queue for a platform_admin to retry or reject,
  // with the real failure reason recorded on the pending record itself
  // for the next reviewer to see -- not just in a log line.
  let result;
  try {
    result = await provisionOrganization({ organization: pending.organization, plan_name: pending.plan_name, admin: pending.admin });
  } catch (provisionError) {
    await PendingOrgSignup.updateOne(
      { _id: pending._id, status: 'provisioning' },
      {
        $set: { status: 'awaiting_verification' },
        $push: {
          approval_attempts: {
            attempted_at: new Date(),
            attempted_by: verifiedBy,
            error: provisionError.message,
          },
        },
      }
    );
    logger.error('self_service_signup_provisioning_failed_reverted', {
      pending_id: String(pending._id),
      message: provisionError.message,
    });
    // Surfaced to the caller as-is (statusCode preserved when the error
    // already carries one, e.g. the 409 "username already taken" case)
    // so the admin sees exactly why it failed, not a generic 500 -- and
    // knows the record is safely back in the queue, not lost.
    throw provisionError;
  }
  await PendingOrgSignup.updateOne({ _id: pending._id }, {
    $set: {
      status: 'completed',
      organization_code: result.organization_code,
      manual_verification: {
        verified_by: verifiedBy,
        verified_at: new Date(),
        evidence_reference: evidenceReference,
        verified_amount_cents: verifiedAmountCents,
        verified_currency: verifiedCurrency.toUpperCase(),
        note: note || undefined,
      },
    },
  });
  logger.info('self_service_signup_manually_approved', { pending_id: String(pending._id), organization_code: result.organization_code, verified_by: verifiedBy });
  recordAudit('self_signup_approved', {
    entityId: pending.payment_reference,
    organizationCode: result.organization_code,
    actorUsername: verifiedBy,
    metadata: { evidence_reference: evidenceReference, verified_amount_cents: verifiedAmountCents, verified_currency: verifiedCurrency.toUpperCase() },
  });
  try {
    await emailService.sendWelcomeEmail(
      pending.admin.email,
      { ...pending.organization, organization_code: result.organization_code },
      pending.admin.username,
      result.activationToken
    );
  } catch (error) {
    logger.error('self_service_approved_activation_email_failed', { pending_id: String(pending._id), message: error.message });
  }
  return { organization_code: result.organization_code };
}

// Public administrator registration is a thin, strictly validated adapter to
// the single transactional provisioning primitive above. It exists to give
// the product a stable browser contract without duplicating organization or
// credential creation logic.
async function startAdministratorSignup({ first_name, last_name, email, designation, organization_name, password, confirm_password, phone, city, state, country }) {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const organization = {
    name: typeof organization_name === 'string' ? organization_name.trim() : '',
    email: normalizedEmail,
    phone: typeof phone === 'string' ? phone.trim() : '',
    city: typeof city === 'string' ? city.trim() : '',
    state: typeof state === 'string' ? state.trim() : '',
    country: typeof country === 'string' ? country.trim() : '',
  };
  const admin = {
    username: normalizedEmail,
    email: normalizedEmail,
    password,
    confirmPassword: confirm_password,
    first_name: typeof first_name === 'string' ? first_name.trim() : '',
    last_name: typeof last_name === 'string' ? last_name.trim() : '',
    designation: typeof designation === 'string' ? designation.trim() : '',
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw Object.assign(new Error('A valid institutional or corporate email is required'), { statusCode: 400 });
  }
  if (!admin.designation) {
    throw Object.assign(new Error('Designation is required'), { statusCode: 400 });
  }
  const plan = await validateSignupInput({ organization, plan_name: 'Free', admin }, { requirePasswordConfirmation: true });
  if (!plan.is_free) {
    throw Object.assign(new Error('The Free plan is not configured on this deployment'), { statusCode: 503 });
  }
  const password_hash = await bcrypt.hash(password, 12);
  const result = await provisionOrganization({
    organization,
    plan_name: plan.name,
    admin: { ...admin, password_hash },
  });
  let activationEmailSent = false;
  try {
    await emailService.sendWelcomeEmail(normalizedEmail, { ...organization, organization_code: result.organization_code }, normalizedEmail, result.activationToken);
    activationEmailSent = true;
  } catch (error) {
    logger.error('administrator_signup_activation_email_failed', { organization_code: result.organization_code, message: error.message });
  }
  return { organization_code: result.organization_code, activation_email_sent: activationEmailSent };
}

async function rejectSignup({ pendingId, verifiedBy, note }) {
  if (!mongoose.isValidObjectId(pendingId)) {
    throw Object.assign(new Error('Invalid pending signup id'), { statusCode: 400 });
  }
  const pending = await PendingOrgSignup.findOneAndUpdate(
    { _id: pendingId, status: 'awaiting_verification' },
    {
      $set: {
        status: 'failed',
        manual_verification: { verified_by: verifiedBy, verified_at: new Date(), note: note || undefined },
      },
    },
    { new: true }
  );
  if (!pending) {
    throw Object.assign(new Error('Pending signup not found, or not awaiting verification'), { statusCode: 404 });
  }
  logger.info('self_service_signup_manually_rejected', { pending_id: String(pending._id), verified_by: verifiedBy });
  // No organization ever gets created for a rejected signup, so there is
  // no real organization_code yet to file this under -- the payment
  // reference is the only stable identifier for the attempt itself.
  recordAudit('self_signup_rejected', {
    entityId: pending.payment_reference,
    organizationCode: pending.payment_reference,
    actorUsername: verifiedBy,
    metadata: { note: note || undefined },
  });
  return { ok: true };
}

// Recovers records left stuck in 'provisioning' by a process crash or
// container restart mid-transaction inside approveSignup (a real gap
// approveSignup's own try/catch above cannot cover -- a crash doesn't run
// a catch block). Not a full replacement for that fix; the two are
// complementary: the try/catch handles a provisionOrganization *error*
// synchronously, this handles the process *dying* entirely. Reverts any
// record still 'provisioning' after STUCK_PROVISIONING_MINUTES back to
// 'awaiting_verification' so it re-enters the normal review queue instead
// of being lost. Safe to run repeatedly/concurrently: the update is
// scoped to status:'provisioning' with an age filter, so a record a
// second worker is mid-way through actually provisioning (which holds
// that status only for the brief duration of one Mongo transaction, not
// the full STUCK_PROVISIONING_MINUTES window) is never touched.
const STUCK_PROVISIONING_MINUTES = 15;
async function recoverStuckProvisioningSignups() {
  const cutoff = new Date(Date.now() - STUCK_PROVISIONING_MINUTES * 60 * 1000);
  const stuck = await PendingOrgSignup.find({ status: 'provisioning', updatedAt: { $lt: cutoff } }).select('_id');
  let recovered = 0;
  for (const record of stuck) {
    const result = await PendingOrgSignup.updateOne(
      { _id: record._id, status: 'provisioning', updatedAt: { $lt: cutoff } },
      {
        $set: { status: 'awaiting_verification' },
        $push: {
          approval_attempts: {
            attempted_at: new Date(),
            attempted_by: 'system:recoverStuckProvisioningSignups',
            error: `Stuck in 'provisioning' for over ${STUCK_PROVISIONING_MINUTES} minutes (likely a crash mid-approval) -- reverted automatically for review.`,
          },
        },
      }
    );
    if (result.modifiedCount > 0) {
      recovered += 1;
      logger.error('self_service_signup_stuck_provisioning_recovered', { pending_id: String(record._id) });
    }
  }
  return { checked: stuck.length, recovered };
}

module.exports = {
  isConfigured, startSignup, startAdministratorSignup, handleTilopayReturn, provisionOrganization, generateOrganizationCode,
  listPendingSignups, approveSignup, rejectSignup, recoverStuckProvisioningSignups,
};
