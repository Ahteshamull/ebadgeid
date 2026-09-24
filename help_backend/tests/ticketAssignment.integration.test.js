// tests/ticketAssignment.integration.test.js
//
// Audit finding: "Asignar ticket a un agente" did not exist -- the only
// related feature was "Add member" (ticket_members), a team-style
// membership list, not a real 1:1 assignment. This proves the real fix
// end to end (real MongoDB via mongodb-memory-server, real HTTP via
// supertest against the actual ticketRoutes router): assigning to a real
// staff member in the same org, rejecting assignment to a plain user or
// to staff from a different org, unassigning, and the same
// organization-scoped isolation every other ticket route already has.
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

async function makeTicket(orgCode, agentToken) {
  const createRes = await request(app)
    .post('/api/tickets')
    .send({ ticket_title: 'X', ticket_description: 'Y', priority: 'low', usernameOrEmail: `customer_${orgCode}@example.test`, organization_code: orgCode });
  return createRes.body.ticket_code;
}

test('an agent can assign a ticket to a real agent in the same organization', async () => {
  await makeOrganization('ORG-ASSIGN-A');
  const { token: actorToken } = await makeStaff('ORG-ASSIGN-A', 'admin', 'admin_a');
  const { user: targetAgent } = await makeStaff('ORG-ASSIGN-A', 'agent', 'agent_a');
  const ticketCode = await makeTicket('ORG-ASSIGN-A', actorToken);

  const res = await request(app)
    .patch(`/api/tickets/${ticketCode}/assign`)
    .set('Authorization', `Bearer ${actorToken}`)
    .send({ email: targetAgent.email });

  assert.equal(res.status, 200);
  assert.equal(res.body.assigned_to, targetAgent.email);
});

test('assigning to a plain user (not admin/agent) is rejected with 400', async () => {
  await makeOrganization('ORG-ASSIGN-B');
  const { token: actorToken } = await makeStaff('ORG-ASSIGN-B', 'admin', 'admin_b');
  const { user: plainUser } = await makeStaff('ORG-ASSIGN-B', 'user', 'plain_user_b');
  const ticketCode = await makeTicket('ORG-ASSIGN-B', actorToken);

  const res = await request(app)
    .patch(`/api/tickets/${ticketCode}/assign`)
    .set('Authorization', `Bearer ${actorToken}`)
    .send({ email: plainUser.email });

  assert.equal(res.status, 400);
});

test('assigning to staff from a DIFFERENT organization is rejected with 400, not silently cross-tenant', async () => {
  await makeOrganization('ORG-ASSIGN-C1');
  await makeOrganization('ORG-ASSIGN-C2');
  const { token: actorToken } = await makeStaff('ORG-ASSIGN-C1', 'admin', 'admin_c1');
  const { user: foreignAgent } = await makeStaff('ORG-ASSIGN-C2', 'agent', 'agent_c2');
  const ticketCode = await makeTicket('ORG-ASSIGN-C1', actorToken);

  const res = await request(app)
    .patch(`/api/tickets/${ticketCode}/assign`)
    .set('Authorization', `Bearer ${actorToken}`)
    .send({ email: foreignAgent.email });

  assert.equal(res.status, 400);
});

test('a plain user cannot assign tickets at all (403)', async () => {
  await makeOrganization('ORG-ASSIGN-D');
  const { token: adminToken } = await makeStaff('ORG-ASSIGN-D', 'admin', 'admin_d');
  const { token: userToken } = await makeStaff('ORG-ASSIGN-D', 'user', 'user_d');
  const { user: agent } = await makeStaff('ORG-ASSIGN-D', 'agent', 'agent_d');
  const ticketCode = await makeTicket('ORG-ASSIGN-D', adminToken);

  const res = await request(app)
    .patch(`/api/tickets/${ticketCode}/assign`)
    .set('Authorization', `Bearer ${userToken}`)
    .send({ email: agent.email });

  assert.equal(res.status, 403);
});

test('an empty email unassigns a previously-assigned ticket', async () => {
  await makeOrganization('ORG-ASSIGN-E');
  const { token: actorToken } = await makeStaff('ORG-ASSIGN-E', 'admin', 'admin_e');
  const { user: agent } = await makeStaff('ORG-ASSIGN-E', 'agent', 'agent_e');
  const ticketCode = await makeTicket('ORG-ASSIGN-E', actorToken);

  const assignRes = await request(app).patch(`/api/tickets/${ticketCode}/assign`).set('Authorization', `Bearer ${actorToken}`).send({ email: agent.email });
  assert.equal(assignRes.body.assigned_to, agent.email);

  const unassignRes = await request(app).patch(`/api/tickets/${ticketCode}/assign`).set('Authorization', `Bearer ${actorToken}`).send({ email: '' });
  assert.equal(unassignRes.status, 200);
  assert.equal(unassignRes.body.assigned_to, null);
});

test('an actor cannot assign a ticket that belongs to a different organization -- rejected, never a cross-tenant success', async () => {
  await makeOrganization('ORG-ASSIGN-F1');
  await makeOrganization('ORG-ASSIGN-F2');
  const { token: actorTokenOrg1, user: agentOrg1 } = await makeStaff('ORG-ASSIGN-F1', 'agent', 'agent_f1');
  const { token: actorTokenOrg2 } = await makeStaff('ORG-ASSIGN-F2', 'admin', 'admin_f2');
  const ticketCodeInOrg2 = await makeTicket('ORG-ASSIGN-F2', actorTokenOrg2);

  // agentOrg1 is a real admin/agent, just in the wrong org for this
  // ticket -- so the assignee-lookup check (scoped to the actor's own
  // org) rejects before the ticket lookup even runs. Either rejection
  // point is fine; what matters is this never succeeds.
  const res = await request(app)
    .patch(`/api/tickets/${ticketCodeInOrg2}/assign`)
    .set('Authorization', `Bearer ${actorTokenOrg1}`)
    .send({ email: agentOrg1.email });

  assert.notEqual(res.status, 200, 'assigning a ticket outside the actor\'s own organization must never succeed');

  const stillUnassigned = await request(app).get(`/api/tickets/${ticketCodeInOrg2}`).set('Authorization', `Bearer ${actorTokenOrg2}`);
  assert.equal(stillUnassigned.body.assigned_to, null, 'the ticket must remain unaffected by the rejected cross-org attempt');
});

test('a newly created ticket starts unassigned (assigned_to is null)', async () => {
  await makeOrganization('ORG-ASSIGN-G');
  const { token } = await makeStaff('ORG-ASSIGN-G', 'admin', 'admin_g');
  const ticketCode = await makeTicket('ORG-ASSIGN-G', token);

  const res = await request(app).get(`/api/tickets/${ticketCode}`).set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.assigned_to, null);
});
