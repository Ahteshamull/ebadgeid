// tests/storageUploadAuth.integration.test.js
//
// Real HTTP against storage.js's actual Express app (supertest, not a
// mock) -- covers the audit finding that font upload and AI image
// generation only required a valid session (any role) while the
// equivalent routes on the main API required admin. Also proves the fix
// didn't collateral-damage the routes that legitimately need to stay
// open to non-admins: profile pictures (both apps' settings pages) and
// helpdesk ticket attachments all go through storage.js's plain
// /api/uploads, so that one must keep accepting a non-admin session.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.HELPDESK_JWT_SECRET = process.env.HELPDESK_JWT_SECRET || 'test_helpdesk_secret_for_unit_tests_only';

const { app } = require('../storage.js');

const mainAppToken = (role) => jwt.sign(
  { id: 'u1', username: 'someone', role, organization_code: 'ORG-STORAGE-AUTH' },
  process.env.JWT_SECRET,
  { algorithm: 'HS256' },
);
const helpdeskToken = (userType) => jwt.sign(
  { id: 'h1', username: 'agent1', user_type: userType, org_code: 'ORG-STORAGE-AUTH' },
  process.env.HELPDESK_JWT_SECRET,
  { algorithm: 'HS256' },
);

test('plain /api/uploads stays open to a non-admin session (profile pictures, ticket attachments rely on this)', async () => {
  const res = await request(app)
    .post('/api/uploads')
    .set('Cookie', `ebadge_token=${mainAppToken('user')}`);
  // No file attached -> handleUpload's own 400 ("No file uploaded"), but
  // critically NOT 401/403 -- the auth layer must let a plain user through.
  assert.equal(res.status, 400);
});

test('a non-admin main-app session is rejected by /api/uploads/font with 403, before ever touching multer', async () => {
  const res = await request(app)
    .post('/api/uploads/font')
    .set('Cookie', `ebadge_token=${mainAppToken('user')}`);
  assert.equal(res.status, 403);
  assert.match(res.body.message, /admin/i);
});

test('a non-admin main-app session is rejected by /api/uploads/generate-image with 403', async () => {
  const res = await request(app)
    .post('/api/uploads/generate-image')
    .set('Cookie', `ebadge_token=${mainAppToken('user')}`)
    .send({ prompt: 'should never reach the handler' });
  assert.equal(res.status, 403);
});

test('a helpdesk agent (non-admin user_type) is rejected by /api/uploads/font with 403', async () => {
  const res = await request(app)
    .post('/api/uploads/font')
    .set('Cookie', `helpdesk_token=${helpdeskToken('agent')}`);
  assert.equal(res.status, 403);
});

test('an admin main-app session is let through the auth gate on /api/uploads/font (fails later only for lacking a real file)', async () => {
  const res = await request(app)
    .post('/api/uploads/font')
    .set('Cookie', `ebadge_token=${mainAppToken('admin')}`);
  assert.notEqual(res.status, 403);
  assert.equal(res.status, 400); // handleFontUpload's own "No font uploaded" — proves auth passed and the real handler ran
});

test('a platform_admin main-app session is also let through the auth gate on /api/uploads/generate-image', async () => {
  const res = await request(app)
    .post('/api/uploads/generate-image')
    .set('Cookie', `ebadge_token=${mainAppToken('platform_admin')}`)
    .send({}); // missing prompt -> handleGenerateImage's own 400, proving auth passed
  assert.notEqual(res.status, 403);
  assert.equal(res.status, 400);
});

test('a helpdesk admin (user_type: admin) is let through the auth gate on /api/uploads/font too', async () => {
  const res = await request(app)
    .post('/api/uploads/font')
    .set('Cookie', `helpdesk_token=${helpdeskToken('admin')}`);
  assert.notEqual(res.status, 403);
  assert.equal(res.status, 400);
});

test('no session at all is rejected by all three routes with 401, before any role check', async () => {
  const resPlain = await request(app).post('/api/uploads');
  assert.equal(resPlain.status, 401);
  const resFont = await request(app).post('/api/uploads/font');
  assert.equal(resFont.status, 401);
  const resGen = await request(app).post('/api/uploads/generate-image').send({});
  assert.equal(resGen.status, 401);
});
