// tests/designApprovalWorkflow.integration.test.js
//
// submit-for-review / approve / reject -- an additional path alongside the
// existing direct draft -> published jump (designController.publishDesign,
// see tests/designPublishing.integration.test.js), for orgs that want a
// second admin to sign off before a template becomes issuable. Real HTTP
// requests against the real Express app (api.js), a real MongoDB
// (mongodb-memory-server).
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';
process.env.CERTIFICATE_SERVICE_URL = process.env.CERTIFICATE_SERVICE_URL || 'http://localhost:8100';
process.env.CERTIFICATE_INTERNAL_KEY = process.env.CERTIFICATE_INTERNAL_KEY || 'test-internal-key';

let mongod;
let app;

const ORG = 'ORG-APPROVAL-A';
const OTHER_ORG = 'ORG-APPROVAL-B';
let submitter; // admin who creates + submits the template
let reviewer;  // a different admin in the same org, who approves/rejects
let nonAdmin;
let otherOrgAdmin;

function tokenFor(orgCode, role, username) {
  return jwt.sign({ id: crypto.randomUUID(), username, role, organization_code: orgCode }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
  submitter = tokenFor(ORG, 'admin', 'approval_submitter');
  reviewer = tokenFor(ORG, 'admin', 'approval_reviewer');
  nonAdmin = tokenFor(ORG, 'user', 'approval_nonadmin');
  otherOrgAdmin = tokenFor(OTHER_ORG, 'admin', 'approval_other_org');
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const DESIGN_PAYLOAD = {
  main_template_url: 'https://example.test/t.png',
  template_url: 'https://example.test/t.png',
  credential_title: 'Approval Workflow Test Template',
  text_attributes: [{ text_title: 'recipient_name', text: 'Name', font_attributes: [{ font_family: 'Georgia', font_size: 24, font_color: '#000000', font_weight: 'normal' }], positions: { X: 10, Y: 10 } }],
  QR_CODE: { ecoding_data: 'placeholder', X: 0, Y: 0 },
};

test('a brand-new template starts as draft and has no submission/review fields yet', async () => {
  const res = await request(app)
    .post('/api/designs')
    .set('Authorization', `Bearer ${submitter}`)
    .send({ ...DESIGN_PAYLOAD, design_code: 'DESIGN-APPROVAL-001' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.status, 'draft');
  assert.equal(res.body.data.submitted_by, null);
});

test('submitForReview rejects a non-admin caller with 403', async () => {
  const res = await request(app).post('/api/designs/DESIGN-APPROVAL-001/submit-review').set('Authorization', `Bearer ${nonAdmin}`);
  assert.equal(res.status, 403);
});

test('submitForReview rejects an admin from a different organization with 403', async () => {
  const res = await request(app).post('/api/designs/DESIGN-APPROVAL-001/submit-review').set('Authorization', `Bearer ${otherOrgAdmin}`);
  assert.equal(res.status, 403);
});

test('approveDesign and rejectDesign both 409 on a template that is still a draft (nothing pending yet)', async () => {
  const approveRes = await request(app).post('/api/designs/DESIGN-APPROVAL-001/approve').set('Authorization', `Bearer ${reviewer}`);
  assert.equal(approveRes.status, 409);
  const rejectRes = await request(app).post('/api/designs/DESIGN-APPROVAL-001/reject').set('Authorization', `Bearer ${reviewer}`).send({ reason: 'n/a' });
  assert.equal(rejectRes.status, 409);
});

test('submitForReview moves draft -> pending_review and records who submitted it', async () => {
  const res = await request(app).post('/api/designs/DESIGN-APPROVAL-001/submit-review').set('Authorization', `Bearer ${submitter}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'pending_review');
  assert.equal(res.body.data.submitted_by, 'approval_submitter');
  assert.ok(res.body.data.submitted_at);
});

test('a pending template still blocks issuance exactly like a draft does', async () => {
  const UserProfile = require('../models/user_model');
  await UserProfile.create({
    username: 'approval_recipient', organization_code: ORG, first_name: 'R', last_name: 'One',
    designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: 'approvalrecipient@example.test', phone: '0', status: 'Active',
  });
  const res = await request(app)
    .post('/api/credentials/generate-certificate')
    .set('Authorization', `Bearer ${submitter}`)
    .send({ design_code: 'DESIGN-APPROVAL-001', achiever_username: 'approval_recipient', credential_code: 'CRED-4000000000000001' });
  assert.equal(res.status, 409);
  assert.match(res.body.message, /still a draft/i);
});

test('the submitter cannot approve their own submission', async () => {
  const res = await request(app).post('/api/designs/DESIGN-APPROVAL-001/approve').set('Authorization', `Bearer ${submitter}`);
  assert.equal(res.status, 403);
  assert.match(res.body.message, /cannot approve/i);
});

test('the submitter cannot reject their own submission either', async () => {
  const res = await request(app).post('/api/designs/DESIGN-APPROVAL-001/reject').set('Authorization', `Bearer ${submitter}`).send({ reason: 'trying to reject myself' });
  assert.equal(res.status, 403);
});

test('rejectDesign requires a non-empty reason', async () => {
  const res = await request(app).post('/api/designs/DESIGN-APPROVAL-001/reject').set('Authorization', `Bearer ${reviewer}`).send({});
  assert.equal(res.status, 400);
});

test('a different admin can reject it back to draft with a reason', async () => {
  const res = await request(app)
    .post('/api/designs/DESIGN-APPROVAL-001/reject')
    .set('Authorization', `Bearer ${reviewer}`)
    .send({ reason: 'Logo is off-center, please fix and resubmit.' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'draft');
  assert.equal(res.body.data.reviewed_by, 'approval_reviewer');
  assert.equal(res.body.data.rejection_reason, 'Logo is off-center, please fix and resubmit.');
});

test('resubmitting after a rejection clears the previous rejection_reason', async () => {
  const res = await request(app).post('/api/designs/DESIGN-APPROVAL-001/submit-review').set('Authorization', `Bearer ${submitter}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'pending_review');
  assert.equal(res.body.data.rejection_reason, null);
});

test('a different admin can approve it, publishing it and unblocking issuance', async () => {
  const approveRes = await request(app).post('/api/designs/DESIGN-APPROVAL-001/approve').set('Authorization', `Bearer ${reviewer}`);
  assert.equal(approveRes.status, 200);
  assert.equal(approveRes.body.data.status, 'published');
  assert.equal(approveRes.body.data.reviewed_by, 'approval_reviewer');

  const certRes = await request(app)
    .post('/api/credentials/generate-certificate')
    .set('Authorization', `Bearer ${submitter}`)
    .send({ design_code: 'DESIGN-APPROVAL-001', achiever_username: 'approval_recipient', credential_code: 'CRED-4000000000000002' });
  assert.notEqual(certRes.status, 409);
  assert.doesNotMatch(certRes.body.message || '', /draft/i);
});

test('approveDesign 409s again once the template is already published (nothing left pending)', async () => {
  const res = await request(app).post('/api/designs/DESIGN-APPROVAL-001/approve').set('Authorization', `Bearer ${reviewer}`);
  assert.equal(res.status, 409);
});
