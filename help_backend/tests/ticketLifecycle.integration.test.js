// tests/ticketLifecycle.integration.test.js
//
// Real integration test (real MongoDB via mongodb-memory-server, real HTTP
// requests via supertest against the actual ticketRoutes router) for the
// core ticket lifecycle -- create, list, view, update, change status, add
// a message. Before this file, only attachment validation on messages had
// dedicated coverage (ticketAttachmentValidation.integration.test.js); the
// rest of ticketController.js (createTicket, getAllTickets, getTicketByCode,
// updateTicket, changeStatus, addMessage) had none. Special attention to
// organization_code scoping (ticketAccessFilter in ticketController.js) --
// the same class of cross-tenant isolation already covered for chat/FAQs/
// articles in chatMultiTenant.integration.test.js, but never verified for
// tickets specifically.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const request = require('supertest');

let mongod;
let app;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const ticketRoutes = require('../routes/ticketRoutes');

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/tickets', ticketRoutes);
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
    support_email: `${code.toLowerCase()}@example.test`,
    city: 'City',
    country: 'Country',
  });
}

async function makeStaff(orgCode, userType, emailPrefix) {
  const User = require('../models/User');
  const user = await User.create({
    name: `${userType} ${emailPrefix}`,
    email: `${emailPrefix}@example.test`,
    username: `${emailPrefix}_${orgCode}`,
    password: 'irrelevant-not-used-by-jwt-auth',
    user_type: userType,
    org_code: orgCode,
  });
  const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  return { user, token };
}

test('POST /api/tickets creates a real ticket for an anonymous visitor, scoped to the organization_code they sent', async () => {
  await makeOrganization('ORG-TICKET-A');
  const res = await request(app)
    .post('/api/tickets')
    .send({
      ticket_title: 'Cannot log in',
      ticket_description: 'I get a 500 error every time I try to sign in.',
      priority: 'high',
      usernameOrEmail: 'customer@example.test',
      organization_code: 'ORG-TICKET-A',
    });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.organization_code, 'ORG-TICKET-A');
  assert.equal(res.body.status, 'open');
  assert.equal(res.body.ticket_members.length, 1);
  assert.equal(res.body.messages.length, 1, 'the initial description must also be recorded as the first message');
});

test('POST /api/tickets rejects an organization_code that does not resolve to a real organization', async () => {
  const res = await request(app)
    .post('/api/tickets')
    .send({
      ticket_title: 'X',
      ticket_description: 'Y',
      priority: 'low',
      usernameOrEmail: 'nobody@example.test',
      organization_code: 'ORG-DOES-NOT-EXIST',
    });
  assert.equal(res.status, 400);
});

test('an agent can list and view tickets from their own organization', async () => {
  await makeOrganization('ORG-TICKET-B');
  const { token } = await makeStaff('ORG-TICKET-B', 'agent', 'agent_b');
  const createRes = await request(app)
    .post('/api/tickets')
    .send({ ticket_title: 'Billing question', ticket_description: 'Why was I charged twice?', priority: 'medium', usernameOrEmail: 'billing_customer@example.test', organization_code: 'ORG-TICKET-B' });
  const ticketCode = createRes.body.ticket_code;

  const listRes = await request(app).get('/api/tickets').set('Authorization', `Bearer ${token}`);
  assert.equal(listRes.status, 200);
  assert.ok(listRes.body.some(t => t.ticket_code === ticketCode));

  const getRes = await request(app).get(`/api/tickets/${ticketCode}`).set('Authorization', `Bearer ${token}`);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.ticket_code, ticketCode);
});

test('an agent from a DIFFERENT organization cannot list, view, update, or change the status of a ticket that is not theirs', async () => {
  await makeOrganization('ORG-TICKET-C1');
  await makeOrganization('ORG-TICKET-C2');
  const createRes = await request(app)
    .post('/api/tickets')
    .send({ ticket_title: 'Confidential issue', ticket_description: 'Sensitive details here.', priority: 'urgent', usernameOrEmail: 'c1_customer@example.test', organization_code: 'ORG-TICKET-C1' });
  const ticketCode = createRes.body.ticket_code;

  const { token: outsiderToken } = await makeStaff('ORG-TICKET-C2', 'agent', 'agent_c2');

  const listRes = await request(app).get('/api/tickets').set('Authorization', `Bearer ${outsiderToken}`);
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.some(t => t.ticket_code === ticketCode), false, 'an agent must never see another organization\'s tickets in the list');

  const getRes = await request(app).get(`/api/tickets/${ticketCode}`).set('Authorization', `Bearer ${outsiderToken}`);
  assert.equal(getRes.status, 404, 'looking it up directly by code must not leak it either');

  const updateRes = await request(app).put(`/api/tickets/${ticketCode}`).set('Authorization', `Bearer ${outsiderToken}`).send({ ticket_title: 'Hijacked title' });
  assert.equal(updateRes.status, 404);

  const statusRes = await request(app).patch(`/api/tickets/${ticketCode}/status`).set('Authorization', `Bearer ${outsiderToken}`).send({ status: 'closed' });
  assert.equal(statusRes.status, 404);

  const Ticket = require('../models/tickets');
  const stillIntact = await Ticket.findOne({ ticket_code: ticketCode }).lean();
  assert.equal(stillIntact.ticket_title, 'Confidential issue', 'none of the outsider\'s requests must have modified the ticket');
  assert.equal(stillIntact.status, 'open');
});

test('the ticket-creating customer can add a message; a random unrelated user cannot', async () => {
  await makeOrganization('ORG-TICKET-D');
  const createRes = await request(app)
    .post('/api/tickets')
    .send({ ticket_title: 'Need a refund', ticket_description: 'Product never arrived.', priority: 'medium', usernameOrEmail: 'refund_customer@example.test', organization_code: 'ORG-TICKET-D' });
  const ticketCode = createRes.body.ticket_code;

  const customerToken = jwt.sign({ email: 'refund_customer@example.test', user_type: 'otp', org_code: 'ORG-TICKET-D' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  const messageRes = await request(app)
    .post(`/api/tickets/${ticketCode}/messages`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ message_content: 'Any update on this?' });
  assert.equal(messageRes.status, 200, JSON.stringify(messageRes.body));
  assert.equal(messageRes.body.messages.length, 2);

  // A plain "user" role who is not a member of this ticket: ticketAccessFilter
  // adds a ticket_members.usernameOrEmail match to the query itself for any
  // non-staff role, so the ticket simply doesn't match at the database level
  // and this 404s -- it never reaches addMessage's own isMember/isStaff 403
  // check (that branch is effectively unreachable for a non-staff caller;
  // for admin/agent it's never true either, since isStaff already short-
  // circuits it). Still correctly rejected either way -- just via 404.
  const { token: outsiderToken } = await makeStaff('ORG-TICKET-D', 'user', 'unrelated_user');
  const outsiderRes = await request(app)
    .post(`/api/tickets/${ticketCode}/messages`)
    .set('Authorization', `Bearer ${outsiderToken}`)
    .send({ message_content: 'I am not part of this ticket' });
  assert.equal(outsiderRes.status, 404, 'a plain user who is not a ticket member must be rejected (the org/membership-scoped lookup itself excludes the ticket)');
});

test('an agent can change status and update ticket fields within their own organization', async () => {
  await makeOrganization('ORG-TICKET-E');
  const { token } = await makeStaff('ORG-TICKET-E', 'agent', 'agent_e');
  const createRes = await request(app)
    .post('/api/tickets')
    .send({ ticket_title: 'Original title', ticket_description: 'Desc', priority: 'low', usernameOrEmail: 'e_customer@example.test', organization_code: 'ORG-TICKET-E' });
  const ticketCode = createRes.body.ticket_code;

  const statusRes = await request(app).patch(`/api/tickets/${ticketCode}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'in_progress' });
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.body.status, 'in_progress');

  const updateRes = await request(app).put(`/api/tickets/${ticketCode}`).set('Authorization', `Bearer ${token}`).send({ ticket_title: 'Updated title', priority: 'urgent' });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.ticket_title, 'Updated title');
  assert.equal(updateRes.body.priority, 'urgent');
});

test('PATCH status rejects a value outside the real enum', async () => {
  await makeOrganization('ORG-TICKET-F');
  const { token } = await makeStaff('ORG-TICKET-F', 'admin', 'admin_f');
  const createRes = await request(app)
    .post('/api/tickets')
    .send({ ticket_title: 'X', ticket_description: 'Y', priority: 'low', usernameOrEmail: 'f_customer@example.test', organization_code: 'ORG-TICKET-F' });
  const ticketCode = createRes.body.ticket_code;

  const res = await request(app).patch(`/api/tickets/${ticketCode}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'not_a_real_status' });
  assert.equal(res.status, 400);
});
