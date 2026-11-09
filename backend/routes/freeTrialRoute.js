const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { rateLimit } = require('express-rate-limit');

const Organization = require('../models/organization_schema');
const Auth = require('../models/AuthCredentials');
const Users = require('../models/user_model');
const emailService = require('../services/emailService');
const { createRateLimitStore } = require('../utils/distributedRateLimit');

const router = express.Router();
const freeTrialLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: process.env.NODE_ENV !== 'production',
  store: createRateLimitStore('free-trial'),
  message: { message: 'Too many trial requests from this IP, try again later.' },
});

async function generateOrganizationCode(session) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    if (!await Organization.exists({ organization_code: code }).session(session)) return code;
  }
  throw new Error('Unable to allocate an organization code');
}

router.post('/start-free-trial', freeTrialLimiter, async (req, res) => {
  // Audit finding, confirmed real: this endpoint used to hardcode
  // first_name: 'Trial' / last_name: 'Administrator' for every single
  // signup, regardless of who actually filled out the form -- the
  // account's real owner was never asked for their own name, so every
  // free-trial admin's profile and every place that displays it (header,
  // sidebar, Manage Users) permanently showed the same placeholder name
  // instead of a real one.
  const fields = ['name', 'first_name', 'last_name', 'city', 'state', 'country', 'email', 'phone'];
  if (!fields.every(field => typeof req.body?.[field] === 'string' && req.body[field].trim())) {
    return res.status(400).json({ message: 'All organization and contact fields are required.' });
  }
  const email = req.body.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ message: 'A valid email address is required.' });
  }
  if (!/^\+?[\d\s-]{7,15}$/.test(req.body.phone)) {
    return res.status(400).json({ message: 'A valid phone number is required.' });
  }

  const session = await mongoose.startSession();
  try {
    const activationToken = crypto.randomBytes(32).toString('base64url');
    const activationTokenHash = crypto.createHash('sha256').update(activationToken).digest('hex');
    const placeholderPassword = await bcrypt.hash(crypto.randomBytes(32).toString('base64url'), 12);
    let organization;
    let organizationCode;

    await session.withTransaction(async () => {
      if (await Auth.exists({ username: email }).session(session)) {
        const conflict = new Error('Account already exists');
        conflict.code = 11000;
        throw conflict;
      }
      organizationCode = await generateOrganizationCode(session);
      [organization] = await Organization.create([{
        organization_code: organizationCode,
        name: req.body.name.trim().slice(0, 200),
        city: req.body.city.trim().slice(0, 100),
        state: req.body.state.trim().slice(0, 100),
        country: req.body.country.trim().slice(0, 100),
        email,
        phone: req.body.phone.trim(),
        plan: 'Free',
        status: 'TRIAL',
        users: 1,
        logo: '',
        signature: '',
      }], { session });
      await Auth.create([{
        username: email,
        password: placeholderPassword,
        user_role: 'admin',
        activation_token_hash: activationTokenHash,
        activation_expires_at: new Date(Date.now() + 60 * 60 * 1000),
        activation_password_preselected: false,
      }], { session });
      await Users.create([{
        username: email,
        organization_code: organizationCode,
        first_name: req.body.first_name.trim().slice(0, 100),
        last_name: req.body.last_name.trim().slice(0, 100),
        designation: 'Administrator',
        city: req.body.city.trim().slice(0, 100),
        state: req.body.state.trim().slice(0, 100),
        country: req.body.country.trim().slice(0, 100),
        email,
        phone: req.body.phone.trim(),
        status: 'pending_activation',
        profile_picture_url: '',
      }], { session });
    });

    let activationEmailSent = true;
    try {
      await emailService.sendWelcomeEmail(email, organization, email, activationToken, { requiresPasswordSetup: true });
    } catch {
      activationEmailSent = false;
    }
    return res.status(201).json({
      message: 'Free trial created. Check your email to activate the administrator account.',
      organization_code: organizationCode,
      activation_email_sent: activationEmailSent,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'An account already exists for this email.' });
    }
    return res.status(500).json({ message: 'Unable to create free trial.' });
  } finally {
    await session.endSession();
  }
});

module.exports = router;
