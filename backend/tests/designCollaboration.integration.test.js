// tests/designCollaboration.integration.test.js
//
// Real MongoDB for comments, real Redis (redis-memory-server actually runs
// a redis-server binary, not a mock) for presence -- the scoped-down
// collaboration feature: threaded comments on a template plus short-TTL
// "who else is viewing this" heartbeats. No live cursors or operational-
// transform merging; see utils/presence.js's header comment for why.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { RedisMemoryServer } = require('redis-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';

let mongod;
let redisServer;
let app;
const ORG = 'ORG-COLLAB';
let token;
let designCode;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  redisServer = new RedisMemoryServer();
  const host = await redisServer.getHost();
  const port = await redisServer.getPort();
  process.env.REDIS_URL = `redis://${host}:${port}`;

  ({ app } = require('../api.js'));
  token = jwt.sign({ id: 'c1', username: 'collab_admin', role: 'admin', organization_code: ORG }, process.env.JWT_SECRET, { algorithm: 'HS256' });

  const createRes = await request(app)
    .post('/api/designs')
    .set('Authorization', `Bearer ${token}`)
    .send({ main_template_url: 'https://example.test/bg.png', template_url: 'https://example.test/bg.png', credential_title: 'Collab template' });
  designCode = createRes.body.data.design_code;
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
  await require('../utils/presence').disconnect();
  await redisServer.stop();
});

test('POST .../comments creates a comment, and GET lists it in order', async () => {
  const createRes = await request(app)
    .post(`/api/designs/${designCode}/comments`)
    .set('Authorization', `Bearer ${token}`)
    .send({ text: 'Move the QR code lower', position: { X: 400, Y: 300 } });
  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.data.author_username, 'collab_admin');
  assert.equal(createRes.body.data.resolved, false);

  const listRes = await request(app).get(`/api/designs/${designCode}/comments`).set('Authorization', `Bearer ${token}`);
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.data.length, 1);
  assert.equal(listRes.body.data[0].text, 'Move the QR code lower');
});

test('PATCH .../comments/:id/resolve marks a comment resolved, DELETE removes it', async () => {
  const createRes = await request(app)
    .post(`/api/designs/${designCode}/comments`)
    .set('Authorization', `Bearer ${token}`)
    .send({ text: 'Font is too small' });
  const commentId = createRes.body.data._id;

  const resolveRes = await request(app)
    .patch(`/api/designs/${designCode}/comments/${commentId}/resolve`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(resolveRes.status, 200);
  assert.equal(resolveRes.body.data.resolved, true);

  const deleteRes = await request(app)
    .delete(`/api/designs/${designCode}/comments/${commentId}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(deleteRes.status, 200);

  const listRes = await request(app).get(`/api/designs/${designCode}/comments`).set('Authorization', `Bearer ${token}`);
  assert.equal(listRes.body.data.find((c) => c._id === commentId), undefined);
});

test('an admin from a different organization cannot read or post comments on another org\'s template', async () => {
  const otherToken = jwt.sign({ id: 'o1', username: 'other_admin', role: 'admin', organization_code: 'ORG-COLLAB-OTHER' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  const listRes = await request(app).get(`/api/designs/${designCode}/comments`).set('Authorization', `Bearer ${otherToken}`);
  assert.equal(listRes.status, 403);
  const postRes = await request(app).post(`/api/designs/${designCode}/comments`).set('Authorization', `Bearer ${otherToken}`).send({ text: 'x' });
  assert.equal(postRes.status, 403);
});

test('presence: a heartbeat makes a user show up for another viewer, against a real Redis instance', async () => {
  const viewerToken = jwt.sign({ id: 'v1', username: 'second_viewer', role: 'admin', organization_code: ORG }, process.env.JWT_SECRET, { algorithm: 'HS256' });

  const beforeRes = await request(app).get(`/api/designs/${designCode}/presence`).set('Authorization', `Bearer ${token}`);
  assert.deepEqual(beforeRes.body.data, []);

  const hbRes = await request(app).post(`/api/designs/${designCode}/presence`).set('Authorization', `Bearer ${viewerToken}`);
  assert.equal(hbRes.status, 200);
  assert.equal(hbRes.body.redis_backed, true, 'a real Redis instance must be in use for this test, not the no-Redis no-op path');

  const afterRes = await request(app).get(`/api/designs/${designCode}/presence`).set('Authorization', `Bearer ${token}`);
  assert.deepEqual(afterRes.body.data, ['second_viewer']);

  // A caller must never see themselves in their own presence list.
  const selfHb = await request(app).post(`/api/designs/${designCode}/presence`).set('Authorization', `Bearer ${token}`);
  assert.equal(selfHb.status, 200);
  const selfView = await request(app).get(`/api/designs/${designCode}/presence`).set('Authorization', `Bearer ${token}`);
  assert.equal(selfView.body.data.includes('collab_admin'), false);
});
