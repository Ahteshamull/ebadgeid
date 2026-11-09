// tests/designApprovalAndConcurrency.integration.test.js
//
// Point 4 & 5 (Credential Studio closure round): gaps found on inspection
// of the existing approval workflow (tests/designApprovalWorkflow.
// integration.test.js) and autosave (frontend design-editor/page.js) that
// weren't covered by any existing test:
//
//   - a template could still be edited through updateDesign while pending
//     review, letting a reviewer approve different content than whatever
//     was actually submitted
//   - two concurrent approve (or approve+reject) requests could both
//     succeed against the same pending_review document -- a real race, not
//     just a hypothetical one, reproduced below with genuinely concurrent
//     requests (Promise.all), not sequential ones
//   - a stale update (older known_version) could silently overwrite a
//     newer save
//   - approve/reject had no audit trail beyond the single submitted_by/
//     reviewed_by pair on the document itself, which a second review cycle
//     overwrites
//
// Real HTTP requests against the real Express app (api.js), a real
// MongoDB (mongodb-memory-server).
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

let mongod;
let app;

function tokenFor(orgCode, role, username) {
  return jwt.sign({ id: crypto.randomUUID(), username, role, organization_code: orgCode }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

const DESIGN_PAYLOAD = {
  main_template_url: 'https://example.test/t.png',
  template_url: 'https://example.test/t.png',
  credential_title: 'Concurrency Test Template',
  text_attributes: [{ text_title: 'recipient_name', text: 'Name', font_attributes: [{ font_family: 'Georgia', font_size: 24, font_color: '#000000', font_weight: 'normal' }], positions: { X: 10, Y: 10 } }],
  QR_CODE: { ecoding_data: 'placeholder', X: 0, Y: 0 },
};

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('updateDesign rejects an edit while the template is pending_review, with 409', async () => {
  const ORG = 'ORG-PENDING-EDIT';
  const submitter = tokenFor(ORG, 'admin', 'pe_submitter');
  const createRes = await request(app).post('/api/designs').set('Authorization', `Bearer ${submitter}`).send(DESIGN_PAYLOAD);
  const code = createRes.body.data.design_code;
  await request(app).post(`/api/designs/${code}/submit-review`).set('Authorization', `Bearer ${submitter}`);

  const editRes = await request(app)
    .put(`/api/designs/${code}`)
    .set('Authorization', `Bearer ${submitter}`)
    .send({ credential_title: 'Sneaky edit while pending' });
  assert.equal(editRes.status, 409);
  assert.match(editRes.body.message, /pending review/i);

  const Design = require('../models/designSchema');
  const stored = await Design.findOne({ design_code: code }).lean();
  assert.equal(stored.credential_title, DESIGN_PAYLOAD.credential_title, 'content must be unchanged -- the edit must never have applied');
});

test('updateDesign becomes editable again once rejected back to draft', async () => {
  const ORG = 'ORG-PENDING-EDIT-2';
  const submitter = tokenFor(ORG, 'admin', 'pe2_submitter');
  const reviewer = tokenFor(ORG, 'admin', 'pe2_reviewer');
  const createRes = await request(app).post('/api/designs').set('Authorization', `Bearer ${submitter}`).send(DESIGN_PAYLOAD);
  const code = createRes.body.data.design_code;
  await request(app).post(`/api/designs/${code}/submit-review`).set('Authorization', `Bearer ${submitter}`);
  await request(app).post(`/api/designs/${code}/reject`).set('Authorization', `Bearer ${reviewer}`).send({ reason: 'needs work' });

  const editRes = await request(app)
    .put(`/api/designs/${code}`)
    .set('Authorization', `Bearer ${submitter}`)
    .send({ credential_title: 'Fixed after rejection' });
  assert.equal(editRes.status, 200);
  assert.equal(editRes.body.data.credential_title, 'Fixed after rejection');
});

test('updateDesign optimistic concurrency: a stale known_version is rejected with 409 and never applied', async () => {
  const ORG = 'ORG-OPTIMISTIC-LOCK';
  const admin = tokenFor(ORG, 'admin', 'lock_admin');
  const createRes = await request(app).post('/api/designs').set('Authorization', `Bearer ${admin}`).send(DESIGN_PAYLOAD);
  const code = createRes.body.data.design_code;
  const v1 = createRes.body.data.current_version;
  assert.equal(v1, 1);

  // A first real save moves it to version 2.
  const firstSave = await request(app).put(`/api/designs/${code}`).set('Authorization', `Bearer ${admin}`).send({ credential_title: 'Saved first', known_version: v1 });
  assert.equal(firstSave.status, 200);
  assert.equal(firstSave.body.data.current_version, 2);

  // A second, "stale" save still thinks it's at version 1 (e.g. a slow
  // request that started before the first one finished) -- this must
  // never be allowed to overwrite the newer content.
  const staleSave = await request(app).put(`/api/designs/${code}`).set('Authorization', `Bearer ${admin}`).send({ credential_title: 'Stale overwrite attempt', known_version: v1 });
  assert.equal(staleSave.status, 409);

  const Design = require('../models/designSchema');
  const stored = await Design.findOne({ design_code: code }).lean();
  assert.equal(stored.credential_title, 'Saved first', 'the stale write must never have applied');
  assert.equal(stored.current_version, 2, 'version must not have been bumped by the rejected stale write');
});

test('updateDesign optimistic concurrency: two genuinely concurrent updates -- exactly one wins, the other 409s, no lost update', async () => {
  const ORG = 'ORG-RACE-UPDATE';
  const admin = tokenFor(ORG, 'admin', 'race_admin');
  const createRes = await request(app).post('/api/designs').set('Authorization', `Bearer ${admin}`).send(DESIGN_PAYLOAD);
  const code = createRes.body.data.design_code;
  const v1 = createRes.body.data.current_version;

  const [resA, resB] = await Promise.all([
    request(app).put(`/api/designs/${code}`).set('Authorization', `Bearer ${admin}`).send({ credential_title: 'Race A', known_version: v1 }),
    request(app).put(`/api/designs/${code}`).set('Authorization', `Bearer ${admin}`).send({ credential_title: 'Race B', known_version: v1 }),
  ]);
  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(statuses, [200, 409], 'exactly one of two truly concurrent same-base-version writes must win, the other must 409');

  const Design = require('../models/designSchema');
  const stored = await Design.findOne({ design_code: code }).lean();
  assert.equal(stored.current_version, 2, 'exactly one version bump, never both');
  assert.ok(['Race A', 'Race B'].includes(stored.credential_title));
});

test('updateDesign with no known_version at all keeps the previous unconditional-write behavior (backward compatible)', async () => {
  const ORG = 'ORG-NO-VERSION-SENT';
  const admin = tokenFor(ORG, 'admin', 'noversion_admin');
  const createRes = await request(app).post('/api/designs').set('Authorization', `Bearer ${admin}`).send(DESIGN_PAYLOAD);
  const code = createRes.body.data.design_code;

  const res = await request(app).put(`/api/designs/${code}`).set('Authorization', `Bearer ${admin}`).send({ credential_title: 'No version field sent' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.credential_title, 'No version field sent');
});

test('approveDesign and rejectDesign both reject an admin from a different organization with 403', async () => {
  const ORG = 'ORG-APPROVE-CROSSORG';
  const OTHER = 'ORG-APPROVE-CROSSORG-OTHER';
  const submitter = tokenFor(ORG, 'admin', 'cross_submitter');
  const otherAdmin = tokenFor(OTHER, 'admin', 'cross_other_admin');

  const create1 = await request(app).post('/api/designs').set('Authorization', `Bearer ${submitter}`).send(DESIGN_PAYLOAD);
  const code1 = create1.body.data.design_code;
  await request(app).post(`/api/designs/${code1}/submit-review`).set('Authorization', `Bearer ${submitter}`);
  const approveRes = await request(app).post(`/api/designs/${code1}/approve`).set('Authorization', `Bearer ${otherAdmin}`);
  assert.equal(approveRes.status, 403);

  const create2 = await request(app).post('/api/designs').set('Authorization', `Bearer ${submitter}`).send(DESIGN_PAYLOAD);
  const code2 = create2.body.data.design_code;
  await request(app).post(`/api/designs/${code2}/submit-review`).set('Authorization', `Bearer ${submitter}`);
  const rejectRes = await request(app).post(`/api/designs/${code2}/reject`).set('Authorization', `Bearer ${otherAdmin}`).send({ reason: 'not yours to reject' });
  assert.equal(rejectRes.status, 403);
});

test('two concurrent approve requests on the same pending template: exactly one succeeds, the other 409s -- never double-approved', async () => {
  const ORG = 'ORG-RACE-APPROVE';
  const submitter = tokenFor(ORG, 'admin', 'race_submitter');
  const reviewer = tokenFor(ORG, 'admin', 'race_reviewer');

  const createRes = await request(app).post('/api/designs').set('Authorization', `Bearer ${submitter}`).send(DESIGN_PAYLOAD);
  const code = createRes.body.data.design_code;
  await request(app).post(`/api/designs/${code}/submit-review`).set('Authorization', `Bearer ${submitter}`);

  const [resA, resB] = await Promise.all([
    request(app).post(`/api/designs/${code}/approve`).set('Authorization', `Bearer ${reviewer}`),
    request(app).post(`/api/designs/${code}/approve`).set('Authorization', `Bearer ${reviewer}`),
  ]);
  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(statuses, [200, 409], 'exactly one concurrent approve must win, the other must be rejected, never both silently succeeding');

  const Design = require('../models/designSchema');
  const stored = await Design.findOne({ design_code: code }).lean();
  assert.equal(stored.status, 'published');
});

test('a concurrent approve+reject pair on the same pending template: exactly one wins, never both', async () => {
  const ORG = 'ORG-RACE-APPROVE-REJECT';
  const submitter = tokenFor(ORG, 'admin', 'rar_submitter');
  const reviewerA = tokenFor(ORG, 'admin', 'rar_reviewer_a');
  const reviewerB = tokenFor(ORG, 'admin', 'rar_reviewer_b');

  const createRes = await request(app).post('/api/designs').set('Authorization', `Bearer ${submitter}`).send(DESIGN_PAYLOAD);
  const code = createRes.body.data.design_code;
  await request(app).post(`/api/designs/${code}/submit-review`).set('Authorization', `Bearer ${submitter}`);

  const [approveRes, rejectRes] = await Promise.all([
    request(app).post(`/api/designs/${code}/approve`).set('Authorization', `Bearer ${reviewerA}`),
    request(app).post(`/api/designs/${code}/reject`).set('Authorization', `Bearer ${reviewerB}`).send({ reason: 'racing rejection' }),
  ]);
  const statuses = [approveRes.status, rejectRes.status].sort();
  assert.deepEqual(statuses, [200, 409], 'exactly one of a racing approve/reject pair may apply');

  const Design = require('../models/designSchema');
  const stored = await Design.findOne({ design_code: code }).lean();
  assert.ok(['published', 'draft'].includes(stored.status), 'must land in a real, consistent terminal state for whichever action actually won');
});

test('the audit trail records submit/approve events in order, and a second review cycle does not erase the first', async () => {
  const ORG = 'ORG-AUDIT-TRAIL';
  const submitter = tokenFor(ORG, 'admin', 'audit_submitter');
  const reviewer = tokenFor(ORG, 'admin', 'audit_reviewer');
  const otherOrgAdmin = tokenFor('ORG-AUDIT-TRAIL-OTHER', 'admin', 'audit_other');

  const createRes = await request(app).post('/api/designs').set('Authorization', `Bearer ${submitter}`).send(DESIGN_PAYLOAD);
  const code = createRes.body.data.design_code;
  await request(app).post(`/api/designs/${code}/submit-review`).set('Authorization', `Bearer ${submitter}`);
  await request(app).post(`/api/designs/${code}/reject`).set('Authorization', `Bearer ${reviewer}`).send({ reason: 'first pass needs work' });
  await request(app).post(`/api/designs/${code}/submit-review`).set('Authorization', `Bearer ${submitter}`);
  await request(app).post(`/api/designs/${code}/approve`).set('Authorization', `Bearer ${reviewer}`);

  const logRes = await request(app).get(`/api/designs/${code}/audit-log`).set('Authorization', `Bearer ${submitter}`);
  assert.equal(logRes.status, 200);
  const events = logRes.body.data.map((e) => e.event);
  assert.deepEqual(events, ['approved', 'submitted_for_review', 'rejected', 'submitted_for_review'], 'newest first, and the first rejection must still be visible after a second, successful cycle');

  const crossOrgRes = await request(app).get(`/api/designs/${code}/audit-log`).set('Authorization', `Bearer ${otherOrgAdmin}`);
  assert.equal(crossOrgRes.status, 403);
});
