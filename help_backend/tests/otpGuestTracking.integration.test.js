const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

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

  const Organization = require('../models/organization');
  await Organization.create({
    organization_code: 'ORG-OTP',
    name: 'OTP Org',
    support_email: 'otp@example.test',
    city: 'City',
    country: 'Country',
  });

  const otpRoutes = require('../routes/otpRoutes');
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/otp', otpRoutes);
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('request-otp sends a development code for a visitor email with no helpdesk user', async () => {
  const res = await request(app)
    .post('/api/otp/request-otp')
    .send({ emailOrUsername: 'visitor@example.test', organization_code: 'ORG-OTP' });

  assert.equal(res.status, 200);
  assert.match(res.body.dev_otp || '', /^\d{6}$/);

  const verify = await request(app)
    .post('/api/otp/verify-otp')
    .send({
      emailOrUsername: 'visitor@example.test',
      organization_code: 'ORG-OTP',
      otp: res.body.dev_otp,
    });

  assert.equal(verify.status, 200);
  assert.equal(verify.body.verified, true);
  assert.ok(verify.headers['set-cookie']?.some(cookie => cookie.startsWith('helpdesk_otp=')));
});

test('request-otp rejects an unknown organization', async () => {
  const res = await request(app)
    .post('/api/otp/request-otp')
    .send({ emailOrUsername: 'visitor@example.test', organization_code: 'NO-SUCH-ORG' });
  assert.equal(res.status, 400);
});
