// tests/designVersioning.integration.test.js
//
// Real MongoDB, real HTTP against the real app. Covers both new pieces
// added to the design module: version history (create/update snapshots,
// list, revert) and vector shapes (rectangle/line/circle) round-tripping
// through the same create/update/get endpoints as text_attributes always
// did.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.example.test';

let mongod;
let app;
const ORG = 'ORG-DESIGN-VER';
let token;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = require('../api.js'));
  token = jwt.sign({ id: 'd1', username: 'design_admin', role: 'admin', organization_code: ORG }, process.env.JWT_SECRET, { algorithm: 'HS256' });
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('creating a design writes version 1, and the list reflects it', async () => {
  const createRes = await request(app)
    .post('/api/designs')
    .set('Authorization', `Bearer ${token}`)
    .send({
      main_template_url: 'https://example.test/bg.png',
      template_url: 'https://example.test/bg.png',
      credential_title: 'V1 title',
      text_attributes: [],
    });
  assert.equal(createRes.status, 201);
  const designCode = createRes.body.data.design_code;
  assert.equal(createRes.body.data.current_version, 1);

  const versionsRes = await request(app)
    .get(`/api/designs/${designCode}/versions`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(versionsRes.status, 200);
  assert.equal(versionsRes.body.data.length, 1);
  assert.equal(versionsRes.body.data[0].version_number, 1);
  assert.equal(versionsRes.body.data[0].snapshot, undefined, 'the list view must not include the full snapshot payload');
});

test('updating a design bumps the version and writes a new snapshot, without losing the earlier one', async () => {
  const createRes = await request(app)
    .post('/api/designs')
    .set('Authorization', `Bearer ${token}`)
    .send({ main_template_url: 'https://example.test/bg.png', template_url: 'https://example.test/bg.png', credential_title: 'Original' });
  const designCode = createRes.body.data.design_code;

  const updateRes = await request(app)
    .put(`/api/designs/${designCode}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ credential_title: 'Updated once' });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.data.current_version, 2);

  const versionsRes = await request(app)
    .get(`/api/designs/${designCode}/versions`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(versionsRes.body.data.length, 2);
  assert.deepEqual(versionsRes.body.data.map((v) => v.version_number).sort(), [1, 2]);
});

test('reverting to an earlier version restores its content and creates a new version for the revert itself', async () => {
  const createRes = await request(app)
    .post('/api/designs')
    .set('Authorization', `Bearer ${token}`)
    .send({ main_template_url: 'https://example.test/bg.png', template_url: 'https://example.test/bg.png', credential_title: 'Version One Title' });
  const designCode = createRes.body.data.design_code;

  await request(app)
    .put(`/api/designs/${designCode}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ credential_title: 'Version Two Title' });

  const revertRes = await request(app)
    .post(`/api/designs/${designCode}/versions/1/revert`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(revertRes.status, 200);
  assert.equal(revertRes.body.data.credential_title, 'Version One Title');
  assert.equal(revertRes.body.data.current_version, 3, 'a revert is itself a new version, history stays append-only');

  const current = await request(app).get(`/api/designs/by-code/${designCode}`).set('Authorization', `Bearer ${token}`);
  assert.equal(current.body.credential_title, 'Version One Title');

  const versionsRes = await request(app).get(`/api/designs/${designCode}/versions`).set('Authorization', `Bearer ${token}`);
  assert.equal(versionsRes.body.data.length, 3, 'reverting must not delete any prior version');
});

test('an admin from a different organization cannot see or revert another org\'s version history', async () => {
  const createRes = await request(app)
    .post('/api/designs')
    .set('Authorization', `Bearer ${token}`)
    .send({ main_template_url: 'https://example.test/bg.png', template_url: 'https://example.test/bg.png', credential_title: 'Org A template' });
  const designCode = createRes.body.data.design_code;

  const otherToken = jwt.sign({ id: 'x1', username: 'other_admin', role: 'admin', organization_code: 'ORG-DESIGN-VER-OTHER' }, process.env.JWT_SECRET, { algorithm: 'HS256' });

  const listRes = await request(app).get(`/api/designs/${designCode}/versions`).set('Authorization', `Bearer ${otherToken}`);
  assert.equal(listRes.status, 403);

  const revertRes = await request(app).post(`/api/designs/${designCode}/versions/1/revert`).set('Authorization', `Bearer ${otherToken}`);
  assert.equal(revertRes.status, 403);
});

test('a design round-trips real vector shapes (rectangle, line, circle) through create, get, and update', async () => {
  const shapes = [
    { shape_type: 'rectangle', X: 50, Y: 50, width: 200, height: 100, stroke_color: '#111111', fill_color: '#eeeeee', stroke_width: 3, rotation: 0 },
    { shape_type: 'line', X: 0, Y: 0, width: 300, height: 0, stroke_color: '#ff0000', stroke_width: 2, rotation: 0 },
    { shape_type: 'circle', X: 400, Y: 300, width: 80, height: 80, stroke_color: '#0000ff', fill_color: '', stroke_width: 1, rotation: 0 },
  ];
  const createRes = await request(app)
    .post('/api/designs')
    .set('Authorization', `Bearer ${token}`)
    .send({ main_template_url: 'https://example.test/bg.png', template_url: 'https://example.test/bg.png', credential_title: 'Shapes test', shapes });
  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.data.shapes.length, 3);
  assert.equal(createRes.body.data.shapes[0].shape_type, 'rectangle');

  const designCode = createRes.body.data.design_code;
  const getRes = await request(app).get(`/api/designs/by-code/${designCode}`).set('Authorization', `Bearer ${token}`);
  assert.equal(getRes.body.shapes.length, 3);
  assert.equal(getRes.body.shapes[2].shape_type, 'circle');

  const updateRes = await request(app)
    .put(`/api/designs/${designCode}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ shapes: [shapes[0]] });
  assert.equal(updateRes.body.data.shapes.length, 1, 'shapes must be fully replaceable on update, same as text_attributes');
});

test('a design round-trips placed image elements (icons/stickers/AI-generated) through create, get, and update', async () => {
  const images = [
    { url: 'https://example.test/uploads/icon.png', X: 20, Y: 20, width: 80, height: 80, rotation: 0, opacity: 1 },
    { url: 'https://example.test/uploads/ai-generated.jpg', X: 300, Y: 200, width: 400, height: 250, rotation: 15, opacity: 0.7 },
  ];
  const createRes = await request(app)
    .post('/api/designs')
    .set('Authorization', `Bearer ${token}`)
    .send({ main_template_url: 'https://example.test/bg.png', template_url: 'https://example.test/bg.png', credential_title: 'Images test', images });
  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.data.images.length, 2);
  assert.equal(createRes.body.data.images[1].opacity, 0.7);

  const designCode = createRes.body.data.design_code;
  const getRes = await request(app).get(`/api/designs/by-code/${designCode}`).set('Authorization', `Bearer ${token}`);
  assert.equal(getRes.body.images.length, 2);

  const updateRes = await request(app)
    .put(`/api/designs/${designCode}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ images: [images[0]] });
  assert.equal(updateRes.body.data.images.length, 1, 'images must be fully replaceable on update, same as shapes/text_attributes');
});

test('an invalid shape_type is rejected by schema validation', async () => {
  const res = await request(app)
    .post('/api/designs')
    .set('Authorization', `Bearer ${token}`)
    .send({
      main_template_url: 'https://example.test/bg.png', template_url: 'https://example.test/bg.png',
      shapes: [{ shape_type: 'triangle', X: 0, Y: 0, width: 10, height: 10 }],
    });
  assert.equal(res.status, 500); // Mongoose validation error surfaces as 500 here, matching this controller's existing error handling
  assert.match(JSON.stringify(res.body), /shape_type/);
});
