const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';

let mongod;
let app;
let Organization;

const tokenFor = (organization_code, role, username) => jwt.sign(
  { id: crypto.randomUUID(), username, role, organization_code },
  process.env.JWT_SECRET,
  { algorithm: 'HS256' }
);

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
  Organization = require('../models/organization_schema');
  await Organization.create({
    organization_code: 'EBADGEID-PLATFORM', name: 'eBadgeID', city: 'C', state: 'S', country: 'CR',
    email: 'info@ebadgeid.com', phone: '0', status: 'ACTIVE', plan: 'Free',
    signature: 'https://storage.example.test/api/files/signature-0123456789abcdef0123456789abcdef.png',
  });
  await Organization.create({
    organization_code: 'ORG-OTHER', name: 'Other', city: 'C', state: 'S', country: 'CR',
    email: 'other@example.test', phone: '0', status: 'ACTIVE', plan: 'Premium',
  });
});

test.after(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongod) {
    await mongod.stop();
  }
});

test('platform administrator receives only its own full company record, including its signature', async () => {
  const platform = tokenFor('EBADGEID-PLATFORM', 'platform_admin', 'info@ebadgeid.com');
  const self = await request(app).get('/api/organizations/me').set('Authorization', `Bearer ${platform}`);
  assert.equal(self.status, 200);
  assert.equal(self.body.organization_code, 'EBADGEID-PLATFORM');
  assert.match(self.body.signature, /signature-/);

  const publicResult = await request(app).get('/api/organizations/code/EBADGEID-PLATFORM');
  assert.equal(publicResult.status, 200);
  assert.equal(publicResult.body.signature, undefined, 'the public endpoint must never disclose a signing image');
});

test('company update is scoped to the signed-in organization and cannot change the plan', async () => {
  const platform = tokenFor('EBADGEID-PLATFORM', 'platform_admin', 'info@ebadgeid.com');
  const own = await Organization.findOne({ organization_code: 'EBADGEID-PLATFORM' });
  const ownUpdate = await request(app)
    .put(`/api/organizations/${own._id}`)
    .set('Authorization', `Bearer ${platform}`)
    .send({ name: 'eBadgeID Platform', plan: 'Enterprise' });
  assert.equal(ownUpdate.status, 200);
  assert.equal(ownUpdate.body.name, 'eBadgeID Platform');
  assert.equal(ownUpdate.body.plan, 'Free', 'plan changes use the dedicated platform billing flow');

  const other = await Organization.findOne({ organization_code: 'ORG-OTHER' });
  const crossTenant = await request(app)
    .put(`/api/organizations/${other._id}`)
    .set('Authorization', `Bearer ${platform}`)
    .send({ name: 'Not permitted' });
  assert.equal(crossTenant.status, 403);
});
