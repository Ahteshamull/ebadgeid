// tests/chatMultiTenant.integration.test.js
//
// Real integration test (real MongoDB via mongodb-memory-server, real HTTP
// requests via supertest against a real Express app mounting the actual
// routers) for the multi-tenant chat/FAQ/article work: help_backend used to
// resolve "which organization is this for" from a single fixed
// process.env.DEFAULT_ORG_CODE everywhere. The public surface (chat,
// FAQs, articles) now resolves the real organization per request instead
// — see middleware/publicOrganization.js.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');

let mongod;
let app;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const chatRoutes = require('../routes/chatRoutes');
  const faqRoutes = require('../routes/faqRoutes');
  const articleRoutes = require('../routes/articleRoutes');

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/chat', chatRoutes);
  app.use('/api/faqs', faqRoutes);
  app.use('/api/articles', articleRoutes);
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

async function makeOrganization(code) {
  const Organization = require('../models/organization');
  await Organization.create({
    organization_code: code,
    name: `Org ${code}`,
    support_email: `${code.toLowerCase()}@example.com`,
    city: 'City',
    country: 'Country',
  });
}

// --- POST /session/start ---------------------------------------------

test('session/start rejects a missing organization_code', async () => {
  const res = await request(app).post('/api/chat/session/start').send({});
  assert.equal(res.status, 400);
});

test('session/start rejects an organization_code that does not exist', async () => {
  const res = await request(app).post('/api/chat/session/start').send({ organization_code: 'NOPE-DOES-NOT-EXIST' });
  assert.equal(res.status, 400);
});

test('session/start succeeds for a real organization and returns a sessionId + token bound to it', async () => {
  await makeOrganization('ACME');
  const res = await request(app).post('/api/chat/session/start').send({ organization_code: 'ACME' });
  assert.equal(res.status, 200);
  assert.equal(res.body.organization_code, 'ACME');
  assert.ok(res.body.sessionId);
  assert.ok(res.body.sessionToken);
});

// --- token binding: sessionId + organization_code together ------------
// (wire field is organization_code, snake_case, everywhere — including
// here — matching session/start's own request body; see ronda 21 fix for
// the inconsistency this used to have)

test('a session token issued for one organization is rejected when replayed with a different organization_code', async () => {
  await makeOrganization('ORGONE');
  await makeOrganization('ORGTWO');

  const start = await request(app).post('/api/chat/session/start').send({ organization_code: 'ORGONE' });
  assert.equal(start.status, 200);
  const { sessionId, sessionToken } = start.body;

  // Same sessionId and token, but claiming to belong to a different real
  // organization — the HMAC was signed over sessionId+ORGONE, so this must
  // fail even though ORGTWO itself is a perfectly valid organization.
  const res = await request(app)
    .post('/api/chat/message')
    .set('X-Chat-Session-Token', sessionToken)
    .send({ sessionId, organization_code: 'ORGTWO', message: 'hello' });

  assert.equal(res.status, 401);
});

test('a session token is rejected outright without ever calling session/start', async () => {
  const res = await request(app)
    .post('/api/chat/message')
    .set('X-Chat-Session-Token', 'not-a-real-token')
    .send({ sessionId: 'fake-session-id', organization_code: 'ACME', message: 'hi' });
  assert.equal(res.status, 401);
});

test('the correct sessionId + organization_code + token combination is accepted', async () => {
  await makeOrganization('ORGREAL');
  const start = await request(app).post('/api/chat/session/start').send({ organization_code: 'ORGREAL' });
  const { sessionId, sessionToken, organization_code } = start.body;

  const res = await request(app)
    .post('/api/chat/message')
    .set('X-Chat-Session-Token', sessionToken)
    .send({ sessionId, organization_code, message: 'Hello, I need help with my credential' });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
});

// --- FAQs / articles: public, but scoped per organization -------------

test('GET /api/faqs requires organization_code for an anonymous caller', async () => {
  const res = await request(app).get('/api/faqs/');
  assert.equal(res.status, 400);
});

test('GET /api/faqs only returns FAQs belonging to the requested organization', async () => {
  const FAQ = require('../models/faqSchema');
  await makeOrganization('FAQORG-A');
  await makeOrganization('FAQORG-B');
  await FAQ.create({ faq_title: 'Question A', faq_body: 'Answer A', organization_code: 'FAQORG-A', faq_status: 'visible', language: 'en' });
  await FAQ.create({ faq_title: 'Question B', faq_body: 'Answer B', organization_code: 'FAQORG-B', faq_status: 'visible', language: 'en' });

  const resA = await request(app).get('/api/faqs/?organization_code=FAQORG-A');
  assert.equal(resA.status, 200);
  assert.equal(resA.body.count, 1);
  assert.equal(resA.body.data[0].faq_title, 'Question A');

  const resB = await request(app).get('/api/faqs/?organization_code=FAQORG-B');
  assert.equal(resB.status, 200);
  assert.equal(resB.body.count, 1);
  assert.equal(resB.body.data[0].faq_title, 'Question B');
});

test('GET /api/articles only returns published articles belonging to the requested organization', async () => {
  const Article = require('../models/articleSchema');
  await makeOrganization('ARTORG-A');
  await makeOrganization('ARTORG-B');
  await Article.create({ article_code: 'ART-A-1', article_title: 'Article A', article_category: 'general', author: 'agent1', organization_code: 'ARTORG-A', published: true });
  await Article.create({ article_code: 'ART-B-1', article_title: 'Article B', article_category: 'general', author: 'agent1', organization_code: 'ARTORG-B', published: true });

  const resA = await request(app).get('/api/articles/?organization_code=ARTORG-A');
  assert.equal(resA.status, 200);
  assert.equal(resA.body.length, 1);
  assert.equal(resA.body[0].article_code, 'ART-A-1');
});

test('an invalid organization_code shape (not matching the allowed pattern) is rejected, not passed through to the query', async () => {
  const res = await request(app).get('/api/faqs/?organization_code=' + encodeURIComponent('$ne'));
  assert.equal(res.status, 400);
});
