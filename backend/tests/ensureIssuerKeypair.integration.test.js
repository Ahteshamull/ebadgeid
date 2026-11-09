// tests/ensureIssuerKeypair.integration.test.js
//
// Real Ed25519 signing is now the default for every new deployment (see
// utils/openBadgeSigning.js's ensureIssuerKeypair(), wired into
// api.js's startServer()) instead of an opt-in manual step. This tests
// the three real behaviors that matter: generated once and persisted
// (not regenerated every boot, which would silently invalidate every
// already-issued signature), an operator-provided env var always wins,
// and a race between two instances booting at the same time doesn't
// crash or leave two different keys active.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test.beforeEach(async () => {
  delete process.env.OB3_ISSUER_PRIVATE_KEY_PEM;
  await require('../models/systemKeypair').deleteMany({});
});

test('ensureIssuerKeypair() generates and persists a real keypair on first boot', async () => {
  const { ensureIssuerKeypair, isConfigured } = require('../utils/openBadgeSigning');
  assert.equal(isConfigured(), false);
  await ensureIssuerKeypair();
  assert.equal(isConfigured(), true);
  assert.match(process.env.OB3_ISSUER_PRIVATE_KEY_PEM, /-----BEGIN PRIVATE KEY-----/);

  const SystemKeypair = require('../models/systemKeypair');
  const stored = await SystemKeypair.findOne({ key_name: 'ob3_issuer' }).select('+private_key_pem').lean();
  assert.ok(stored);
  assert.equal(stored.private_key_pem, process.env.OB3_ISSUER_PRIVATE_KEY_PEM);
});

test('ensureIssuerKeypair() reuses the persisted keypair on a later boot instead of generating a new one', async () => {
  const { ensureIssuerKeypair, loadIssuerKeyPair } = require('../utils/openBadgeSigning');
  await ensureIssuerKeypair();
  const firstPublicKey = loadIssuerKeyPair().publicKeyMultibase;

  delete process.env.OB3_ISSUER_PRIVATE_KEY_PEM; // simulate a fresh process boot with no env var set
  await ensureIssuerKeypair();
  const secondPublicKey = loadIssuerKeyPair().publicKeyMultibase;

  assert.equal(secondPublicKey, firstPublicKey, 'a later boot must not silently rotate the issuer key');
});

test('ensureIssuerKeypair() leaves an operator-provided OB3_ISSUER_PRIVATE_KEY_PEM untouched', async () => {
  const { generateIssuerKeypair, ensureIssuerKeypair } = require('../utils/openBadgeSigning');
  const manual = generateIssuerKeypair();
  process.env.OB3_ISSUER_PRIVATE_KEY_PEM = manual.privateKeyPem;

  await ensureIssuerKeypair();

  assert.equal(process.env.OB3_ISSUER_PRIVATE_KEY_PEM, manual.privateKeyPem);
  const SystemKeypair = require('../models/systemKeypair');
  assert.equal(await SystemKeypair.countDocuments({}), 0, 'must not write to the DB when an operator key is already set');
});

test('ensureIssuerKeypair() handles two instances racing to generate on first boot without crashing or ending up with two different keys', async () => {
  const openBadgeSigning = require('../utils/openBadgeSigning');
  delete require.cache[require.resolve('../utils/openBadgeSigning')]; // fresh module state per "instance"
  const instanceA = require('../utils/openBadgeSigning');
  delete process.env.OB3_ISSUER_PRIVATE_KEY_PEM;
  delete require.cache[require.resolve('../utils/openBadgeSigning')];
  const instanceB = require('../utils/openBadgeSigning');

  await Promise.all([instanceA.ensureIssuerKeypair(), instanceB.ensureIssuerKeypair()]);

  const SystemKeypair = require('../models/systemKeypair');
  const count = await SystemKeypair.countDocuments({ key_name: 'ob3_issuer' });
  assert.equal(count, 1, 'a boot race must not create two competing issuer keys');
});
