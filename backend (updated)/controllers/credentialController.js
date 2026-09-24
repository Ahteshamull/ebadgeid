const Credential = require('../models/credentialSchema');
const User = require('../models/user_model');
const Organization = require('../models/organization_schema');
const AuditLog = require('../models/auditLog');
const CredentialVerificationLog = require('../models/credentialVerificationLog');
const openBadgeSigning = require('../utils/openBadgeSigning');
const logger = require('../utils/logger');
const generateHash = require('../utils/hash_generator');
const { sanitizeCustomFields } = require('../utils/customFields');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { transporter } = require('../utils/smtpTransporter');
const { isManagedStorageUrl, belongsToOrganization } = require('../utils/managedStorage');
const { generateCredentialEmail } = require('../templates/credentialEmailTemplate');
const { sendInAppNotification } = require('../utils/inAppNotification');

// Helper function to format date as string
const formatDate = (date) => {
  return date.toISOString().split('T')[0]; // Returns YYYY-MM-DD format
};

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);

const isAllowedCredentialImage = value => {
  try {
    const parsed = new URL(value);
    const configured = (process.env.CREDENTIAL_IMAGE_ALLOWED_ORIGINS || '')
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean);
    if (process.env.PUBLIC_STORAGE_BASE_URL) {
      configured.push(new URL(process.env.PUBLIC_STORAGE_BASE_URL).origin);
    }
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:')
      && configured.includes(parsed.origin) && isManagedStorageUrl(value);
  } catch {
    return false;
  }
};
// Reused by controllers/brandKitController.js for the same reason it's
// used here -- a brand kit logo is just another managed-storage image, no
// second definition of "which origins are actually trusted" needed.
exports.isAllowedCredentialImage = isAllowedCredentialImage;



// Generates a credential code that's guaranteed unique in the DB. This is
// the single source of truth for credential codes now — the frontend used
// to be expected to send one and never did, which made every credential
// creation call fail validation.
const generateUniqueCredentialCode = async () => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `CRED-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    const exists = await Credential.exists({ credential_code: candidate });
    if (!exists) return candidate;
  }
  throw new Error('Could not generate a unique credential code');
};

// A content-integrity hash — NOT a blockchain record (see AUDIT_FIXES.md for
// why "blockchain" here was misleading marketing language, not a technical
// claim this codebase can back up). It's built only from fields that are
// actually persisted on the document, so it can be recomputed later and
// compared — that's what makes it useful as a tamper check at all. The
// previous version mixed in Date.now() without ever storing it, so it could
// never be recomputed or verified against anything.
const computeIntegrityHash = (cred) => {
  const input = [
    cred.credential_code,
    cred.credential_pic_url,
    cred.achiever_username,
    cred.credential_issue_date,
    cred.credential_expiry_date,
    cred.organization_code,
  ].join('|');
  return crypto.createHash('sha256').update(input).digest('hex');
};

// Fire-and-forget audit trail write — never blocks or fails the actual
// operation just because the audit log couldn't be written (that would be
// worse: a real credential action failing because of a logging problem).
const recordAudit = (event, credential, req, extra = {}) => {
  AuditLog.create({
    entity_type: 'credential',
    entity_id: credential.credential_code,
    event,
    organization_code: credential.organization_code,
    actor_username: req.user?.username || null,
    metadata: extra,
  }).catch((err) => logger.error('audit_log_write_failed', { event, message: err.message }));
};

exports.getCredentialHistory = async (req, res) => {
  try {
    const { credential_code } = req.params;
    const credential = await Credential.findOne({ credential_code });
    if (!credential) return res.status(404).json({ message: 'Credential not found' });
    if (req.user.organization_code && credential.organization_code !== req.user.organization_code) {
      return res.status(403).json({ message: "Not allowed to access another organization's credential" });
    }
    const history = await AuditLog.find({ entity_type: 'credential', entity_id: credential_code })
      .sort({ createdAt: 1 })
      .lean();
    res.status(200).json({ credential_code, history });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
};

exports.computeIntegrityHash = computeIntegrityHash;
// certificate image, so the QR code baked into that image can point at the
// credential's actual verification URL instead of the design template's
// code (which is what every certificate was doing before — see
// AUDIT_FIXES.md, "Diseño de certificados"). The code is reserved, not yet
// attached to a saved credential; createCredential below finalizes it.
exports.reserveCredentialCode = async (req, res) => {
  try {
    const credential_code = await generateUniqueCredentialCode();
    res.status(200).json({ credential_code });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
};

// Shape-checks a guest_recipient payload without trusting it further than
// that — email format, and name fields present and length-capped the same
// way the Users schema caps them (first_name/last_name/designation/city are
// all plain strings there too, see models/user_model.js).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validateGuestRecipient = (guest) => {
  if (!guest || typeof guest !== 'object') return 'guest_recipient must be an object';
  const { email, first_name, last_name } = guest;
  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) return 'guest_recipient.email is required and must be a valid email address';
  if (!first_name || typeof first_name !== 'string') return 'guest_recipient.first_name is required';
  if (!last_name || typeof last_name !== 'string') return 'guest_recipient.last_name is required';
  return null;
};

exports.createCredential = async (req, res) => {
  try {
    const { credential_pic_url, achiever_username, credential_title, guest_recipient, custom_fields: rawCustomFields, bulk_issuance_key: rawBulkKey } = req.body;
    let { credential_code } = req.body;

    if (!credential_pic_url || !achiever_username) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Idempotency key for bulk issuance (see models/credentialSchema.js).
    // Present only on the bulk path; a caller who supplies one is opting
    // into "issue this at most once", which can only ever constrain their
    // own issuance, never anyone else's.
    const bulk_issuance_key = typeof rawBulkKey === 'string' && rawBulkKey.length > 0 && rawBulkKey.length <= 200
      ? rawBulkKey
      : undefined;
    if (bulk_issuance_key) {
      // Scoped to the caller's own organization: the key alone must never
      // be a way to read another tenant's credential.
      const alreadyIssued = await Credential.findOne({
        bulk_issuance_key,
        organization_code: req.user.organization_code,
      }).lean();
      if (alreadyIssued) {
        // A retry of a job whose credential was already written. Report the
        // credential that exists rather than issuing a second one -- and
        // deliberately NOT an error, so the queue marks the job done
        // instead of retrying it forever.
        logger.info('credential_bulk_retry_deduplicated', {
          credential_code: alreadyIssued.credential_code,
          organization_code: req.user.organization_code,
        });
        return res.status(200).json({
          credential_code: alreadyIssued.credential_code,
          credential_title: alreadyIssued.credential_title,
          credential_issue_date: alreadyIssued.credential_issue_date,
          credential_expiry_date: alreadyIssued.credential_expiry_date,
          credential_pic_url: alreadyIssued.credential_pic_url,
          credential_blockchain_hashes: alreadyIssued.credential_blockchain_hashes,
          achiever_details: alreadyIssued.achiever_details,
          organization_detail: alreadyIssued.organization_detail,
          credential_status: alreadyIssued.credential_status,
          already_issued: true,
        });
      }
    }
    if (!isAllowedCredentialImage(credential_pic_url)) {
      return res.status(400).json({ error: 'Credential image URL is not from an approved storage origin' });
    }
    if (!await belongsToOrganization(credential_pic_url, req.user.organization_code)) {
      return res.status(403).json({ error: 'Credential image does not belong to your organization' });
    }
    let custom_fields;
    try {
      custom_fields = sanitizeCustomFields(rawCustomFields);
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    // If the caller already reserved a code (the normal flow — see
    // reserveCredentialCode above), use it. Otherwise generate one now
    // rather than failing, so direct API callers who skip the reservation
    // step still get a working credential instead of a validation error.
    if (credential_code) {
      const alreadyUsed = await Credential.exists({ credential_code });
      if (alreadyUsed) {
        return res.status(409).json({ error: 'credential_code already in use' });
      }
    } else {
      credential_code = await generateUniqueCredentialCode();
    }

    // Fetch Organization — always from the caller's own org, not from a
    // User document, since a guest issuance below has none.
    const organization = await Organization.findOne({ organization_code: req.user.organization_code });
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    let achiever_details;
    let recipientEmail;

    if (guest_recipient) {
      // Issuing to someone with no account in this organization at all —
      // no Users record required. The public verification page (and the
      // download it offers) already works without any login, so once this
      // is issued the recipient needs nothing more than the emailed link
      // to view and download it — see verifications/credentials/[code].
      const validationError = validateGuestRecipient(guest_recipient);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }
      // achiever_username for a guest is free text chosen by the issuing
      // admin (the frontend defaults it to the guest's own name), not
      // looked up against Users like the registered-recipient branch below.
      // If it happens to exactly match a real employee's username in this
      // organization, that employee's GET /by-user/:username would show
      // the guest's credential as their own, and PUT /claim/:code (which
      // only compares achiever_username to req.user.username, with no
      // guest/registered distinction) would let them "claim" it — a
      // credential meant for someone else entirely. Reject the collision
      // outright rather than let it through silently.
      const usernameCollision = await User.exists({
        username: achiever_username,
        organization_code: req.user.organization_code,
      });
      if (usernameCollision) {
        return res.status(409).json({ error: 'This name matches an existing account in your organization. Choose a different display name for the guest, or issue to their real account instead of guest_recipient.' });
      }
      achiever_details = {
        first_name: String(guest_recipient.first_name).slice(0, 100),
        last_name: String(guest_recipient.last_name).slice(0, 100),
        designation: guest_recipient.designation ? String(guest_recipient.designation).slice(0, 100) : '',
        city: guest_recipient.city ? String(guest_recipient.city).slice(0, 100) : '',
      };
      recipientEmail = String(guest_recipient.email).trim().toLowerCase();
    } else {
      // Fetch User
      const user = await User.findOne({
        username: achiever_username,
        organization_code: req.user.organization_code,
      });
      if (!user) {
        return res.status(404).json({ error: 'User not found. To issue to someone without an account here, pass guest_recipient with their name and email instead.' });
      }

      // Check if user has email
      if (!user.email) {
        return res.status(400).json({ error: 'User email not found. Cannot send notification.' });
      }

      // Clean user details (only public fields)
      achiever_details = {
        first_name: user.first_name,
        last_name: user.last_name,
        designation: user.designation,
        city: user.city
      };
      recipientEmail = user.email;
    }

    // Clean organization details (e.g., public support contact)
    const organization_detail = {
      code: organization.organization_code,
      name: organization.name,
      city: organization.city,
      state: organization.state,
      country: organization.country,
      support_email: organization.email,
      support_phone: organization.phone
    };



    // Calculate issue and expiry dates
    const issueDate = new Date();
    const expiryDate = new Date(issueDate);
    expiryDate.setFullYear(expiryDate.getFullYear() + 2); // Add 2 years

    // Format dates as strings
    const credential_issue_date = formatDate(issueDate);
    const credential_expiry_date = formatDate(expiryDate);

    // Integrity hash — see computeIntegrityHash() above for what this is
    // and isn't.
    const blockchain_hash = computeIntegrityHash({
      credential_code,
      credential_pic_url,
      achiever_username,
      credential_issue_date,
      credential_expiry_date,
      organization_code: organization.organization_code,
    });

    // Save credential
    const newCredential = new Credential({
      credential_code,
      credential_title: credential_title || null, // Optional field
      credential_issue_date,
      credential_expiry_date,
      credential_pic_url,
      credential_blockchain_hashes: blockchain_hash,
      achiever_username,
      organization_code: organization.organization_code,
      credential_status: 'Issued', // Default status from schema
      achiever_details,
      organization_detail,
      custom_fields: Object.keys(custom_fields).length ? custom_fields : undefined,
      bulk_issuance_key,
    });

    try {
      await newCredential.save();
    } catch (saveError) {
      // The lookup above closes the ordinary retry case; this closes the
      // race, where two workers get past that check at the same moment.
      // Mongo's unique index is what actually decides, and 11000 on this
      // key means the other one won -- which is a success, not a failure.
      if (saveError?.code === 11000 && bulk_issuance_key && JSON.stringify(saveError.keyPattern || {}).includes('bulk_issuance_key')) {
        const winner = await Credential.findOne({
          bulk_issuance_key,
          organization_code: req.user.organization_code,
        }).lean();
        if (winner) {
          logger.info('credential_bulk_race_deduplicated', {
            credential_code: winner.credential_code,
            organization_code: req.user.organization_code,
          });
          return res.status(200).json({
            credential_code: winner.credential_code,
            credential_title: winner.credential_title,
            credential_issue_date: winner.credential_issue_date,
            credential_expiry_date: winner.credential_expiry_date,
            credential_pic_url: winner.credential_pic_url,
            credential_blockchain_hashes: winner.credential_blockchain_hashes,
            achiever_details: winner.achiever_details,
            organization_detail: winner.organization_detail,
            credential_status: winner.credential_status,
            already_issued: true,
          });
        }
      }
      throw saveError;
    }
    recordAudit('issued', newCredential, req, { credential_title });

    // Send email notification via the shared SMTP transporter
    let emailSent = false;
    try {
      const encodedCredentialCode = encodeURIComponent(credential_code);
      const publicBaseUrl = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '') || 'https://ebadgeid.com';
      const verifyUrl = `${publicBaseUrl}/verifications/credentials/${encodedCredentialCode}`;

      let qrCodeDataUrl = '';
      try {
        qrCodeDataUrl = await QRCode.toDataURL(verifyUrl, {
          width: 280,
          margin: 2,
          color: {
            dark: '#1e293b',
            light: '#ffffff'
          }
        });
      } catch (qrErr) {
        logger.warn('credential_email_qr_generation_failed', { credential_code, error: qrErr.message });
      }

      const emailContent = generateCredentialEmail({
        userDetails: achiever_details,
        organizationDetails: organization_detail,
        credentialCode: credential_code,
        credentialTitle: credential_title,
        issueDate: credential_issue_date,
        expiryDate: credential_expiry_date,
        credentialPicUrl: credential_pic_url,
        contentHash: blockchain_hash,
        qrCodeDataUrl,
        verifyUrl,
      });

      const emailData = {
        from: process.env.EMAIL_USER,
        to: recipientEmail,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      };

      await transporter.sendMail(emailData);
      emailSent = true;
      logger.info('credential_email_sent', { credential_code, organization_code: organization.organization_code });
    } catch (emailError) {
      logger.error('credential_email_failed', { credential_code, message: emailError.message });
      // Continue execution even if email fails - credential was created successfully
    }

    // Proactively create an in-app notification for the recipient
    if (recipientEmail) {
      sendInAppNotification({
        email: recipientEmail,
        title: 'New Credential Issued',
        description: `You have been issued "${credential_title || credential_code}" by ${organization_detail?.organization_name || organization.organization_name || 'your organization'}.`,
      }).catch((notifErr) => {
        logger.warn('credential_in_app_notification_failed', { credential_code, error: notifErr.message });
      });
    }

    // Send clean response
    res.status(201).json({
      credential_code,
      credential_title: credential_title || null,
      credential_issue_date,
      credential_expiry_date,
      credential_pic_url,
      credential_blockchain_hashes: blockchain_hash,
      achiever_details,
      organization_detail,
      credential_status: 'Issued',
      email_sent: emailSent
    });

  } catch (error) {
    console.error('Error creating credential:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
};

// GET /api/credentials/by-organization/:organization_code?page=&limit=
exports.getAllCredentialsByOrganization = async (req, res) => {
  try {
    const { organization_code } = req.params;

    // Pagination values
    let page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    let limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 15, 1), 100);
    let skip = (page - 1) * limit;

    // Step 1: Get usernames in this organization
    const totalCredentials = await Credential.countDocuments({ organization_code });

    // Step 3: Paginated credentials
    let credentials = await Credential.find({ organization_code })
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 }); // newest first, optional

    // Step 4: Update expired credentials (only on current page)
    const currentDate = new Date();
    const updateTasks = [];

    credentials.forEach((cred) => {
      const expiry = new Date(cred.credential_expiry_date);

      if (
        expiry < currentDate &&
        cred.credential_status !== 'Expired' &&
        cred.credential_status !== 'Revoked'
      ) {
        cred.credential_status = 'Expired';
        updateTasks.push(cred.save());
      }
    });

    await Promise.all(updateTasks);

    // Step 5: Return with pagination metadata
    res.json({
      status: "success",
      pagination: {
        current_page: page,
        limit_per_page: limit,
        total_items: totalCredentials,
        total_pages: Math.ceil(totalCredentials / limit),
        has_next_page: page * limit < totalCredentials,
        has_prev_page: page > 1
      },
      data: credentials
    });

  } catch (error) {
    res.status(500).json({ 
      status: "error",
      message: "Server error", 
      details: error.message 
    });
  }
};


// GET /api/credentials/by-user/:username
exports.getCredentialsByUser = async (req, res) => {
  try {
    const { username } = req.params;

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // AUD-107: this endpoint had no organization check at all — any
    // authenticated user, from any organization, could read any other
    // user's full credential list just by knowing (or guessing) their
    // username. Found during a forensic pass building the role/permission
    // matrix for Section 6 of the audit framework (tenant isolation);
    // confirmed by reading the entire function body, which never compared
    // organization_code anywhere. This is a real cross-tenant leak of the
    // platform's core business asset (issued credentials), not a
    // theoretical one — fixed with the same pattern already used and
    // verified correct elsewhere (getGoalById, getScoreById, getUserById,
    // getOrganizationById): admins are exempt from their own org's check
    // by definition of req.user.organization_code being their own, so
    // this is the same one-line guard, not a special case.
    if (req.user.organization_code && user.organization_code !== req.user.organization_code) {
      return res.status(403).json({ message: "Not allowed to access another organization's user credentials" });
    }
    if (req.user.role !== 'admin' && req.user.role !== 'platform_admin' && req.user.username !== username) {
      return res.status(403).json({ message: 'You can only access your own credentials' });
    }

    const credentials = await Credential.find({
      achiever_username: username,
      organization_code: req.user.organization_code,
    });

    if (!credentials || credentials.length === 0) {
      return res.status(404).json({ message: 'No credentials found for this user' });
    }

    // Check for expired credentials and update their status
    const currentDate = new Date();
    for (const credential of credentials) {
      const expiryDate = new Date(credential.credential_expiry_date);
      if (expiryDate < currentDate && credential.credential_status !== 'Expired' && credential.credential_status !== 'Revoked') {
        credential.credential_status = 'Expired';
        await credential.save();
      }
    }

    const organization = await Organization.findOne({ organization_code: user.organization_code });

    res.status(200).json({
      user: {
        first_name: user.first_name,
        last_name: user.last_name,
        designation: user.designation,
        city: user.city,
        username: user.username
      },
      organization: organization
        ? {
            name: organization.name,
            city: organization.city,
            state: organization.state,
            country: organization.country
          }
        : null,
      credentials
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
};

// GET /api/credentials/by-code/:credential_code
const { getCached, setCached, invalidate } = require('../utils/cache');

// PII-exposure fix, found during an audit round: this endpoint is fully
// public (no auth, no rate-limit exemption -- see verifyLimiter in
// routes/credential_routes.js) and used to return the raw stored
// achiever_details/organization_detail objects verbatim. Full name is kept
// deliberately -- confirming *who* earned a credential is the entire point
// of a public verification page (the same model Credly, Accredible, etc.
// use), and removing it would break the legitimate feature, not just
// reduce exposure. What's dropped is everything beyond that identity check
// that this endpoint has no reason to hand to an anonymous caller: the
// recipient's job title and city (workplace/location PII irrelevant to
// verifying the credential itself), and the organization's direct support
// email/phone (a harvestable contact channel, not something needed to
// confirm a credential is genuine -- the org's own public site is the
// right place for that, not a scrapeable-by-code endpoint).
function publicAchieverView(achiever_details) {
  if (!achiever_details) return achiever_details;
  return {
    first_name: achiever_details.first_name,
    last_name: achiever_details.last_name,
  };
}
function publicOrganizationView(organization_detail) {
  if (!organization_detail) return organization_detail;
  const { code, name, city, state, country } = organization_detail;
  return { code, name, city, state, country };
}

exports.getCredentialByCode = async (req, res) => {
  try {
    const { credential_code } = req.params;
    const cacheKey = `credential:${credential_code}`;

    // Cache-aside, 60s TTL. This is the highest-traffic, least-controlled
    // endpoint in the system (public, no auth — anyone with a code can
    // hit it repeatedly). Written and logic-verified here, but NOT
    // verified against a real Redis instance — see README.md. Degrades
    // safely to a normal DB read if REDIS_URL isn't set or Redis is
    // unreachable (utils/cache.js returns null on any failure).
    const cached = await getCached(cacheKey);
    if (cached) {
      // Logged even on a cache hit -- a verification-rate metric that only
      // counted cache misses would silently undercount by up to 60s-TTL
      // worth of repeat views whenever Redis is active.
      CredentialVerificationLog.create({
        credential_code,
        organization_code: cached.organization_code,
      }).catch((err) => logger.error('verification_log_write_failed', { credential_code, message: err.message }));
      return res.json(cached);
    }

    const credential = await Credential.findOne({ credential_code });
    if (!credential) {
      return res.status(404).json({ message: 'Credential not found' });
    }

    // Check if credential is expired
    const currentDate = new Date();
    const expiryDate = new Date(credential.credential_expiry_date);
    if (expiryDate < currentDate && credential.credential_status !== 'Expired' && credential.credential_status !== 'Revoked') {
      credential.credential_status = 'Expired';
      await credential.save();
    }

    // Recompute the integrity hash from what's actually stored right now
    // and compare it against what was stored at issuance. This used to be
    // skipped entirely — the endpoint just returned whatever was in the DB
    // and called it "blockchain verified" without checking anything. Now a
    // record that's been altered after issuance (directly in the DB, by
    // anyone with write access) is flagged instead of silently trusted.
    const recomputed = computeIntegrityHash({
      credential_code: credential.credential_code,
      credential_pic_url: credential.credential_pic_url,
      achiever_username: credential.achiever_username,
      credential_issue_date: credential.credential_issue_date,
      credential_expiry_date: credential.credential_expiry_date,
      organization_code: credential.organization_code,
    });
    // A credential issued before the reproducible content hash existed
    // carries integrity_hash_version 0: back then this field held a
    // pseudo-random value that was never a hash of the credential's content,
    // so recomputing it can never match and saying "integrity check FAILED"
    // accuses a perfectly genuine credential of having been tampered with.
    // Absent means 1 -- anything issued under the current scheme must still
    // fail loudly on a mismatch, which is the entire point of the hash.
    const hashVersion = credential.integrity_hash_version ?? 1;
    const integrity_checkable = hashVersion >= 1;
    const integrity_valid = integrity_checkable
      ? recomputed === credential.credential_blockchain_hashes
      : null; // null = "not checkable", deliberately not false
    const integrity_status = !integrity_checkable
      ? 'not_verifiable'
      : (integrity_valid ? 'verified' : 'failed');

    // Redacted BEFORE caching, not just before responding -- so the cache
    // itself never holds the fuller, non-public shape either.
    const response = {
      ...credential.toObject(),
      achiever_details: publicAchieverView(credential.achiever_details),
      organization_detail: publicOrganizationView(credential.organization_detail),
      integrity_valid,
      integrity_status,
    };
    await setCached(cacheKey, response); // best-effort; never blocks the response on failure

    // Fire-and-forget, same as recordAudit above — never adds latency or
    // a failure mode to the highest-traffic read in this system, just
    // feeds getOrganizationAnalytics' verification-rate number.
    CredentialVerificationLog.create({
      credential_code: credential.credential_code,
      organization_code: credential.organization_code,
    }).catch((err) => logger.error('verification_log_write_failed', { credential_code, message: err.message }));

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
};

// GET /api/credentials/by-code/:credential_code/openbadge
//
// Transforms an already-issued credential into an Open Badges 3.0
// AchievementCredential (the IMS Global / 1EdTech spec, built on the W3C
// Verifiable Credentials Data Model 2.0) -- additive, doesn't touch or
// change anything about how credentials are issued or verified elsewhere.
// Public, same as the base verification endpoint this sits next to: an
// OB3.0 credential is meant to be independently checkable by any wallet or
// verifier, not gated behind a login here.
//
// What this IS: a spec-shaped JSON-LD document with every structural field
// OB3.0 requires (issuer Profile, AchievementSubject, Achievement,
// validFrom/validUntil, a proof block), built from data this system
// already has -- no new database writes, no new fields required on
// existing credentials.
//
// What this is NOT (documented here, not glossed over): the `proof` block
// below reuses this system's existing SHA-256 content-integrity hash
// (computeIntegrityHash, same one already stored as
// credential_blockchain_hashes) rather than a real W3C Data Integrity
// signature from a registered Ed25519/JWK keypair. That's what an actual
// 1EdTech conformance test run requires -- generating and publishing a
// real keypair (typically via a DID document or a hosted JWK set) is a
// one-time setup step for whoever operates this service, not something
// safe to fabricate here. `cryptosuite` is named accordingly
// (`ebadgeid-sha256-integrity-2024`, not a registered W3C cryptosuite
// identifier) so nothing here claims a conformance it hasn't earned yet.
exports.getCredentialAsOpenBadge = async (req, res) => {
  try {
    const { credential_code } = req.params;
    const credential = await Credential.findOne({ credential_code });
    if (!credential) {
      return res.status(404).json({ message: 'Credential not found' });
    }

    const appBaseUrl = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
    const verificationUrl = `${appBaseUrl}/verifications/credentials/${encodeURIComponent(credential.credential_code)}`;
    const achieverName = [credential.achiever_details?.first_name, credential.achiever_details?.last_name]
      .filter(Boolean)
      .join(' ')
      .trim() || credential.achiever_username;
    const org = credential.organization_detail || {};

    const validFrom = new Date(credential.credential_issue_date).toISOString();
    const validUntil = new Date(credential.credential_expiry_date).toISOString();

    const achievementCredential = {
      '@context': [
        'https://www.w3.org/ns/credentials/v2',
        'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json',
      ],
      id: verificationUrl,
      type: ['VerifiableCredential', 'OpenBadgeCredential'],
      issuer: {
        id: `${appBaseUrl}/organizations/code/${encodeURIComponent(org.code || credential.organization_code)}`,
        type: ['Profile'],
        name: org.name || credential.organization_code,
        // No org.support_email here -- same PII-exposure fix as
        // getCredentialByCode above: a direct contact channel isn't needed
        // to verify a credential, and this export is just as fully public.
      },
      validFrom,
      validUntil,
      name: credential.credential_title || 'Credential',
      credentialSubject: {
        type: ['AchievementSubject'],
        name: achieverName,
        achievement: {
          id: `${appBaseUrl}/verifications/credentials/${encodeURIComponent(credential.credential_code)}#achievement`,
          type: ['Achievement'],
          name: credential.credential_title || 'Credential',
          description: `Issued by ${org.name || credential.organization_code}`,
          criteria: { narrative: `Issued by ${org.name || credential.organization_code} to ${achieverName}.` },
          image: credential.credential_pic_url ? { id: credential.credential_pic_url, type: 'Image' } : undefined,
        },
      },
      credentialStatus: {
        id: verificationUrl,
        type: 'eBadgeIDStatus',
        status: credential.credential_status,
      },
    };

    // Real Ed25519 signature (eddsa-jcs-2022, see utils/openBadgeSigning.js)
    // when this deployment has generated and configured an issuer keypair
    // (scripts/generateIssuerKeypair.js); otherwise the same integrity-hash
    // proof as before -- structurally valid, but explicitly not a real
    // signature, same as it's always been documented here.
    if (openBadgeSigning.isConfigured()) {
      const { publicKeyMultibase } = openBadgeSigning.loadIssuerKeyPair();
      achievementCredential.proof = await openBadgeSigning.signCredential(achievementCredential, {
        verificationMethod: openBadgeSigning.verificationMethodId(appBaseUrl, publicKeyMultibase),
      });
    } else {
      achievementCredential.proof = {
        type: 'DataIntegrityProof',
        cryptosuite: 'ebadgeid-sha256-integrity-2024',
        created: credential.createdAt ? credential.createdAt.toISOString() : validFrom,
        verificationMethod: verificationUrl,
        proofPurpose: 'assertionMethod',
        proofValue: credential.credential_blockchain_hashes,
      };
    }

    res.json(achievementCredential);
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
};

// PUT /api/credentials/revoke/:credential_code
exports.revokeCredential = async (req, res) => {
  try {
    const { credential_code } = req.params;
   
    const credential = await Credential.findOne({
      credential_code,
      organization_code: req.user.organization_code,
    });

    if (!credential) {
      return res.status(404).json({ message: 'Credential not found' });
    }

    if (credential.credential_status === 'Revoked') {
      return res.status(400).json({ message: 'Credential is already revoked' });
    }

    credential.credential_status = 'Revoked';
    
    await credential.save();
    recordAudit('revoked', credential, req);
    // Without this, a credential revoked right after being cached could
    // keep showing as valid to the public verification endpoint for up
    // to the cache's 60s TTL — unacceptable for something whose whole
    // point is trustworthy real-time verification.
    await invalidate(`credential:${credential_code}`);

    res.status(200).json({
      message: 'Credential successfully revoked',
      credential_code,
      new_status: credential.credential_status
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
};

// PUT /api/credentials/claim/:credential_code
exports.claimCredential = async (req, res) => {
  try {
    const { credential_code } = req.params;
   
    const credential = await Credential.findOne({
      credential_code,
      organization_code: req.user.organization_code,
      achiever_username: req.user.username,
    });

    if (!credential) {
      return res.status(404).json({ message: 'Credential not found' });
    }

    if (credential.credential_status === 'Claimed') {
      return res.status(400).json({ message: 'Credential is already Claimed' });
    }

    if (credential.credential_status === 'Revoked') {
      return res.status(400).json({ message: 'Cannot claim a revoked credential' });
    }

    if (credential.credential_status === 'Expired') {
      return res.status(400).json({ message: 'Cannot claim an expired credential' });
    }

    credential.credential_status = 'Claimed';
    
    await credential.save();
    recordAudit('claimed', credential, req);

    res.status(200).json({
      message: 'Credential successfully claimed',
      credential_code,
      new_status: credential.credential_status
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
};

// PUT /api/credentials/portal-visibility/:credential_code
//
// Explicit opt-in/opt-out for the public recipient portal
// (getPublicPortalByUsername above) — separate from claimCredential.
// Ownership check is identical to claimCredential's (organization_code +
// achiever_username must match the caller's own session) for the same
// reason: only the credential's own recipient should control this, not
// an org admin or anyone else. Only meaningful on a Claimed credential --
// an unclaimed one was never on the portal in the first place.
exports.setPortalVisibility = async (req, res) => {
  try {
    const { credential_code } = req.params;
    const { visible } = req.body;
    if (typeof visible !== 'boolean') {
      return res.status(400).json({ message: 'Request body must include a boolean "visible" field' });
    }

    const credential = await Credential.findOne({
      credential_code,
      organization_code: req.user.organization_code,
      achiever_username: req.user.username,
    });
    if (!credential) {
      return res.status(404).json({ message: 'Credential not found' });
    }
    if (credential.credential_status !== 'Claimed') {
      return res.status(400).json({ message: 'Only a Claimed credential can have its portal visibility changed' });
    }

    credential.portal_visible = visible;
    await credential.save();
    recordAudit(visible ? 'portal_visibility_enabled' : 'portal_visibility_disabled', credential, req);

    res.status(200).json({ credential_code, portal_visible: credential.portal_visible });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
};

// GET /api/credentials/analytics/organization/:organization_code
//
// Issuer-facing analytics over data this system already has — no new
// external tool, no new database engine. Mongoose aggregation pipelines
// against the existing Credential collection, plus the verification log
// this same round added (see CredentialVerificationLog above), scoped to
// one organization the same way every other org-scoped route already is
// (requireOwnOrg in the route definition).
exports.getOrganizationAnalytics = async (req, res) => {
  try {
    const { organization_code } = req.params;

    const [statusCounts, byMonth, byProgram, verificationCount, totalIssued] = await Promise.all([
      Credential.aggregate([
        { $match: { organization_code } },
        { $group: { _id: '$credential_status', count: { $sum: 1 } } },
      ]),
      Credential.aggregate([
        { $match: { organization_code } },
        { $group: { _id: { $substr: ['$credential_issue_date', 0, 7] }, count: { $sum: 1 } } }, // YYYY-MM
        { $sort: { _id: 1 } },
      ]),
      Credential.aggregate([
        { $match: { organization_code } },
        { $group: { _id: { $ifNull: ['$credential_title', 'Untitled'] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      CredentialVerificationLog.countDocuments({ organization_code }),
      Credential.countDocuments({ organization_code }),
    ]);

    res.status(200).json({
      organization_code,
      total_issued: totalIssued,
      by_status: Object.fromEntries(statusCounts.map((s) => [s._id, s.count])),
      issued_by_month: byMonth.map((m) => ({ month: m._id, count: m.count })),
      top_programs: byProgram.map((p) => ({ credential_title: p._id, count: p.count })),
      total_verifications: verificationCount,
      // A ratio, not a percentage of unique credentials verified — one
      // credential viewed 50 times by the same employer contributes 50,
      // same as 50 different credentials viewed once each. That's the
      // metric an issuer actually wants here (how much third-party
      // verification traffic their credentials are generating), not a
      // per-credential reach count.
      verification_rate: totalIssued > 0 ? Number((verificationCount / totalIssued).toFixed(2)) : 0,
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
};

// GET /api/credentials/portal/:username
//
// The public "all of this person's credentials" page (recipient portal —
// ebadge.id/:username). Deliberately scoped to Claimed credentials only,
// not every credential issued to that username: claiming is an
// affirmative action the credential holder already has to take (see
// claimCredential above, requires their own authenticated session), so a
// Claimed credential is the closest thing this system has to "this person
// has actually agreed this should be publicly associated with them."
// Guest-issued and never-claimed credentials stay off this page even
// though they're independently viewable via their own verification code
// (GET /by-code/:code) — a deliberate difference: that endpoint requires
// already knowing the specific code, this one is browsable by name.
exports.getPublicPortalByUsername = async (req, res) => {
  try {
    const { username } = req.params;
    const credentials = await Credential.find({
      achiever_username: username,
      credential_status: 'Claimed',
      portal_visible: true,
    })
      .select('credential_code credential_title credential_pic_url credential_issue_date organization_detail.name achiever_details')
      .sort({ credential_issue_date: -1 })
      .lean();

    if (credentials.length === 0) {
      return res.status(404).json({ message: 'No public credentials found for this profile' });
    }

    res.status(200).json({
      username,
      display_name: [credentials[0].achiever_details?.first_name, credentials[0].achiever_details?.last_name].filter(Boolean).join(' ') || username,
      credentials: credentials.map((c) => ({
        credential_code: c.credential_code,
        title: c.credential_title,
        image_url: c.credential_pic_url,
        issue_date: c.credential_issue_date,
        organization_name: c.organization_detail?.name,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
};
