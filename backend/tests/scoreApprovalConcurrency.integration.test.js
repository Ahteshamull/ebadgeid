// tests/scoreApprovalConcurrency.integration.test.js
//
// E2E audit finding H-09: approveCompletion's Score.findOne-then-save
// pattern let two DIFFERENT completions for the same org+user+goal,
// approved at nearly the same time, each observe "no Score document yet"
// and both insert one -- silently doubling the score, with no unique
// index to catch it. Fixed with a single atomic
// Score.findOneAndUpdate($inc, upsert) plus a unique compound index as a
// hard backstop.
//
// approveCompletion uses a real MongoDB transaction (mongoose session +
// withTransaction), which requires an actual replica set -- a plain
// MongoMemoryServer standalone instance rejects startTransaction()
// outright. MongoMemoryReplSet is the real thing (mongod running with
// --replSet, not a mock), so this proves the fix under the exact
// mechanism production uses, not an approximation of it.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';

let replSet;
let app;

function tokenFor(orgCode, role, username) {
  return jwt.sign({ id: crypto.randomUUID(), username, role, organization_code: orgCode }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  ({ app } = require('../api.js'));
  // Mongoose schedules index builds in the background when a model is
  // first compiled -- it does NOT block until they exist on the server.
  // The unique index this test is actually proving out would otherwise
  // race against these very assertions (and did, the first time this
  // test was run: both "duplicate" writes silently succeeded because the
  // index hadn't been created on the real mongod yet).
  await require('../models/score_schema').init();
});

test.after(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

test('the unique compound index rejects a raw duplicate Score document (hard DB-level backstop)', async () => {
  const Score = require('../models/score_schema');
  const filter = { organization_code: 'ORG-SCORE-INDEX', username: 'index_test_user', goal_code: 'GOAL-INDEX-TEST' };
  await Score.create({ ...filter, score: 10 });
  await assert.rejects(
    () => Score.create({ ...filter, score: 10 }),
    (err) => err.code === 11000,
    'a second Score document with the exact same organization_code+username+goal_code must be rejected by the unique index',
  );
});

test('two concurrent approvals of DIFFERENT completions for the same org+user+goal never create two Score documents, and the score is the correct sum', async () => {
  const ORG = 'ORG-SCORE-RACE';
  const admin = tokenFor(ORG, 'admin', 'score_race_admin');
  const Completion = require('../models/task_completion');
  const Score = require('../models/score_schema');

  const completionA = await Completion.create({
    username: 'race_user', organization_code: ORG, goal_code: 'GOAL-RACE', message: 'Completed task A',
  });
  const completionB = await Completion.create({
    username: 'race_user', organization_code: ORG, goal_code: 'GOAL-RACE', message: 'Completed task B',
  });

  const [resA, resB] = await Promise.all([
    request(app).patch(`/api/completions/${completionA._id}/approve`).set('Authorization', `Bearer ${admin}`),
    request(app).patch(`/api/completions/${completionB._id}/approve`).set('Authorization', `Bearer ${admin}`),
  ]);

  assert.equal(resA.status, 200, JSON.stringify(resA.body));
  assert.equal(resB.status, 200, JSON.stringify(resB.body));

  const scores = await Score.find({ organization_code: ORG, username: 'race_user', goal_code: 'GOAL-RACE' }).lean();
  assert.equal(scores.length, 1, 'exactly one Score document must exist, never two, regardless of how the two approvals interleaved');
  assert.equal(scores[0].score, 20, 'both approvals must have actually applied -- 10 + 10, not a lost update either');
});
