// tests/analyticsAndPortal.integration.test.js
//
// Real integration test (real MongoDB) for the issuer analytics
// aggregation and the public recipient portal — both built on MongoDB
// aggregation/queries, not a new database engine.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongod;

function responseDouble() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

async function issueCredential(orgCode, achieverUsername, title) {
  const { createCredential } = require('../controllers/credentialController');
  const req = {
    user: { organization_code: orgCode, username: 'admin' },
    body: {
      credential_pic_url: 'http://localhost:9000/uploads/cert.png',
      achiever_username: achieverUsername,
      credential_title: title,
      guest_recipient: { email: `${achieverUsername.toLowerCase()}@example.com`, first_name: achieverUsername, last_name: 'Test' },
    },
  };
  const res = responseDouble();
  await createCredential(req, res);
  assert.equal(res.statusCode, 201);
  return res.body.credential_code;
}

test('getOrganizationAnalytics reports correct totals, status breakdown, and top programs', async () => {
  const { getOrganizationAnalytics } = require('../controllers/credentialController');
  const Organization = require('../models/organization_schema');
  await Organization.findOneAndUpdate(
    { organization_code: 'ANALYTICS-ORG' },
    { organization_code: 'ANALYTICS-ORG', name: 'Analytics Org', city: 'C', state: 'S', country: 'Country', email: 'a@example.com', phone: '555', status: 'ACTIVE' },
    { upsert: true }
  );
  await issueCredential('ANALYTICS-ORG', 'Person1', 'Course A');
  await issueCredential('ANALYTICS-ORG', 'Person2', 'Course A');
  await issueCredential('ANALYTICS-ORG', 'Person3', 'Course B');

  const req = { params: { organization_code: 'ANALYTICS-ORG' } };
  const res = responseDouble();
  await getOrganizationAnalytics(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total_issued, 3);
  assert.equal(res.body.by_status.Issued, 3);
  const courseA = res.body.top_programs.find((p) => p.credential_title === 'Course A');
  assert.equal(courseA.count, 2);
  assert.equal(res.body.total_verifications, 0); // no one has viewed the verification page yet
  assert.equal(res.body.verification_rate, 0);
});

test('getOrganizationAnalytics only counts credentials from the requested organization', async () => {
  const { getOrganizationAnalytics } = require('../controllers/credentialController');
  const Organization = require('../models/organization_schema');
  await Organization.findOneAndUpdate(
    { organization_code: 'ANALYTICS-ORG-OTHER' },
    { organization_code: 'ANALYTICS-ORG-OTHER', name: 'Other Org', city: 'C', state: 'S', country: 'Country', email: 'other@example.com', phone: '555', status: 'ACTIVE' },
    { upsert: true }
  );
  await issueCredential('ANALYTICS-ORG-OTHER', 'PersonX', 'Course X');

  const req = { params: { organization_code: 'ANALYTICS-ORG-OTHER' } };
  const res = responseDouble();
  await getOrganizationAnalytics(req, res);

  assert.equal(res.body.total_issued, 1); // not 4 — ANALYTICS-ORG's credentials must not leak in
});

test('verification views are logged and reflected in total_verifications / verification_rate', async () => {
  const { getCredentialByCode, getOrganizationAnalytics } = require('../controllers/credentialController');
  const Organization = require('../models/organization_schema');
  await Organization.findOneAndUpdate(
    { organization_code: 'VERIFY-ORG' },
    { organization_code: 'VERIFY-ORG', name: 'Verify Org', city: 'C', state: 'S', country: 'Country', email: 'v@example.com', phone: '555', status: 'ACTIVE' },
    { upsert: true }
  );
  const code = await issueCredential('VERIFY-ORG', 'VerifyPerson', 'Course V');

  // Three separate "someone checked this credential" views.
  for (let i = 0; i < 3; i++) {
    const req = { params: { credential_code: code } };
    const res = responseDouble();
    await getCredentialByCode(req, res);
    assert.equal(res.statusCode, 200);
  }

  // The write is fire-and-forget (non-blocking, by design -- see
  // getCredentialByCode) so it can genuinely still be in flight here.
  // A single setImmediate/tick delay was flaky under load (caught by
  // repeated real runs, not assumed) -- poll for the actual documents to
  // exist instead of guessing at timing.
  const CredentialVerificationLog = require('../models/credentialVerificationLog');
  const deadline = Date.now() + 2000;
  let logged = 0;
  while (Date.now() < deadline) {
    logged = await CredentialVerificationLog.countDocuments({ credential_code: code });
    if (logged >= 3) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(logged, 3, 'verification log writes did not land within the timeout');

  const req = { params: { organization_code: 'VERIFY-ORG' } };
  const res = responseDouble();
  await getOrganizationAnalytics(req, res);
  assert.equal(res.body.total_verifications, 3);
  assert.equal(res.body.verification_rate, 3); // 3 verifications / 1 credential issued
});

test('the public portal returns 404 for a username with no Claimed credentials', async () => {
  const { getPublicPortalByUsername } = require('../controllers/credentialController');
  const req = { params: { username: 'nobody-has-claimed-anything' } };
  const res = responseDouble();
  await getPublicPortalByUsername(req, res);
  assert.equal(res.statusCode, 404);
});

test('the public portal only shows Claimed credentials, not merely Issued ones', async () => {
  const { getPublicPortalByUsername, claimCredential } = require('../controllers/credentialController');
  const Organization = require('../models/organization_schema');
  await Organization.findOneAndUpdate(
    { organization_code: 'PORTAL-ORG' },
    { organization_code: 'PORTAL-ORG', name: 'Portal Org', city: 'C', state: 'S', country: 'Country', email: 'p@example.com', phone: '555', status: 'ACTIVE' },
    { upsert: true }
  );
  const unclaimedCode = await issueCredential('PORTAL-ORG', 'portalperson', 'Unclaimed Course');
  const toClaimCode = await issueCredential('PORTAL-ORG', 'portalperson', 'Claimed Course');

  // Not claimed yet — portal should be empty (404) at this point.
  let res = responseDouble();
  await getPublicPortalByUsername({ params: { username: 'portalperson' } }, res);
  assert.equal(res.statusCode, 404);

  // Claim only the second one, exactly the way a real recipient would
  // (their own authenticated session, matching achiever_username).
  const claimReq = { params: { credential_code: toClaimCode }, user: { organization_code: 'PORTAL-ORG', username: 'portalperson' } };
  const claimRes = responseDouble();
  await claimCredential(claimReq, claimRes);
  assert.equal(claimRes.statusCode, 200);

  res = responseDouble();
  await getPublicPortalByUsername({ params: { username: 'portalperson' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.credentials.length, 1);
  assert.equal(res.body.credentials[0].credential_code, toClaimCode);
  assert.equal(res.body.credentials[0].title, 'Claimed Course');
  // The unclaimed one from the same person must not appear.
  assert.ok(!res.body.credentials.some((c) => c.credential_code === unclaimedCode));
});

test('a Claimed credential defaults to portal_visible=true (existing recipients see no behavior change)', async () => {
  const { claimCredential } = require('../controllers/credentialController');
  const Credential = require('../models/credentialSchema');
  const Organization = require('../models/organization_schema');
  await Organization.findOneAndUpdate(
    { organization_code: 'DEFAULT-VIS-ORG' },
    { organization_code: 'DEFAULT-VIS-ORG', name: 'Default Vis Org', city: 'C', state: 'S', country: 'Country', email: 'd@example.com', phone: '555', status: 'ACTIVE' },
    { upsert: true }
  );
  const code = await issueCredential('DEFAULT-VIS-ORG', 'defaultvisperson', 'Course D');
  await claimCredential({ params: { credential_code: code }, user: { organization_code: 'DEFAULT-VIS-ORG', username: 'defaultvisperson' } }, responseDouble());
  const stored = await Credential.findOne({ credential_code: code });
  assert.equal(stored.portal_visible, true);
});

test('setPortalVisibility lets the recipient opt out, and the portal immediately stops showing that credential', async () => {
  const { claimCredential, setPortalVisibility, getPublicPortalByUsername } = require('../controllers/credentialController');
  const Organization = require('../models/organization_schema');
  await Organization.findOneAndUpdate(
    { organization_code: 'OPTOUT-ORG' },
    { organization_code: 'OPTOUT-ORG', name: 'Opt Out Org', city: 'C', state: 'S', country: 'Country', email: 'o@example.com', phone: '555', status: 'ACTIVE' },
    { upsert: true }
  );
  const code = await issueCredential('OPTOUT-ORG', 'optoutperson', 'Course O');
  const user = { organization_code: 'OPTOUT-ORG', username: 'optoutperson' };
  await claimCredential({ params: { credential_code: code }, user }, responseDouble());

  // Visible by default right after claiming.
  let portalRes = responseDouble();
  await getPublicPortalByUsername({ params: { username: 'optoutperson' } }, portalRes);
  assert.equal(portalRes.statusCode, 200);
  assert.equal(portalRes.body.credentials.length, 1);

  // Opt out.
  const hideRes = responseDouble();
  await setPortalVisibility({ params: { credential_code: code }, body: { visible: false }, user }, hideRes);
  assert.equal(hideRes.statusCode, 200);
  assert.equal(hideRes.body.portal_visible, false);

  portalRes = responseDouble();
  await getPublicPortalByUsername({ params: { username: 'optoutperson' } }, portalRes);
  assert.equal(portalRes.statusCode, 404); // no other visible credentials for this person

  // Opt back in.
  const showRes = responseDouble();
  await setPortalVisibility({ params: { credential_code: code }, body: { visible: true }, user }, showRes);
  assert.equal(showRes.body.portal_visible, true);

  portalRes = responseDouble();
  await getPublicPortalByUsername({ params: { username: 'optoutperson' } }, portalRes);
  assert.equal(portalRes.statusCode, 200);
});

test('setPortalVisibility rejects a caller who is not the credential\'s own recipient', async () => {
  const { claimCredential, setPortalVisibility } = require('../controllers/credentialController');
  const Organization = require('../models/organization_schema');
  await Organization.findOneAndUpdate(
    { organization_code: 'OWNERSHIP-ORG' },
    { organization_code: 'OWNERSHIP-ORG', name: 'Ownership Org', city: 'C', state: 'S', country: 'Country', email: 'ow@example.com', phone: '555', status: 'ACTIVE' },
    { upsert: true }
  );
  const code = await issueCredential('OWNERSHIP-ORG', 'realowner', 'Course Owned');
  await claimCredential({ params: { credential_code: code }, user: { organization_code: 'OWNERSHIP-ORG', username: 'realowner' } }, responseDouble());

  const impostorRes = responseDouble();
  await setPortalVisibility(
    { params: { credential_code: code }, body: { visible: false }, user: { organization_code: 'OWNERSHIP-ORG', username: 'someone-else' } },
    impostorRes
  );
  assert.equal(impostorRes.statusCode, 404); // same "not found" as claimCredential's own ownership check — no oracle for "this credential exists but isn't yours"
});

test('setPortalVisibility rejects an unclaimed credential and a non-boolean "visible" value', async () => {
  const { setPortalVisibility } = require('../controllers/credentialController');
  const Organization = require('../models/organization_schema');
  await Organization.findOneAndUpdate(
    { organization_code: 'UNCLAIMED-VIS-ORG' },
    { organization_code: 'UNCLAIMED-VIS-ORG', name: 'Unclaimed Vis Org', city: 'C', state: 'S', country: 'Country', email: 'u@example.com', phone: '555', status: 'ACTIVE' },
    { upsert: true }
  );
  const code = await issueCredential('UNCLAIMED-VIS-ORG', 'unclaimedvisperson', 'Course U');
  const user = { organization_code: 'UNCLAIMED-VIS-ORG', username: 'unclaimedvisperson' };

  const badTypeRes = responseDouble();
  await setPortalVisibility({ params: { credential_code: code }, body: { visible: 'yes' }, user }, badTypeRes);
  assert.equal(badTypeRes.statusCode, 400);

  const unclaimedRes = responseDouble();
  await setPortalVisibility({ params: { credential_code: code }, body: { visible: false }, user }, unclaimedRes);
  assert.equal(unclaimedRes.statusCode, 400);
  assert.match(unclaimedRes.body.message, /Claimed/);
});
