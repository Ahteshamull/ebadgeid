// tests/selfServiceSignup.integration.test.js
//
// Real MongoDB (a real replica set -- see below for why), real bcrypt
// hashing. Paid self-service signup goes through Tilopay
// (services/tilopayClient.js) instead of Stripe -- see that file's header
// comment for the real, documented API contract this was built against
// (https://documenter.getpostman.com/view/12758640/TVKA5KUT), and for the
// one genuine, externally-imposed limitation this flow lives with:
// Tilopay's return redirect has no publicly documented signature to
// verify, unlike Stripe's webhook signing. That is exactly why a browser
// return here NEVER provisions an organization by itself -- see
// services/selfServiceSignup.js's handleTilopayReturn header comment.
// Manual review (approveSignup/rejectSignup below) is the only path that
// actually completes a paid signup.
//
// MongoMemoryReplSet, not a plain MongoMemoryServer: provisionOrganization
// uses a real multi-document Mongo transaction (Organization.startSession()
// + session.withTransaction()) so an organization and its first admin are
// created atomically -- transactions require a replica set (see
// organizationPurge.integration.test.js / scoreApprovalConcurrency.
// integration.test.js for the same requirement elsewhere in this suite).
//
// Network calls to the real Tilopay API are split two ways:
//   - The real login call (tilopayClient.getAccessToken) is safe, free,
//     and side-effect-free (it only returns a token, no transaction is
//     created) -- it runs for real whenever TILOPAY_API_USER/PASSWORD/KEY
//     are configured, same self-skip-if-unconfigured pattern as
//     tests/openRouterRealProvider... in help_backend.
//   - createPayment (which WOULD create a real pending transaction at
//     Tilopay for every test run) is stubbed for the tests that only need
//     to prove this codebase's own logic (payload shape, PendingOrgSignup
//     bookkeeping, idempotency) -- not repeated here on every `npm test`.
//
// Outbound email (onboarding-request + customer-confirmation) is stubbed
// via testHelpers/stubEmailTransport.js so no test ever opens a real SMTP
// connection through the real info@ebadgeid.com mailbox.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { stubEmailTransport } = require('./testHelpers/stubEmailTransport');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';
process.env.ONBOARDING_NOTIFICATION_EMAIL = process.env.ONBOARDING_NOTIFICATION_EMAIL || 'sales@ebadgeid.test';

let replSet;
let app;
let emailStub;

const VALID_BILLING = { address: 'San Jose', address2: 'Catedral', state: 'CR-SJ', zip: '10061', telephone: '88888888' };

function platformAdminToken() {
  return jwt.sign(
    { id: crypto.randomUUID(), username: 'platform_admin_selfsignup', role: 'platform_admin', organization_code: 'ORG-SELFSIGNUP-PLATFORM' },
    process.env.JWT_SECRET,
    { algorithm: 'HS256' }
  );
}

test.before(async () => {
  emailStub = stubEmailTransport();
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  ({ app } = require('../api.js'));

  const Plan = require('../models/plan_schema');
  const { DEFAULT_PLANS } = require('../models/plan_schema');
  for (const plan of DEFAULT_PLANS) {
    await Plan.findOneAndUpdate({ name: plan.name }, plan, { upsert: true });
  }
  // A real paid tier for this test run, distinct from the seeded
  // price_cents: null defaults -- pricing itself is still the business's
  // call in production, this is just what makes the "paid plan" branch
  // of the code exercisable at all.
  await Plan.findOneAndUpdate({ name: 'Premium' }, { price_cents: 9900 });
});

test.after(async () => {
  emailStub.restore();
  await mongoose.disconnect();
  await replSet.stop();
});

test('POST /api/organizations/self-signup provisions a real organization and admin immediately for the Free plan', async () => {
  const res = await request(app)
    .post('/api/organizations/self-signup')
    .send({
      organization: { name: 'Acme Self-Signup Co', city: 'City', state: 'State', country: 'PY', email: 'acme@example.test', phone: '0000000' },
      plan_name: 'Free',
      admin: { username: 'acme_selfsignup_admin', password: 'SelfSignup123!', first_name: 'Acme', last_name: 'Admin', email: 'admin@acme.test' },
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'created');
  assert.ok(res.body.organization_code);

  const Organization = require('../models/organization_schema');
  const org = await Organization.findOne({ organization_code: res.body.organization_code });
  assert.ok(org);
  assert.equal(org.plan, 'Free');
  assert.equal(org.status, 'ACTIVE');

  const AuthCredentials = require('../models/AuthCredentials');
  const auth = await AuthCredentials.findOne({ username: 'acme_selfsignup_admin' }).select('+password');
  assert.ok(auth);
  assert.equal(auth.user_role, 'admin');
  assert.notEqual(auth.password, 'SelfSignup123!', 'the password must be hashed, never stored in plain text');

  const bcrypt = require('bcryptjs');
  assert.equal(await bcrypt.compare('SelfSignup123!', auth.password), true);

  const Users = require('../models/user_model');
  const profile = await Users.findOne({ username: 'acme_selfsignup_admin' });
  assert.equal(profile.organization_code, res.body.organization_code);
  assert.equal(profile.status, 'pending_activation', 'a new administrator must not receive a usable session before activation');
});

test('POST /api/organizations/administrator-signup stores a bcrypt password, sends the branded activation email, and only then permits login', async () => {
  const email = `admin-${crypto.randomBytes(4).toString('hex')}@example.test`;
  const password = 'AdministratorPassword123!';
  const signup = await request(app).post('/api/organizations/administrator-signup').send({
    first_name: 'Ada', last_name: 'Administrator', email, designation: 'Director',
    organization_name: 'Activation Flow Co', password, confirm_password: password,
    phone: '88888888', city: 'San Jose', state: 'SJ', country: 'CR',
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  assert.equal(signup.body.status, 'activation_required');

  const mail = emailStub.sent[emailStub.sent.length - 1];
  assert.equal(mail.to, email);
  assert.equal(mail.subject, 'Welcome to eBadge | Your Administrator Account Is Ready');
  assert.match(mail.html, /logo\.webp/);
  assert.match(mail.html, />Activate Account</);
  const tokenMatch = mail.html.match(/auth\/activate#username=[^&]+&token=([^&"\s]+)/);
  assert.ok(tokenMatch, 'activation email must contain a fragment token');
  const token = decodeURIComponent(tokenMatch[1]);

  const AuthCredentials = require('../models/AuthCredentials');
  const pendingAuth = await AuthCredentials.findOne({ username: email }).select('+password +activation_token_hash +activation_password_preselected');
  assert.ok(pendingAuth.activation_token_hash, 'only a hash of the activation token is stored');
  assert.equal(pendingAuth.activation_password_preselected, true);
  assert.equal(await bcrypt.compare(password, pendingAuth.password), true);
  assert.equal((await request(app).post('/api/auth/login').send({ username: email, password })).status, 400);

  const activation = await request(app).post('/api/auth/activate').send({ username: email, token });
  assert.equal(activation.status, 200, JSON.stringify(activation.body));
  assert.equal((await request(app).post('/api/auth/activate').send({ username: email, token })).status, 400, 'token must be single-use');
  const login = await request(app).post('/api/auth/login').send({ username: email, password });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(typeof login.body.csrfToken, 'string', 'successful login rotates and returns the next synchronizer token');
});

// Security regression test -- reproduced live during an audit round: this
// used to be inferred from `!plan.price_cents`, so ANY paid plan that
// simply hadn't had a real price configured yet (the normal state right
// after a fresh deploy -- pricing is a business decision made after
// deploy, not at seed time) fell through to the free/immediate branch.
// Enterprise (unlimited users/credentials/API calls) with price_cents:
// null -- the exact seeded default -- provisioned for free, no payment,
// no platform_admin approval. This must stay a hard 503, never silently
// fall back to free, for every plan that isn't explicitly is_free:true.
test('POST /api/organizations/self-signup refuses a non-free plan that has no price configured, instead of silently provisioning it for free', async () => {
  const Plan = require('../models/plan_schema');
  const before = await Plan.findOne({ name: 'Enterprise' });
  assert.equal(before.is_free, false, 'Enterprise must not be seeded as free');
  assert.equal(before.price_cents, null, 'reproduces the exact seeded state that was exploitable: is_free:false with no price set');

  const res = await request(app)
    .post('/api/organizations/self-signup')
    .send({
      organization: { name: 'Should Never Provision Co', city: 'C', state: 'S', country: 'PY', email: 'no-free-lunch@example.test', phone: '0' },
      plan_name: 'Enterprise',
      admin: { username: 'should_never_provision_admin', password: 'ShouldNever123!', first_name: 'N', last_name: 'P', email: 'n@example.test' },
    });

  assert.equal(res.status, 503, JSON.stringify(res.body));
  assert.match(res.body.message, /not yet configured with a price/i);

  const Organization = require('../models/organization_schema');
  assert.equal(await Organization.countDocuments({ name: 'Should Never Provision Co' }), 0, 'must never have been provisioned');
  const AuthCredentials = require('../models/AuthCredentials');
  assert.equal(await AuthCredentials.findOne({ username: 'should_never_provision_admin' }), null, 'the admin account must never have been created either');
});

test('POST /api/organizations/self-signup rejects a duplicate admin username', async () => {
  const payload = {
    organization: { name: 'Dup Co', city: 'C', state: 'S', country: 'PY', email: 'dup@example.test', phone: '0' },
    plan_name: 'Free',
    admin: { username: 'dup_signup_admin', password: 'DupSignup123!', first_name: 'D', last_name: 'A', email: 'd@example.test' },
  };
  const first = await request(app).post('/api/organizations/self-signup').send(payload);
  assert.equal(first.status, 201);

  const second = await request(app).post('/api/organizations/self-signup').send({
    ...payload,
    organization: { ...payload.organization, name: 'Dup Co Two', email: 'dup2@example.test' },
  });
  assert.equal(second.status, 409);
});

test('POST /api/organizations/self-signup for a paid plan returns 503 cleanly when Tilopay is not configured', async () => {
  const saved = { u: process.env.TILOPAY_API_USER, p: process.env.TILOPAY_API_PASSWORD, k: process.env.TILOPAY_API_KEY };
  delete process.env.TILOPAY_API_USER;
  delete process.env.TILOPAY_API_PASSWORD;
  delete process.env.TILOPAY_API_KEY;
  try {
    const res = await request(app)
      .post('/api/organizations/self-signup')
      .send({
        organization: { name: 'Paid Co Unconfigured', city: 'C', state: 'S', country: 'PY', email: 'paidu@example.test', phone: '0' },
        plan_name: 'Premium',
        admin: { username: 'paid_unconfigured_admin', password: 'PaidSignup123!', first_name: 'P', last_name: 'A', email: 'p@example.test' },
        billing: VALID_BILLING,
      });
    assert.equal(res.status, 503);

    const Organization = require('../models/organization_schema');
    assert.equal(await Organization.countDocuments({ name: 'Paid Co Unconfigured' }), 0, 'nothing must be provisioned when payment was never actually configured/collected');
  } finally {
    if (saved.u) process.env.TILOPAY_API_USER = saved.u;
    if (saved.p) process.env.TILOPAY_API_PASSWORD = saved.p;
    if (saved.k) process.env.TILOPAY_API_KEY = saved.k;
  }
});

test('POST /api/organizations/self-signup for a paid plan rejects missing billing fields with 400', async () => {
  process.env.TILOPAY_API_USER = process.env.TILOPAY_API_USER || 'test-user';
  process.env.TILOPAY_API_PASSWORD = process.env.TILOPAY_API_PASSWORD || 'test-password';
  process.env.TILOPAY_API_KEY = process.env.TILOPAY_API_KEY || 'test-key';
  const res = await request(app)
    .post('/api/organizations/self-signup')
    .send({
      organization: { name: 'No Billing Co', city: 'C', state: 'S', country: 'PY', email: 'nobilling@example.test', phone: '0' },
      plan_name: 'Premium',
      admin: { username: 'no_billing_admin', password: 'NoBilling123!', first_name: 'N', last_name: 'B', email: 'n@example.test' },
      // billing intentionally omitted
    });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /billing/i);
});

test('POST /api/organizations/self-signup for a paid plan creates a real PendingOrgSignup (with the expected amount/currency to verify later) and calls Tilopay with the correct amount/currency (createPayment stubbed, no real transaction created)', async () => {
  const tilopayClient = require('../services/tilopayClient');
  const originalCreatePayment = tilopayClient.createPayment;
  let capturedPayload = null;
  tilopayClient.createPayment = async (payload) => {
    capturedPayload = payload;
    return { url: 'https://secure.tilopay.com/htmls/stubbed-test-payment-page.html', type: '100' };
  };
  delete require.cache[require.resolve('../services/selfServiceSignup')];

  try {
    const res = await request(app)
      .post('/api/organizations/self-signup')
      .send({
        organization: { name: 'Tilopay Flow Co', city: 'JS', state: 'SJ', country: 'CR', email: 'tilopayflow@example.test', phone: '0' },
        plan_name: 'Premium',
        admin: { username: 'tilopay_flow_admin', password: 'TilopayFlow123!', first_name: 'T', last_name: 'F', email: 't@example.test' },
        billing: VALID_BILLING,
      });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'payment_required');
    assert.equal(res.body.paymentUrl, 'https://secure.tilopay.com/htmls/stubbed-test-payment-page.html');

    assert.equal(capturedPayload.amount, '99.00', 'price_cents: 9900 must convert to a real 2-decimal amount string');
    assert.equal(capturedPayload.currency, 'USD');
    assert.match(capturedPayload.redirect, /\/api\/organizations\/self-signup\/tilopay-return$/);
    assert.equal(capturedPayload.billTo.address, VALID_BILLING.address);
    assert.equal(capturedPayload.billTo.email, 't@example.test');
    assert.match(capturedPayload.orderNumber, /^EBID-[0-9A-F]{20}$/, 'the order reference must be a real random token, never sequential/guessable');

    const PendingOrgSignup = require('../models/pendingOrgSignup');
    const pending = await PendingOrgSignup.findOne({ payment_reference: capturedPayload.orderNumber });
    assert.ok(pending, 'a real PendingOrgSignup row must exist, keyed by the same reference sent to Tilopay');
    assert.equal(pending.status, 'pending');
    assert.equal(pending.plan_name, 'Premium');
    assert.equal(pending.expected_amount_cents, 9900, 'the amount a future manual approval must be checked against has to be recorded up front, not trusted from the approval request itself');
    assert.equal(pending.expected_currency, 'USD');

    const Organization = require('../models/organization_schema');
    assert.equal(await Organization.countDocuments({ name: 'Tilopay Flow Co' }), 0, 'must never provision optimistically before a platform_admin manually confirms the payment');
  } finally {
    tilopayClient.createPayment = originalCreatePayment;
    delete require.cache[require.resolve('../services/selfServiceSignup')];
  }
});

test('GET /api/organizations/self-signup/tilopay-return with code=1 never auto-provisions -- it only moves the pending record to awaiting_verification and notifies onboarding', async () => {
  const PendingOrgSignup = require('../models/pendingOrgSignup');
  const bcrypt = require('bcryptjs');
  await PendingOrgSignup.create({
    payment_reference: 'EBID-TESTAPPROVED0001',
    organization: { name: 'Return Flow Co', city: 'C', state: 'S', country: 'PY', email: 'returnflow@example.test', phone: '0' },
    plan_name: 'Premium',
    expected_amount_cents: 9900,
    expected_currency: 'USD',
    admin: { username: 'return_flow_admin', password_hash: await bcrypt.hash('ReturnFlow123!', 10), first_name: 'R', last_name: 'F', email: 'r@example.test' },
    status: 'pending',
  });

  const res = await request(app)
    .get('/api/organizations/self-signup/tilopay-return')
    .query({ code: '1', order: 'EBID-TESTAPPROVED0001' });

  assert.equal(res.status, 302);
  assert.match(res.headers.location, /\/auth\/self_signup\?signup=payment_verification_pending$/, 'an approved-looking browser redirect must never claim success -- see handleTilopayReturn header comment on why this is not payment proof');

  const Organization = require('../models/organization_schema');
  assert.equal(await Organization.countDocuments({ name: 'Return Flow Co' }), 0, 'a browser redirect alone must never provision an organization');

  const updatedPending = await PendingOrgSignup.findOne({ payment_reference: 'EBID-TESTAPPROVED0001' });
  assert.equal(updatedPending.status, 'awaiting_verification');
  assert.ok(updatedPending.onboarding_notified_at, 'the sales/onboarding lead notification must have been sent (and recorded) exactly once');
  assert.ok(updatedPending.customer_onboarding_notified_at, 'the customer acknowledgement must have been sent (and recorded) exactly once');

  const onboardingMail = emailStub.sent.find(m => m.to === process.env.ONBOARDING_NOTIFICATION_EMAIL && m.subject.includes('Return Flow Co'));
  assert.ok(onboardingMail, 'a real onboarding-request email must have gone through the stubbed transporter');
  const customerMail = emailStub.sent.find(m => m.to === 'r@example.test');
  assert.ok(customerMail, 'a real customer acknowledgement email must have gone through the stubbed transporter');
});

test('GET /api/organizations/self-signup/tilopay-return is idempotent — replaying the same approved return does not provision anything or send duplicate notifications', async () => {
  const sentBefore = emailStub.sent.length;

  const res = await request(app)
    .get('/api/organizations/self-signup/tilopay-return')
    .query({ code: '1', order: 'EBID-TESTAPPROVED0001' });
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /\/auth\/self_signup\?signup=payment_verification_pending$/);

  const Organization = require('../models/organization_schema');
  assert.equal(await Organization.countDocuments({ name: 'Return Flow Co' }), 0);

  assert.equal(emailStub.sent.length, sentBefore, 'a replayed redirect must not re-send the onboarding/customer notification emails');
});

test('GET /api/organizations/self-signup/tilopay-return with a non-1 code never provisions anything, and marks the pending record failed', async () => {
  const PendingOrgSignup = require('../models/pendingOrgSignup');
  const bcrypt = require('bcryptjs');
  await PendingOrgSignup.create({
    payment_reference: 'EBID-TESTDECLINED0001',
    organization: { name: 'Declined Flow Co', city: 'C', state: 'S', country: 'PY', email: 'declinedflow@example.test', phone: '0' },
    plan_name: 'Premium',
    expected_amount_cents: 9900,
    expected_currency: 'USD',
    admin: { username: 'declined_flow_admin', password_hash: await bcrypt.hash('DeclinedFlow123!', 10), first_name: 'D', last_name: 'F', email: 'd2@example.test' },
    status: 'pending',
  });

  const res = await request(app)
    .get('/api/organizations/self-signup/tilopay-return')
    .query({ code: '2', order: 'EBID-TESTDECLINED0001' });

  assert.equal(res.status, 302);
  assert.match(res.headers.location, /\/auth\/self_signup\?signup=payment_not_approved$/);

  const Organization = require('../models/organization_schema');
  assert.equal(await Organization.countDocuments({ name: 'Declined Flow Co' }), 0);

  const pending = await PendingOrgSignup.findOne({ payment_reference: 'EBID-TESTDECLINED0001' });
  assert.equal(pending.status, 'failed');
});

test('GET /api/organizations/self-signup/tilopay-return with an unknown order reference redirects without provisioning or crashing', async () => {
  const res = await request(app)
    .get('/api/organizations/self-signup/tilopay-return')
    .query({ code: '1', order: 'EBID-DOES-NOT-EXIST-AT-ALL' });
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /\/auth\/self_signup\?signup=unknown_reference$/);
});

// The other half of the fix: since a browser redirect never completes a
// paid signup any more, something has to. These routes (organizationRoutes.js)
// are what lets a platform_admin actually finish it after checking
// Tilopay's own dashboard.
test('GET /api/organizations/self-signup/pending requires platform_admin auth and lists awaiting_verification signups', async () => {
  const unauth = await request(app).get('/api/organizations/self-signup/pending');
  assert.equal(unauth.status, 401);

  const res = await request(app)
    .get('/api/organizations/self-signup/pending')
    .set('Authorization', `Bearer ${platformAdminToken()}`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.pending));
  const refs = res.body.pending.map(p => p.payment_reference);
  assert.ok(refs.includes('EBID-TESTAPPROVED0001'), 'the still-awaiting-verification record from the earlier test must show up in the review queue');
  assert.ok(!refs.includes('EBID-TESTDECLINED0001'), 'a failed record must not show up in the default awaiting_verification queue');

  const reviewedRecord = res.body.pending.find(p => p.payment_reference === 'EBID-TESTAPPROVED0001');
  assert.equal(reviewedRecord.admin.email, 'r@example.test', 'the reviewer needs to see who they would be approving');
  assert.equal(reviewedRecord.admin.password_hash, undefined, 'the admin\'s password hash must never be exposed to this endpoint, even though it had to be re-selected to read the contact fields');
});

test('POST /api/organizations/self-signup/pending/:id/approve rejects a verified amount/currency that does not match what was actually quoted, and leaves the record awaiting_verification', async () => {
  const PendingOrgSignup = require('../models/pendingOrgSignup');
  const pending = await PendingOrgSignup.findOne({ payment_reference: 'EBID-TESTAPPROVED0001' });

  const res = await request(app)
    .post(`/api/organizations/self-signup/pending/${pending._id}/approve`)
    .set('Authorization', `Bearer ${platformAdminToken()}`)
    .send({ evidence_reference: 'TILOPAY-TXN-MISMATCH', verified_amount_cents: 100, verified_currency: 'USD' });

  assert.equal(res.status, 409);

  const Organization = require('../models/organization_schema');
  assert.equal(await Organization.countDocuments({ name: 'Return Flow Co' }), 0, 'a mismatched amount must never provision');

  const stillPending = await PendingOrgSignup.findById(pending._id);
  assert.equal(stillPending.status, 'awaiting_verification', 'a rejected mismatch must roll back to awaiting_verification, not get stuck at provisioning');
});

test('POST /api/organizations/self-signup/pending/:id/approve with a matching verified amount/currency provisions the organization for real', async () => {
  const PendingOrgSignup = require('../models/pendingOrgSignup');
  const pending = await PendingOrgSignup.findOne({ payment_reference: 'EBID-TESTAPPROVED0001' });

  const res = await request(app)
    .post(`/api/organizations/self-signup/pending/${pending._id}/approve`)
    .set('Authorization', `Bearer ${platformAdminToken()}`)
    .send({ evidence_reference: 'TILOPAY-TXN-REAL-000123', verified_amount_cents: 9900, verified_currency: 'USD', note: 'Confirmed in Tilopay dashboard' });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.organization_code);

  const Organization = require('../models/organization_schema');
  const org = await Organization.findOne({ organization_code: res.body.organization_code });
  assert.ok(org, 'a real, manually-approved payment must actually provision the organization');
  assert.equal(org.name, 'Return Flow Co');
  assert.equal(org.plan, 'Premium');

  const AuthCredentials = require('../models/AuthCredentials');
  const auth = await AuthCredentials.findOne({ username: 'return_flow_admin' });
  assert.ok(auth, 'the admin captured at signup time must be provisioned once approved');

  const completed = await PendingOrgSignup.findById(pending._id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.organization_code, res.body.organization_code);
  assert.equal(completed.manual_verification.verified_by, 'platform_admin_selfsignup');
  assert.equal(completed.manual_verification.evidence_reference, 'TILOPAY-TXN-REAL-000123');

  const second = await request(app)
    .post(`/api/organizations/self-signup/pending/${pending._id}/approve`)
    .set('Authorization', `Bearer ${platformAdminToken()}`)
    .send({ evidence_reference: 'TILOPAY-TXN-REAL-000123-DUP', verified_amount_cents: 9900, verified_currency: 'USD' });
  assert.equal(second.status, 404, 'a record that is already completed is no longer awaiting_verification -- a second approve attempt must not be able to claim/double-provision it');
});

test('POST /api/organizations/self-signup/pending/:id/reject marks the record failed without provisioning anything', async () => {
  const PendingOrgSignup = require('../models/pendingOrgSignup');
  const bcrypt = require('bcryptjs');
  const rejected = await PendingOrgSignup.create({
    payment_reference: 'EBID-TESTREJECT0001',
    organization: { name: 'Reject Flow Co', city: 'C', state: 'S', country: 'PY', email: 'rejectflow@example.test', phone: '0' },
    plan_name: 'Premium',
    expected_amount_cents: 9900,
    expected_currency: 'USD',
    admin: { username: 'reject_flow_admin', password_hash: await bcrypt.hash('RejectFlow123!', 10), first_name: 'X', last_name: 'Y', email: 'x@example.test' },
    status: 'awaiting_verification',
  });

  const res = await request(app)
    .post(`/api/organizations/self-signup/pending/${rejected._id}/reject`)
    .set('Authorization', `Bearer ${platformAdminToken()}`)
    .send({ note: 'No matching transaction found in Tilopay dashboard' });

  assert.equal(res.status, 200);

  const Organization = require('../models/organization_schema');
  assert.equal(await Organization.countDocuments({ name: 'Reject Flow Co' }), 0);

  const updated = await PendingOrgSignup.findById(rejected._id);
  assert.equal(updated.status, 'failed');
  assert.equal(updated.manual_verification.verified_by, 'platform_admin_selfsignup');
});

test('the real Tilopay credentials actually authenticate (real network call to POST /login -- safe, free, no transaction created)', async (t) => {
  if (!process.env.TILOPAY_API_USER || process.env.TILOPAY_API_USER === 'test-user') {
    return t.skip('real TILOPAY_API_USER/PASSWORD not configured in this environment');
  }
  const tilopayClient = require('../services/tilopayClient');
  tilopayClient._resetTokenCacheForTests();
  const token = await tilopayClient.getAccessToken();
  assert.equal(typeof token, 'string');
  assert.ok(token.length > 20, 'a real bearer token must be a real, non-trivial JWT string');
});
