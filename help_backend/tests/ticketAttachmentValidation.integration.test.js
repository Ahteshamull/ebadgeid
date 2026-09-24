// tests/ticketAttachmentValidation.integration.test.js
//
// E2E audit finding H-04: addMessage's attachment array used to accept
// any string with only Array.isArray()/slice(0,10) -- no check that it
// pointed at a real, managed upload. Now validated the same way
// articleController.js already validates article content URLs: real
// origin (PUBLIC_STORAGE_BASE_URL), real managed-upload path shape.
// Real MongoDB (mongodb-memory-server), real HTTP requests via supertest
// against the actual ticketRoutes router (same minimal-app pattern as
// tests/chatMultiTenant.integration.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';
process.env.PUBLIC_STORAGE_BASE_URL = process.env.PUBLIC_STORAGE_BASE_URL || 'http://localhost:9000';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const jwt = require('jsonwebtoken');

let mongod;
let app;
let userId;
const ORG = 'ORG-TICKET-ATTACH';

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const ticketRoutes = require('../routes/ticketRoutes');
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/tickets', ticketRoutes);

  const User = require('../models/User');
  const user = await User.create({ name: 'Attach Tester', email: 'attach@example.test', password: 'hashedpw', user_type: 'user', org_code: ORG, is_active: true });
  userId = user._id;
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

function authHeader() {
  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  return `Bearer ${token}`;
}

async function makeTicket() {
  const Ticket = require('../models/tickets');
  const ticket = await Ticket.create({
    ticket_code: `TICKET-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    organization_code: ORG,
    ticket_title: 'Attachment validation test ticket',
    ticket_description: 'desc',
    last_activity: new Date().toISOString(),
    ticket_members: [{ user_type: 'user', usernameOrEmail: 'attach@example.test' }],
    priority: 'medium',
  });
  return ticket.ticket_code;
}

test('addMessage rejects an attachment that is not a real managed-storage URL', async () => {
  const ticketCode = await makeTicket();
  const res = await request(app)
    .post(`/api/tickets/${ticketCode}/messages`)
    .set('Authorization', authHeader())
    .send({ message_content: 'here is a file', attachment: ['https://evil.example.com/malware.exe'] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /managed-storage/i);
});

test('addMessage rejects an attachment pointing at a real host but a made-up path', async () => {
  const ticketCode = await makeTicket();
  const res = await request(app)
    .post(`/api/tickets/${ticketCode}/messages`)
    .set('Authorization', authHeader())
    .send({ message_content: 'here', attachment: [`${process.env.PUBLIC_STORAGE_BASE_URL}/not-uploads/whatever.png`] });
  assert.equal(res.status, 400);
});

test('addMessage accepts a real managed-storage upload URL', async () => {
  const ticketCode = await makeTicket();
  const res = await request(app)
    .post(`/api/tickets/${ticketCode}/messages`)
    .set('Authorization', authHeader())
    .send({ message_content: 'here is a real file', attachment: [`${process.env.PUBLIC_STORAGE_BASE_URL}/uploads/abc123def4567890abcd1234.png`] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const lastMessage = res.body.messages[res.body.messages.length - 1];
  assert.equal(lastMessage.attachment[0], `${process.env.PUBLIC_STORAGE_BASE_URL}/uploads/abc123def4567890abcd1234.png`);
});

test('addMessage still works with no attachment at all (plain text message)', async () => {
  const ticketCode = await makeTicket();
  const res = await request(app)
    .post(`/api/tickets/${ticketCode}/messages`)
    .set('Authorization', authHeader())
    .send({ message_content: 'just text, no attachment' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
});
