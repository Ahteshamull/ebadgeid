// tests/bulkIssuanceIdempotency.integration.test.js
//
// BullMQ retries a failed bulk-issuance job up to three times, and a job
// can fail AFTER createCredential already wrote the credential document --
// a process restart or a deploy between the write and the ack is enough.
// Before bulk_issuance_key existed, that retry issued a SECOND credential
// to the same person for the same batch: a duplicate certificate, a second
// email to the recipient, and another credential spent from the monthly
// plan quota.
//
// These drive createCredential directly, the same way the worker does
// (queues/bulkIssuanceWorker.js builds a synthetic req/res and calls the
// real controller), because that is where the guarantee has to hold.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { stubEmailTransport } = require('./testHelpers/stubEmailTransport');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only_min_32';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';
process.env.CREDENTIAL_IMAGE_ALLOWED_ORIGINS = process.env.CREDENTIAL_IMAGE_ALLOWED_ORIGINS || 'http://localhost:9000';

const ORG = 'ORG-IDEMPOTENT';
let mongod;
let emailStub;
let credentialController;
let Credential;
let StoredFile;

const mockRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
};

// createCredential requires the image to be a real managed-storage file
// owned by the caller's organization (utils/managedStorage.js). The test
// registers one properly rather than weakening that check -- and uses the
// /api/files/ form, not the legacy /uploads/ one, so ownership is actually
// evaluated instead of being waived as a legacy file.
const registerImage = async (label, organization_code = ORG) => {
  const storage_key = `${crypto.createHash('md5').update(label).digest('hex')}.png`;
  await StoredFile.create({
    storage_key,
    organization_code,
    mime_type: 'image/png',
    size_bytes: 100,
    sha256: crypto.createHash('sha256').update(label).digest('hex'),
    visibility: 'private',
    purpose: 'upload',
  });
  return `${process.env.PUBLIC_STORAGE_BASE_URL}/api/files/${storage_key}`;
};

const issue = async (body) => {
  const res = mockRes();
  await credentialController.createCredential(
    { body, user: { username: 'bulk_admin', organization_code: ORG } },
    res,
  );
  return res;
};

test.before(async () => {
  emailStub = stubEmailTransport();
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  credentialController = require('../controllers/credentialController');
  Credential = require('../models/credentialSchema');
  StoredFile = require('../models/StoredFile');
  const Organization = require('../models/organization_schema');
  const Users = require('../models/user_model');

  // The unique index is what actually enforces this, so it has to be built
  // rather than assumed -- mongoose only creates indexes in the background.
  await Credential.syncIndexes();

  await Organization.create({
    organization_code: ORG, name: 'Idempotent Co', city: 'C', state: 'S', country: 'CR',
    email: 'idem@test.local', phone: '0', status: 'ACTIVE', plan: 'Free',
  });
  await Users.create({
    username: 'recipient1', organization_code: ORG,
    first_name: 'Ada', last_name: 'Lovelace', email: 'ada@test.local',
    designation: 'Engineer', city: 'C', state: 'S', country: 'CR', phone: '0', status: 'ACTIVE',
  });
});

test.after(async () => {
  emailStub.restore();
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

test('re-running the same bulk job issues nothing new and returns the credential that already exists', async () => {
  const imageUrl = await registerImage('idem-1');
  const key = 'batch-abc:recipient1';

  const first = await issue({
    credential_pic_url: imageUrl, achiever_username: 'recipient1',
    credential_title: 'Course A', bulk_issuance_key: key,
  });
  assert.equal(first.statusCode, 201, JSON.stringify(first.body));

  // Exactly what a BullMQ retry of that job does.
  const retry = await issue({
    credential_pic_url: imageUrl, achiever_username: 'recipient1',
    credential_title: 'Course A', bulk_issuance_key: key,
  });

  assert.equal(retry.statusCode, 200, 'a retry must not be an error -- the queue would retry forever');
  assert.equal(retry.body.already_issued, true);
  assert.equal(retry.body.credential_code, first.body.credential_code, 'the retry must report the SAME credential');

  const issued = await Credential.countDocuments({ bulk_issuance_key: key });
  assert.equal(issued, 1, 'a retry created a duplicate credential');
});

test('two workers racing on the same job still produce exactly one credential', async () => {
  const imageUrl = await registerImage('idem-2');
  const key = 'batch-race:recipient1';

  // Both start before either finishes -- neither can see the other's write
  // when it does its own lookup, so only the unique index can decide.
  const [a, b] = await Promise.all([
    issue({ credential_pic_url: imageUrl, achiever_username: 'recipient1', credential_title: 'Course B', bulk_issuance_key: key }),
    issue({ credential_pic_url: imageUrl, achiever_username: 'recipient1', credential_title: 'Course B', bulk_issuance_key: key }),
  ]);

  assert.ok(![a.statusCode, b.statusCode].some((code) => code >= 400),
    `neither racer may error (got ${a.statusCode} and ${b.statusCode})`);
  const issued = await Credential.countDocuments({ bulk_issuance_key: key });
  assert.equal(issued, 1, 'a race produced two credentials for one job');

  // Both callers are told about the same credential, whichever won.
  assert.equal(a.body.credential_code, b.body.credential_code);
});

test('different recipients in the same batch each get their own credential', async () => {
  const imageUrl = await registerImage('idem-3');
  const Users = require('../models/user_model');
  await Users.create({
    username: 'recipient2', organization_code: ORG,
    first_name: 'Grace', last_name: 'Hopper', email: 'grace@test.local',
    designation: 'Engineer', city: 'C', state: 'S', country: 'CR', phone: '0', status: 'ACTIVE',
  });

  const one = await issue({ credential_pic_url: imageUrl, achiever_username: 'recipient1', credential_title: 'Course C', bulk_issuance_key: 'batch-multi:recipient1' });
  const two = await issue({ credential_pic_url: imageUrl, achiever_username: 'recipient2', credential_title: 'Course C', bulk_issuance_key: 'batch-multi:recipient2' });

  assert.equal(one.statusCode, 201);
  assert.equal(two.statusCode, 201);
  assert.notEqual(one.body.credential_code, two.body.credential_code);
  assert.equal(await Credential.countDocuments({ bulk_issuance_key: /^batch-multi:/ }), 2);
});

test('the same recipient in a DIFFERENT batch is issued again -- this is deduplication, not a block', () => {
  // Guards against over-correcting: an organization that legitimately runs
  // a second bulk issuance for the same person must not be silently
  // refused. Different batchId means a different key.
  return (async () => {
    const imageUrl = await registerImage('idem-4');
    const first = await issue({ credential_pic_url: imageUrl, achiever_username: 'recipient1', credential_title: 'Course D', bulk_issuance_key: 'batch-one:recipient1' });
    const second = await issue({ credential_pic_url: imageUrl, achiever_username: 'recipient1', credential_title: 'Course D', bulk_issuance_key: 'batch-two:recipient1' });
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 201, 'a later batch must still be able to issue to the same person');
    assert.notEqual(first.body.credential_code, second.body.credential_code);
  })();
});

test('single issuance is untouched -- no key, no constraint, no dedupe', async () => {
  const imageUrl = await registerImage('idem-5');
  const first = await issue({ credential_pic_url: imageUrl, achiever_username: 'recipient1', credential_title: 'Course E' });
  const second = await issue({ credential_pic_url: imageUrl, achiever_username: 'recipient1', credential_title: 'Course E' });

  assert.equal(first.statusCode, 201);
  // Issuing the same title twice by hand is a legitimate thing to do, and
  // the sparse index must not have quietly turned it into an error.
  assert.equal(second.statusCode, 201);
  assert.notEqual(first.body.credential_code, second.body.credential_code);
});

test('the key is scoped to the organization -- it cannot surface another tenant\'s credential', async () => {
  const Organization = require('../models/organization_schema');
  await Organization.create({
    organization_code: 'ORG-OTHER', name: 'Other Co', city: 'C', state: 'S', country: 'CR',
    email: 'other@test.local', phone: '0', status: 'ACTIVE', plan: 'Free',
  });
  const imageUrl = await registerImage('idem-6', ORG);
  const key = 'batch-tenant:recipient1';
  const mine = await issue({ credential_pic_url: imageUrl, achiever_username: 'recipient1', credential_title: 'Course F', bulk_issuance_key: key });
  assert.equal(mine.statusCode, 201, JSON.stringify(mine.body));

  // The other organization gets its OWN owned image, so if this test passes
  // it is because of the key scoping and not because the request was
  // refused earlier for using someone else's file.
  const theirImageUrl = await registerImage('idem-6-other', 'ORG-OTHER');
  const res = mockRes();
  await credentialController.createCredential(
    { body: { credential_pic_url: theirImageUrl, achiever_username: 'recipient1', credential_title: 'Course F', bulk_issuance_key: key },
      user: { username: 'other_admin', organization_code: 'ORG-OTHER' } },
    res,
  );
  assert.notEqual(res.body?.credential_code, mine.body.credential_code,
    'another organization was handed this credential through the shared key');
});
