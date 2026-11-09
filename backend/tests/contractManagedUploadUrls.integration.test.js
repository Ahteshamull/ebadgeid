// tests/contractManagedUploadUrls.integration.test.js
//
// Audit finding, confirmed real by running the full pipeline end to end
// (not just reading the code): digitalContractController.js and
// contractSafeController.js each kept their own local isManagedUploadUrl
// copy that only recognized the legacy /uploads/<file> path. Every real
// upload since the private-uploads migration (uploadController.js's
// fileUrl(), storage.js) instead returns a /api/files/:storageKey URL --
// so creating or updating a contract with a genuinely, freshly uploaded
// document was broken end to end on any deployment with MONGO_URI
// configured on the storage service, which is every real one. Reproduced
// here by going through the actual storage service's real /api/uploads
// route -- not a hand-built fixture URL like the other contract tests use
// -- and proving contract creation now succeeds with that real URL, and
// that a cross-tenant reference is rejected.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'https://storage.example.test';

let mongod;
let apiApp;
let storageApp;

function tokenFor(orgCode, role, username) {
  return jwt.sign({ id: crypto.randomUUID(), username, role, organization_code: orgCode }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

async function seedEmployee(orgCode, username, email) {
  const UserProfile = require('../models/user_model');
  const Organization = require('../models/organization_schema');
  await Organization.findOneAndUpdate(
    { organization_code: orgCode },
    { organization_code: orgCode, name: `${orgCode} Org`, city: 'C', state: 'S', country: 'PY', email: `${orgCode.toLowerCase()}@example.test`, phone: '0', status: 'ACTIVE', plan: 'Free' },
    { upsert: true }
  );
  await UserProfile.findOneAndUpdate(
    { username, organization_code: orgCode },
    { username, organization_code: orgCode, first_name: 'Admin', last_name: 'One', designation: 'Staff', city: 'C', state: 'S', country: 'PY', email, phone: '0', status: 'Active' },
    { upsert: true }
  );
}

// A buffer file-type's magic-byte sniffer recognizes as a real PNG.
const FAKE_PNG_BUFFER = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108020000009077', 'hex');

async function realUploadUrl(orgCode, role, username) {
  const res = await request(storageApp)
    .post('/api/uploads')
    .set('Authorization', `Bearer ${tokenFor(orgCode, role, username)}`)
    .field('visibility', 'private')
    .attach('file', FAKE_PNG_BUFFER, 'contract.png');
  assert.equal(res.status, 201, `expected the real upload to succeed, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.url;
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  await mongoose.connect(mongod.getUri());
  ({ app: apiApp } = require('../api.js'));
  ({ app: storageApp } = require('../storage.js'));
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('creating a contract with a real, freshly uploaded /api/files document URL succeeds (the exact pipeline that was broken)', async () => {
  const ORG = 'ORG-CONTRACT-UPLOAD-A';
  await seedEmployee(ORG, 'contract_upload_admin_a', 'admin_a@example.test');
  const token = tokenFor(ORG, 'admin', 'contract_upload_admin_a');

  const contentUrl = await realUploadUrl(ORG, 'admin', 'contract_upload_admin_a');
  assert.match(contentUrl, /\/api\/files\//, 'a real upload with MONGO_URI configured must return the new managed-storage URL shape');

  const attachmentUrl = await realUploadUrl(ORG, 'admin', 'contract_upload_admin_a');

  const res = await request(apiApp)
    .post('/api/contracts/create')
    .set('Authorization', `Bearer ${token}`)
    .send({
      contract_title: 'Real upload contract',
      contract_content_url: contentUrl,
      contract_attachments: [attachmentUrl],
    });

  assert.equal(res.status, 201, `contract creation with a real uploaded URL must succeed, got ${res.status}: ${JSON.stringify(res.body)}`);
});

test('creating a contract with another organization\'s uploaded file URL is rejected, not silently accepted', async () => {
  const ORG_A = 'ORG-CONTRACT-UPLOAD-B1';
  const ORG_B = 'ORG-CONTRACT-UPLOAD-B2';
  await seedEmployee(ORG_A, 'contract_upload_admin_b1', 'admin_b1@example.test');
  await seedEmployee(ORG_B, 'contract_upload_admin_b2', 'admin_b2@example.test');
  const tokenA = tokenFor(ORG_A, 'admin', 'contract_upload_admin_b1');

  const orgBFileUrl = await realUploadUrl(ORG_B, 'admin', 'contract_upload_admin_b2');

  const res = await request(apiApp)
    .post('/api/contracts/create')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      contract_title: 'Cross-tenant attempt',
      contract_content_url: orgBFileUrl,
      contract_attachments: [],
    });

  assert.equal(res.status, 403, `a file belonging to a different organization must be rejected, got ${res.status}: ${JSON.stringify(res.body)}`);
});

test('updating a contract\'s attachments with another organization\'s uploaded file URL is rejected', async () => {
  const DigitalContract = require('../models/digitalContract');
  const ORG_A = 'ORG-CONTRACT-UPLOAD-C1';
  const ORG_B = 'ORG-CONTRACT-UPLOAD-C2';
  await seedEmployee(ORG_A, 'contract_upload_admin_c1', 'admin_c1@example.test');
  await seedEmployee(ORG_B, 'contract_upload_admin_c2', 'admin_c2@example.test');
  const tokenA = tokenFor(ORG_A, 'admin', 'contract_upload_admin_c1');
  const ownContentUrl = await realUploadUrl(ORG_A, 'admin', 'contract_upload_admin_c1');

  const contractCode = `CONTRACT-UPLOAD-C-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  await DigitalContract.create({
    contract_code: contractCode,
    contract_issue_date: new Date().toISOString().slice(0, 10),
    contract_status: 'in_discussion',
    contract_content_url: ownContentUrl,
    contract_parties: [
      { party_name: 'Admin', party_side: 'admin', party_role: 'admin', party_email: 'admin_c1@example.test', status: 'accepted', accepted: true, contract_permissions: { view: true, write: true, update: true, add_discussion: true, add_timeline_event: true } },
    ],
    contract_security_hashes: 'test-hash',
    organization_code: ORG_A,
    creator_username: 'contract_upload_admin_c1',
    creator_details: { email: 'admin_c1@example.test' },
  });

  const orgBFileUrl = await realUploadUrl(ORG_B, 'admin', 'contract_upload_admin_c2');

  const res = await request(apiApp)
    .put(`/api/contracts/${contractCode}`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ contract_attachments: [orgBFileUrl] });

  assert.equal(res.status, 403, `updating attachments with a different organization's file must be rejected, got ${res.status}: ${JSON.stringify(res.body)}`);
});
