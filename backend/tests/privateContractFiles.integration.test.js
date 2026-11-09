// tests/privateContractFiles.integration.test.js
//
// Audit finding fixed in this round: signContract used to accept any
// attachment_url a client supplied, and the storage service (storage.js)
// serves /uploads/* statically with no auth at all -- so a signed contract
// PDF stored there was reachable by anyone with the URL, no session
// required. Signed PDFs now live under PRIVATE_CONTRACT_DIR
// (/app/private-contracts, its own docker volume, never mounted under
// /uploads or exposed by any express.static call -- see api.js/storage.js),
// and the only way to read one back is the authenticated,
// permission-checked route this file exercises end to end: real multipart
// upload (controllers/uploadController.js's signedPdfUploadMiddleware),
// real signContract call recording that URL, real download, and the real
// negative cases (unauthenticated, cross-organization, a filename not
// actually referenced by that contract's own signed_copies).
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';
// Fixed on purpose, not left to derive from req.protocol/req.get('host'):
// supertest spins up a fresh ephemeral-port server for every single
// request(app) call, so the upload response's URL and the sign-time
// isPrivateSignedContractUrl check would otherwise compare two different
// ports and always fail to match -- a testing artifact, not a real
// production concern (a real deployment has one stable public host), but
// this is exactly why PUBLIC_API_BASE_URL should always be set for real.
process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL || 'https://api.example.test';

let mongod;
let app;

function tokenFor(orgCode, role, username) {
  return jwt.sign({ id: crypto.randomUUID(), username, role, organization_code: orgCode }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

// A buffer file-type's magic-byte sniffer recognizes as a real PDF
// (checkString('%PDF') -- see node_modules/file-type/source/index.js) --
// deliberately not a fully-structured PDF, since handleSignedPdfUpload
// only needs to prove out real MIME sniffing, not a real PDF parser.
const FAKE_PDF_BUFFER = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

async function makeContractWithParty(orgCode, creatorUsername, creatorEmail) {
  const DigitalContract = require('../models/digitalContract');
  const UserProfile = require('../models/user_model');
  await UserProfile.findOneAndUpdate(
    { username: creatorUsername },
    { username: creatorUsername, organization_code: orgCode, first_name: 'C', last_name: 'One', designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: creatorEmail, phone: '0', status: 'Active' },
    { upsert: true }
  );
  const code = `CONTRACT-PRIV-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  await DigitalContract.create({
    contract_code: code,
    contract_issue_date: new Date().toISOString().slice(0, 10),
    contract_status: 'active',
    contract_content_url: 'https://example.test/uploads/contract.pdf',
    contract_parties: [
      { party_name: 'Creator', party_side: 'issuer', party_role: 'admin', party_email: creatorEmail, status: 'accepted', accepted: true, contract_permissions: { view: true, write: true, update: true, add_discussion: true, add_timeline_event: true } },
    ],
    contract_security_hashes: 'test-hash',
    organization_code: orgCode,
    creator_username: creatorUsername,
    creator_details: { email: creatorEmail },
  });
  return code;
}

test('signed PDF upload -> sign -> download round-trips through the private, authenticated route (never through /uploads)', async () => {
  const ORG = 'ORG-PRIVATE-CONTRACT-FILES';
  const email = 'signer@example.test';
  const contractCode = await makeContractWithParty(ORG, 'private_files_signer', email);
  const token = tokenFor(ORG, 'admin', 'private_files_signer');

  const uploadRes = await request(app)
    .post(`/api/contracts/${contractCode}/signed-upload`)
    .set('Authorization', `Bearer ${token}`)
    .attach('file', FAKE_PDF_BUFFER, { filename: 'signed.pdf', contentType: 'application/pdf' });
  assert.equal(uploadRes.status, 201, JSON.stringify(uploadRes.body));
  assert.match(uploadRes.body.url, new RegExp(`/api/contracts/${contractCode}/private-files/signed-[a-f0-9]{32}\\.pdf$`), 'the returned URL must be the private, authenticated route -- never a /uploads URL');

  const signRes = await request(app)
    .post(`/api/contracts/${contractCode}/sign`)
    .set('Authorization', `Bearer ${token}`)
    .send({ attachment_url: uploadRes.body.url, attachment_name: 'signed.pdf' });
  assert.equal(signRes.status, 200, JSON.stringify(signRes.body));

  const filename = uploadRes.body.url.split('/').pop();
  const downloadRes = await request(app)
    .get(`/api/contracts/${contractCode}/private-files/${filename}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(downloadRes.status, 200);
  assert.equal(downloadRes.headers['content-type'], 'application/pdf');
  assert.match(downloadRes.headers['content-disposition'], /attachment/);
  assert.equal(downloadRes.headers['cache-control'], 'private, no-store');
  assert.ok(Buffer.from(downloadRes.body).equals(FAKE_PDF_BUFFER), 'the bytes served back must be exactly what was uploaded');

  const publicAttempt = await request(app).get(`/uploads/${filename}`);
  // Signed contract copies never live under the general uploads/ directory
  // that this legacy route serves, so with ALLOW_LEGACY_PUBLIC_UPLOADS=true
  // (the default this test suite runs with) it 404s -- the file genuinely
  // isn't there. If an operator has fully retired legacy serving
  // (ALLOW_LEGACY_PUBLIC_UPLOADS=false) the same route instead answers 410
  // for every path. Either status proves the same security property: no
  // private bytes are ever served through this route.
  assert.ok([404, 410].includes(publicAttempt.status), `the public storage-style path must never serve a private contract file (got ${publicAttempt.status})`);
});

test('GET private-files with no session at all is rejected with 401, before touching the filesystem', async () => {
  const ORG = 'ORG-PRIVATE-CONTRACT-FILES-NOAUTH';
  const email = 'noauth_creator@example.test';
  const contractCode = await makeContractWithParty(ORG, 'private_files_noauth_creator', email);

  const res = await request(app).get(`/api/contracts/${contractCode}/private-files/signed-${'a'.repeat(32)}.pdf`);
  assert.equal(res.status, 401);
});

test('GET private-files for a contract in a DIFFERENT organization is rejected with 404, never leaks the file', async () => {
  const ORG_A = 'ORG-PRIVATE-CONTRACT-FILES-A';
  const ORG_B = 'ORG-PRIVATE-CONTRACT-FILES-B';
  const emailA = 'owner_a@example.test';
  const contractCode = await makeContractWithParty(ORG_A, 'private_files_owner_a', emailA);
  const tokenA = tokenFor(ORG_A, 'admin', 'private_files_owner_a');

  const uploadRes = await request(app)
    .post(`/api/contracts/${contractCode}/signed-upload`)
    .set('Authorization', `Bearer ${tokenA}`)
    .attach('file', FAKE_PDF_BUFFER, { filename: 'signed.pdf', contentType: 'application/pdf' });
  assert.equal(uploadRes.status, 201);
  await request(app).post(`/api/contracts/${contractCode}/sign`).set('Authorization', `Bearer ${tokenA}`).send({ attachment_url: uploadRes.body.url, attachment_name: 'signed.pdf' });
  const filename = uploadRes.body.url.split('/').pop();

  // A real user profile in ORG_B, not just a signed token -- attachJwtIdentity
  // requires Users.findOne({ username, organization_code }) to resolve before
  // it ever reaches the org-scoped contract lookup this test means to
  // exercise; without a real profile the request 401s one layer earlier
  // (unknown session user), which would test the wrong thing.
  const UserProfile = require('../models/user_model');
  await UserProfile.create({ username: 'private_files_outsider', organization_code: ORG_B, first_name: 'O', last_name: 'One', designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'outsider@example.test', phone: '0', status: 'Active' });
  const outsiderToken = tokenFor(ORG_B, 'admin', 'private_files_outsider');
  const res = await request(app)
    .get(`/api/contracts/${contractCode}/private-files/${filename}`)
    .set('Authorization', `Bearer ${outsiderToken}`);
  assert.equal(res.status, 404, 'attachJwtIdentity org-scopes the contract lookup -- a different organization must never resolve req.contract for this contract_code at all');
});

test('GET private-files rejects a real-looking filename that is not actually referenced by this contract\'s own signed_copies', async () => {
  const ORG = 'ORG-PRIVATE-CONTRACT-FILES-UNREF';
  const email = 'unref_creator@example.test';
  const contractCode = await makeContractWithParty(ORG, 'private_files_unref_creator', email);
  const token = tokenFor(ORG, 'admin', 'private_files_unref_creator');

  // A well-formed filename (passes the signed-<32 hex>.pdf shape check)
  // that was simply never produced by a real upload for this contract.
  const guessedFilename = `signed-${crypto.randomBytes(16).toString('hex')}.pdf`;
  const res = await request(app)
    .get(`/api/contracts/${contractCode}/private-files/${guessedFilename}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 404, 'a party with real view access to the contract still must not be able to guess another signed copy\'s filename');
});
