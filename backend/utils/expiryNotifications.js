// utils/expiryNotifications.js
//
// Proactive "this credential expires soon" notice -- to both the
// recipient and the organization admin(s) who issued it -- instead of a
// credential's expiry only being noticed the next time someone happens to
// verify it. Meant to run daily via scripts/notifyExpiringCredentials.js
// (same cron pattern as scripts/anchorDailyBatch.js).
const Credential = require('../models/credentialSchema');
const Users = require('../models/user_model');
const AuthCredentials = require('../models/AuthCredentials');
const Notifications = require('../models/notificationsSchema');
const logger = require('./logger');

const DEFAULT_DAYS_AHEAD = 30;

function todayStr() {
  return new Date().toISOString().split('T')[0];
}
function addDaysStr(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}
function daysBetween(fromStr, toStr) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((new Date(toStr) - new Date(fromStr)) / MS_PER_DAY);
}

// Only Claimed credentials -- an Issued-but-never-claimed credential has
// no one actively relying on it yet, and Revoked/Expired are already past
// the point a "this is about to expire" notice would be useful for.
// expiry_notified_at: null is the idempotency gate (see that field's own
// comment in models/credentialSchema.js) -- a daily cron run only ever
// notifies once per credential, not once per day it stays in the window.
async function findExpiringCredentials(daysAhead = DEFAULT_DAYS_AHEAD) {
  return Credential.find({
    credential_status: 'Claimed',
    expiry_notified_at: null,
    credential_expiry_date: { $gte: todayStr(), $lte: addDaysStr(daysAhead) },
  }).lean();
}

// One org admin lookup per distinct organization_code in the batch, not
// per credential -- AuthCredentials (role) and Users (email,
// organization_code) are two separate collections joined only by
// username, so this is necessarily a two-step lookup, cached per run.
async function getOrgAdminEmails(organizationCode, cache) {
  if (cache.has(organizationCode)) return cache.get(organizationCode);
  const orgUsers = await Users.find({ organization_code: organizationCode }).select('username email').lean();
  const usernames = orgUsers.map((u) => u.username);
  const admins = await AuthCredentials.find({ username: { $in: usernames }, user_role: 'admin' }).select('username').lean();
  const adminUsernames = new Set(admins.map((a) => a.username));
  const emails = orgUsers.filter((u) => adminUsernames.has(u.username) && u.email).map((u) => u.email);
  cache.set(organizationCode, emails);
  return emails;
}

async function createNotification(email, title, description) {
  await Notifications.create({
    email,
    notification_title: title,
    notification_description: description,
    issued_at: new Date().toISOString(),
    read: false,
  });
}

// A missing/unconfigured email provider must never make the whole batch
// fail -- the in-app notification (which has no external dependency) is
// the one guarantee; email is best-effort on top of it, same "degrades
// safely" convention as every other optional integration in this
// codebase (Redis, blockchain, AI).
async function trySendEmail(to, args) {
  try {
    const emailService = require('../services/emailService');
    await emailService.sendCredentialExpiryNotice(to, args);
    return true;
  } catch (error) {
    logger.error('expiry_notice_email_failed', { to, credential_code: args.credential_code, message: error.message });
    return false;
  }
}

async function notifyExpiringCredentials(daysAhead = DEFAULT_DAYS_AHEAD) {
  const credentials = await findExpiringCredentials(daysAhead);
  const adminEmailCache = new Map();
  const results = { total: credentials.length, notified: 0, skipped_no_recipient_email: 0 };

  for (const credential of credentials) {
    const daysLeft = daysBetween(todayStr(), credential.credential_expiry_date);
    const recipient = await Users.findOne({
      username: credential.achiever_username,
      organization_code: credential.organization_code,
    }).select('email').lean();

    // Guest-issued credentials (no real account) have no persisted email
    // on the credential itself -- recipientEmail at issuance time is only
    // ever used transiently to send the original issuance notice, never
    // stored. Nothing to notify later without a real account to look up.
    if (!recipient?.email) {
      results.skipped_no_recipient_email += 1;
    } else {
      await createNotification(
        recipient.email,
        `Credential expiring in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
        `"${credential.credential_title || 'Your credential'}" expires on ${credential.credential_expiry_date}.`
      );
      await trySendEmail(recipient.email, {
        credential_title: credential.credential_title,
        credential_code: credential.credential_code,
        expiry_date: credential.credential_expiry_date,
        days_left: daysLeft,
        recipientLabel: 'recipient',
      });
    }

    const adminEmails = await getOrgAdminEmails(credential.organization_code, adminEmailCache);
    for (const adminEmail of adminEmails) {
      await createNotification(
        adminEmail,
        `A credential you issued expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
        `"${credential.credential_title || 'Credential'}" (${credential.credential_code}) issued to ${credential.achiever_username} expires on ${credential.credential_expiry_date}.`
      );
      await trySendEmail(adminEmail, {
        credential_title: credential.credential_title,
        credential_code: credential.credential_code,
        expiry_date: credential.credential_expiry_date,
        days_left: daysLeft,
        recipientLabel: 'admin',
      });
    }

    await Credential.updateOne({ _id: credential._id }, { $set: { expiry_notified_at: new Date() } });
    results.notified += 1;
  }

  return results;
}

module.exports = { findExpiringCredentials, notifyExpiringCredentials, getOrgAdminEmails, DEFAULT_DAYS_AHEAD };
