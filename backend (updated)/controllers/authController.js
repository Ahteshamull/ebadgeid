const User = require('../models/AuthCredentials'); // Auth model (username, password, user_role)
const Users = require('../models/user_model'); // Main user profile model
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Organization = require('../models/organization_schema');
const emailService = require('../services/emailService');
const { setCached } = require('../utils/cache');
const { revokedTokenKey } = require('../utils/tokenRevocation');
const { issueCsrfToken, clearCsrfToken } = require('../middleware/csrfProtection');
const logger = require('../utils/logger');

// The browser session is cookie-only. The frontend uses credentials:include;
// no JWT is returned to or retained by JavaScript.
const AUTH_COOKIE_NAME = 'ebadge_token';
const authCookieBaseOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
});
const authCookieOptions = () => ({
  ...authCookieBaseOptions(),
  ...(process.env.AUTH_COOKIE_DOMAIN ? { domain: process.env.AUTH_COOKIE_DOMAIN } : {}),
  maxAge: 24 * 60 * 60 * 1000, // 1 day — matches the JWT's own expiresIn
});

// Older deployments could issue ebadge_token for the parent domain while
// newer deployments use a host-only cookie. Browsers send both cookies, and
// cookie-parser can then read the stale one first. Clear only the *legacy
// domain-scoped* variants before issuing the fresh current-session cookie.
// The host-only cookie is intentionally not cleared: res.cookie below safely
// replaces it atomically without creating a response that logs the user out.
const clearLegacyAuthCookies = (res) => {
  const domains = new Set();
  if (process.env.AUTH_COOKIE_DOMAIN) domains.add(process.env.AUTH_COOKIE_DOMAIN);
  if (process.env.NODE_ENV === 'production') domains.add('.ebadgeid.com');

  for (const domain of domains) {
    res.clearCookie(AUTH_COOKIE_NAME, { ...authCookieBaseOptions(), domain });
  }
};
exports.AUTH_COOKIE_NAME = AUTH_COOKIE_NAME;
exports.register = async (req, res) => {
  const { username, password } = req.body;

  try {
    if (typeof username !== 'string' || !username || typeof password !== 'string' || password.length < 12) {
      return res.status(400).json({ message: 'Username and a password of at least 12 characters are required' });
    }
    const profile = await Users.findOne({
      username,
      organization_code: req.user.organization_code,
    });
    if (!profile) return res.status(404).json({ message: 'Create the organization profile before activating login' });
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ message: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 12);

    const newUser = new User({ username, password: hashedPassword, user_role: 'user' });
    await newUser.save();

    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// SA-03 fix: Super Admin's "Create Super Admin" form previously posted to
// POST /api/auth/superadmin/register, a route that never existed anywhere
// in this codebase -- the button was wired to a 404. This is a real
// endpoint for it, deliberately separate from the public register() above
// (which always hardcodes user_role: 'user' -- see the privilege-
// escalation fix noted on AuthCredentials.js's user_role field: a
// platform_admin account is "only ever set deliberately... never through a
// public endpoint"). This route is gated by requirePlatformAdmin in
// authRoutes.js, so only an already-authenticated platform_admin can ever
// reach it -- it does not reopen that vulnerability.
const PLATFORM_ADMIN_ORG_CODE = 'SUPER_AD_ORG';
exports.createPlatformAdmin = async (req, res) => {
  const { username, password, first_name, last_name, city, state, country, email, phone, profile_picture_url } = req.body;
  try {
    if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || password.length < 12) {
      return res.status(400).json({ message: 'Username and a password of at least 12 characters are required' });
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'A valid email address is required' });
    }
    const cleanUsername = username.trim();
    const [existingAuth, existingProfile] = await Promise.all([
      User.findOne({ username: cleanUsername }),
      Users.findOne({ username: cleanUsername }),
    ]);
    if (existingAuth || existingProfile) {
      return res.status(409).json({ message: 'An account with this username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    // Both records must exist together or not at all -- login looks up
    // AuthCredentials first, then re-looks-up Users by that same username
    // (see login() below); an Auth record with no matching profile would
    // be a real, hard-to-diagnose account that can authenticate but whose
    // own session bootstrap (/auth/me) 404s.
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await User.create([{ username: cleanUsername, password: hashedPassword, user_role: 'platform_admin' }], { session });
        await Users.create([{
          username: cleanUsername,
          organization_code: PLATFORM_ADMIN_ORG_CODE,
          first_name: (first_name || '').trim() || cleanUsername,
          last_name: (last_name || '').trim() || 'Admin',
          designation: 'Super Admin',
          city: (city || '').trim() || 'N/A',
          state: (state || '').trim() || 'N/A',
          country: (country || '').trim() || 'N/A',
          email: email.trim().toLowerCase(),
          phone: (phone || '').trim() || 'N/A',
          status: 'active',
          profile_picture_url: profile_picture_url || '',
        }], { session });
      });
    } finally {
      await session.endSession();
    }

    res.status(201).json({ message: 'Super admin created successfully', username: cleanUsername });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'An account with this username already exists' });
    }
    res.status(500).json({ message: err.message });
  }
};

exports.activate = async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const token = String(req.body?.token || '');
  const password = req.body?.password;
  const confirmPassword = req.body?.confirmPassword;

  if (!username || token.length < 32) {
    return res.status(400).json({ message: 'Activation link is invalid or has expired' });
  }
  if ((password !== undefined || confirmPassword !== undefined) && (typeof password !== 'string' || password.length < 12)) {
    return res.status(400).json({ message: 'Use a password of at least 12 characters' });
  }
  if ((password !== undefined || confirmPassword !== undefined) && password !== confirmPassword) {
    return res.status(400).json({ message: 'Passwords do not match' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const existing = await User.findOne({
      username,
      activation_token_hash: tokenHash,
      activation_expires_at: { $gt: new Date() },
    }).select('+activation_password_preselected');
    if (!existing) return res.status(400).json({ message: 'Activation link is invalid or has expired' });

    // Platform-created accounts preserve their existing setup-password
    // behavior; self-registered administrators have already selected and
    // bcrypt-hashed their password before this single-use activation click.
    if (!existing.activation_password_preselected && (typeof password !== 'string' || password.length < 12)) {
      return res.status(400).json({ message: 'A password of at least 12 characters is required', requiresPasswordSetup: true });
    }
    const update = {
      $unset: { activation_token_hash: 1, activation_expires_at: 1, activation_password_preselected: 1 },
    };
    if (!existing.activation_password_preselected) {
      update.$set = { password: await bcrypt.hash(password, 12) };
    }
    const user = await User.findOneAndUpdate({
      username,
      activation_token_hash: tokenHash,
      activation_expires_at: { $gt: new Date() },
    }, update, { new: true });
    if (!user) return res.status(400).json({ message: 'Activation link is invalid or has expired' });
    await Users.updateOne({ username }, { $set: { status: 'active' } });
    logger.info('account_activated', { username });
    return res.status(200).json({ message: 'Account activated. You can now sign in.' });
  } catch (error) {
    logger.error('account_activation_failed', { message: error.message });
    return res.status(500).json({ message: 'Unable to activate account' });
  }
};

exports.resendActivation = async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const genericResponse = { message: 'If this account is awaiting activation, a new link will be sent.' };
  if (!username || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) return res.status(202).json(genericResponse);

  try {
    const user = await User.findOne({ username }).select('+activation_token_hash +activation_expires_at +activation_password_preselected');
    if (!user?.activation_token_hash) return res.status(202).json(genericResponse);
    const profile = await Users.findOne({ username }).select('organization_code').lean();
    const organization = profile ? await Organization.findOne({ organization_code: profile.organization_code }).lean() : null;
    if (!organization) return res.status(202).json(genericResponse);

    const activationToken = crypto.randomBytes(32).toString('base64url');
    user.activation_token_hash = crypto.createHash('sha256').update(activationToken).digest('hex');
    user.activation_expires_at = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();
    emailService.sendWelcomeEmail(username, organization, username, activationToken, {
      requiresPasswordSetup: !user.activation_password_preselected,
    }).catch((error) => logger.error('activation_email_resend_failed', { username, message: error.message }));
    return res.status(202).json(genericResponse);
  } catch {
    return res.status(202).json(genericResponse);
  }
};

// Self-service "forgot password" for an already-activated account (P1
// finding, audit round: previously the only related mechanism was
// resendActivation, which only works before an account's first
// activation -- there was no way at all to recover an already-active
// account's forgotten password). Mirrors resendActivation's own pattern:
// a single generic response regardless of whether the username exists,
// is still pending activation, or has no email on file, so this endpoint
// can never be used to enumerate real accounts.
// A 6-digit code has only 1e6 possibilities, so it must never be
// guessable at scale: this caps wrong guesses against a single issued
// code, on top of api.js's IP+username rate limiter. Once exceeded, the
// code is dead and the user has to request a new one.
const OTP_MAX_ATTEMPTS = 5;
const OTP_TTL_MS = 15 * 60 * 1000;

// crypto.randomInt is rejection-sampled and uniform -- Math.random() is
// neither, and must never generate a credential.
const generateOtp = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

// 'super_admin' is a legacy spelling of this codebase's 'platform_admin'
// top tier, held by a real account in the production database. The
// backend already collapses the two when it builds req.user
// (middleware/requireAuth.js), but the role is ALSO handed to the browser
// in three places -- the login response, the JWT payload, and
// GET /auth/me -- and the frontends filter their navigation on it. Left
// raw, a legitimate super_admin signs in successfully and then sees an
// empty sidebar, because no menu entry lists that spelling. Normalizing
// on the way out means the browser only ever sees the canonical value.
const canonicalRole = role => (role === 'super_admin' ? 'platform_admin' : role);

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

// The 32-byte reset token above is safe under a plain hash -- its own
// entropy is what protects it. A 6-digit OTP is not: there are only 1e6
// possibilities, so a plain SHA-256 of one is recoverable by exhaustive
// search in seconds from nothing but a database dump. Keying the digest
// to a server-side secret means a dump alone yields nothing useful,
// because reversing it also requires JWT_SECRET, which never lives in
// the database. (api.js already refuses to boot in production without a
// JWT_SECRET of at least 32 characters.)
const otpDigest = value => crypto
  .createHmac('sha256', process.env.JWT_SECRET || 'insecure-dev-only-otp-key')
  .update(String(value))
  .digest('hex');

// Timing-safe comparison of two hex digests of identical length.
const hashesMatch = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

// Which app the user actually started the recovery from, so the emailed
// link returns them to THAT origin instead of always the main app.
//
// Deliberately an allowlist of origins this deployment already declares
// for itself, never the raw client value: `origin` here comes from a
// request header (or a client-supplied field), and interpolating that
// straight into an email link would let anyone send a real, real-looking
// eBadgeID password-reset email pointing at a host they control -- a
// credential-phishing primitive handed out by our own mailer. An
// unrecognized origin silently falls back to the main app rather than
// erroring, so this can never become an oracle either.
const resolveResetAppBaseUrl = (requestedOrigin) => {
  const normalize = value => (typeof value === 'string' && value ? value.replace(/\/$/, '') : null);
  const appUrl = normalize(process.env.PUBLIC_APP_URL) || 'https://app.ebadgeid.com';
  const allowed = [appUrl, normalize(process.env.PUBLIC_SUPER_ADMIN_URL)].filter(Boolean);
  const candidate = normalize(requestedOrigin);
  if (!candidate) return appUrl;
  try {
    const candidateOrigin = new URL(candidate).origin;
    const match = allowed.find(entry => new URL(entry).origin === candidateOrigin);
    return match || appUrl;
  } catch {
    return appUrl;
  }
};

exports.forgotPassword = async (req, res) => {
  // The current web client submits `username`, but an older deployed
  // password-recovery screen submitted `usernameOrEmail`.  Support both
  // shapes without changing the externally observable response: an unknown
  // identifier still receives the same generic result, preventing account
  // enumeration.  Resolve an actual profile email to its canonical auth
  // username only after validating that the input is a string.
  const identifier = typeof req.body?.username === 'string'
    ? req.body.username.trim().toLowerCase()
    : typeof req.body?.usernameOrEmail === 'string'
      ? req.body.usernameOrEmail.trim().toLowerCase()
      : typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : '';
  const genericResponse = { message: 'If this account exists, a password reset link has been sent.' };
  if (!identifier) return res.status(202).json(genericResponse);

  try {
    let username = identifier;
    let authUser = await User.findOne({ username }).select('+activation_token_hash');
    if (!authUser) {
      const profileByEmail = await Users.findOne({ email: identifier }).select('username').lean();
      if (profileByEmail?.username) {
        username = profileByEmail.username;
        authUser = await User.findOne({ username }).select('+activation_token_hash');
      }
    }
    // An account still awaiting its first activation has no password yet
    // to reset -- that's resendActivation's job, not this one. Same
    // "activation_token_hash present" check login() already uses to tell
    // the two states apart.
    if (!authUser || authUser.activation_token_hash) return res.status(202).json(genericResponse);

    const profile = await Users.findOne({ username }).select('email').lean();
    if (!profile?.email) return res.status(202).json(genericResponse);

    const resetToken = crypto.randomBytes(32).toString('base64url');
    // Issuing a fresh grant overwrites any previous one outright, so a
    // "resend" automatically invalidates the code and link sent before
    // it -- there is only ever one live reset grant per account.
    const otp = generateOtp();
    authUser.reset_token_hash = sha256(resetToken);
    authUser.reset_token_expires_at = new Date(Date.now() + 60 * 60 * 1000);
    authUser.reset_otp_hash = otpDigest(otp);
    authUser.reset_otp_expires_at = new Date(Date.now() + OTP_TTL_MS);
    authUser.reset_otp_attempts = 0;
    await authUser.save();

    // Never trust a client-supplied origin directly -- see
    // resolveResetAppBaseUrl above for why this is allowlisted.
    const appBaseUrl = resolveResetAppBaseUrl(req.body?.app || req.get('origin'));
    emailService.sendPasswordResetEmail(profile.email, username, resetToken, { otp, appBaseUrl }).catch(() => {});
    return res.status(202).json(genericResponse);
  } catch {
    return res.status(202).json(genericResponse);
  }
};

// Exchanges a correct 6-digit code for the reset token that
// forgotPassword already issued alongside it. This is the missing half
// of the onboarding app's recovery screen: that UI has always asked for
// a code and then POSTed here, but no such route existed anywhere in
// this backend -- so step 2 of "Forgot password" 404'd and the flow
// could never complete on that app at all (the main app was unaffected:
// it uses the emailed link and never called this).
//
// Deliberately does NOT sign the user in. A correct code proves control
// of the mailbox, not intent to start a session; the user still has to
// authenticate with their new password afterwards.
exports.verifyOtp = async (req, res) => {
  const identifier = typeof req.body?.usernameOrEmail === 'string'
    ? req.body.usernameOrEmail.trim().toLowerCase()
    : typeof req.body?.username === 'string'
      ? req.body.username.trim().toLowerCase()
      : typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : '';
  const otp = String(req.body?.otp ?? '').trim();

  // One generic failure for every rejection reason below (unknown
  // account, no code issued, expired, too many attempts, simply wrong).
  // Distinguishing them would turn this into both an account-enumeration
  // oracle and a "keep guessing, that one existed" hint.
  const genericFailure = () => res.status(400).json({ message: 'That code is invalid or has expired. Request a new one.' });

  if (!identifier || !/^\d{6}$/.test(otp)) return genericFailure();

  try {
    let username = identifier;
    let authUser = await User.findOne({ username }).select('+reset_otp_hash +reset_otp_expires_at +reset_otp_attempts');
    if (!authUser) {
      const profileByEmail = await Users.findOne({ email: identifier }).select('username').lean();
      if (profileByEmail?.username) {
        username = profileByEmail.username;
        authUser = await User.findOne({ username }).select('+reset_otp_hash +reset_otp_expires_at +reset_otp_attempts');
      }
    }
    if (!authUser?.reset_otp_hash || !authUser.reset_otp_expires_at) return genericFailure();
    if (authUser.reset_otp_expires_at.getTime() <= Date.now()) return genericFailure();
    if ((authUser.reset_otp_attempts || 0) >= OTP_MAX_ATTEMPTS) return genericFailure();

    if (!hashesMatch(otpDigest(otp), authUser.reset_otp_hash)) {
      // Count the miss before answering, so a burst of parallel wrong
      // guesses still walks the counter up.
      await User.updateOne({ _id: authUser._id }, { $inc: { reset_otp_attempts: 1 } });
      return genericFailure();
    }

    // Correct. Mint a fresh reset token and hand back the raw value --
    // the code itself is consumed here (single use), so replaying the
    // same 6 digits a second time falls through to genericFailure above.
    // Minting a new token rather than reusing the emailed one also means
    // a code and a link issued together can't both be spent.
    const resetToken = crypto.randomBytes(32).toString('base64url');
    await User.updateOne({ _id: authUser._id }, {
      $set: {
        reset_token_hash: sha256(resetToken),
        reset_token_expires_at: new Date(Date.now() + 15 * 60 * 1000),
      },
      $unset: { reset_otp_hash: 1, reset_otp_expires_at: 1, reset_otp_attempts: 1 },
    });

    // `username` is the canonical auth username, which the caller needs
    // for the reset-password step (it may have typed an email instead).
    return res.status(200).json({ token: resetToken, username });
  } catch {
    return genericFailure();
  }
};

exports.resetPassword = async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const token = String(req.body?.token || '');
  const password = req.body?.password;
  const confirmPassword = req.body?.confirmPassword;

  if (!username || token.length < 32 || typeof password !== 'string' || password.length < 12) {
    return res.status(400).json({ message: 'A valid reset link and password of at least 12 characters are required' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ message: 'Passwords do not match' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.findOneAndUpdate({
      username,
      reset_token_hash: tokenHash,
      reset_token_expires_at: { $gt: new Date() },
    }, {
      $set: { password: hashedPassword },
      $unset: { reset_token_hash: 1, reset_token_expires_at: 1 },
    });
    if (!user) return res.status(400).json({ message: 'Reset link is invalid or has expired' });
    return res.status(200).json({ message: 'Password updated. You can now sign in.' });
  } catch {
    return res.status(500).json({ message: 'Unable to reset password' });
  }
};

exports.login = async (req, res) => {
  const { username, password } = req.body;

  // username/password must be strings before they ever reach a Mongo query
  // -- otherwise an operator object like {"$ne": null} is passed straight
  // through to User.findOne({ username }) as a NoSQL query operator instead
  // of a literal value match (found by qa_final_harness.js: a genuine
  // injection, not just a 500 from bcrypt.compare rejecting a non-string).
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ message: 'Invalid credentials' });
  }

  try {
    // The login screen explicitly accepts either a username or the
    // institutional/corporate email kept on the profile. Resolve the email
    // to its canonical username before looking up the credential record.
    // Both values are strings at this point (validated above), so neither
    // lookup can be interpreted as a Mongo operator.
    const identifier = username.trim();
    let authUser = await User.findOne({ username: identifier }).select('+password +activation_token_hash');
    if (!authUser && identifier.includes('@')) {
      const profileByEmail = await Users.findOne({ email: identifier.toLowerCase() })
        .select('username')
        .lean();
      if (profileByEmail?.username) {
        authUser = await User.findOne({ username: profileByEmail.username })
          .select('+password +activation_token_hash');
      }
    }

    // Step 1: Check authentication
    if (!authUser || authUser.activation_token_hash) return res.status(400).json({ message: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, authUser.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    // Step 2: Fetch organization_code from Users model
    const userDetails = await Users.findOne({ username: authUser.username });
    if (!userDetails) return res.status(400).json({ message: 'User details not found' });

    // A soft-deleted organization (E2E audit H-22) can no longer log in --
    // otherwise "deleting" an organization would leave every one of its
    // users still able to sign in and use the product as normal. Existing
    // JWTs for that org still expire naturally within 1 day (requireAuth
    // is stateless and doesn't re-check the DB per request, same as every
    // other route), same tradeoff already accepted elsewhere in this app.
    const organization = await Organization.findOne({ organization_code: userDetails.organization_code }).select('status').lean();
    if (organization?.status === 'DELETED') {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Step 3: Generate JWT token with the canonical organization field.
    // jti (a fresh random ID, never reused) is what makes logout able to
    // actually revoke this specific session -- see logout() below and
    // requireAuth.js's revocation check.
    const token = jwt.sign(
      {
        username: authUser.username,
        id: authUser._id,
        role: canonicalRole(authUser.user_role),
        organization_code: userDetails.organization_code,
        jti: crypto.randomUUID(),
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Step 4: replace any legacy cross-subdomain session cookie, then issue
    // the new authenticated cookie. CSRF protection remains enabled and is
    // rotated immediately below for this newly authenticated session.
    clearLegacyAuthCookies(res);
    res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());
    const csrfToken = issueCsrfToken(res);
    res.status(200).json({
      username: authUser.username,
      role: canonicalRole(authUser.user_role),
      organization_code: userDetails.organization_code,
      csrfToken,
    });
  } catch (err) {
    logger.error('login_failed', { message: err.message });
    res.status(500).json({ message: 'Unable to sign in' });
  }
};

exports.logout = async (req, res) => {
  // Revoke the actual token, not just the browser's copy of it -- see
  // utils/tokenRevocation.js for why this is a jti denylist rather than a
  // per-user cutoff. jwt.decode() (not verify) on purpose: a token that's
  // already expired, or was somehow tampered with, still gets its cookie
  // cleared below either way -- there's no security reason to reject an
  // already-harmless logout attempt, and no reason to spend a signature
  // check on a request whose only effect is "try to revoke this".
  const authHeader = req.headers['authorization'];
  const headerToken = authHeader && authHeader.split(' ')[1];
  const token = headerToken || req.cookies?.[AUTH_COOKIE_NAME];
  if (token) {
    try {
      const decoded = jwt.decode(token);
      if (decoded?.jti && decoded?.exp) {
        const ttlSeconds = decoded.exp - Math.floor(Date.now() / 1000);
        if (ttlSeconds > 0) {
          await setCached(revokedTokenKey(decoded.jti), true, ttlSeconds);
        }
      }
    } catch {
      // Malformed token -- nothing to revoke, still clear the cookie below.
    }
  }
  res.clearCookie(AUTH_COOKIE_NAME, authCookieBaseOptions());
  clearLegacyAuthCookies(res);
  clearCsrfToken(res);
  res.status(200).json({ message: 'Logged out' });
};

exports.checkUsernameAvailability = async (req, res) => {
  const { username } = req.body;

  if (typeof username !== 'string' || !username) {
    return res.status(400).json({ message: 'Username is required' });
  }

  try {
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(200).json({ available: false, message: 'Username is already taken' });
    } else {
      return res.status(200).json({ available: true, message: 'Username is available' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.me = async (req, res) => {
  try {
    const { username } = req.user; // added by authenticate middleware

    // 1. Get auth data (role)
    const authUser = await User.findOne({ username });
    if (!authUser) {
      return res.status(404).json({ message: "Auth user not found" });
    }

    // 2. Get extended user details
    const userDetails = await Users.findOne({ username });
    if (!userDetails) {
      return res.status(404).json({ message: "User profile not found" });
    }

    // 3. Return combined user data
    res.status(200).json({
      authenticated: true,
      username: authUser.username,
      role: canonicalRole(authUser.user_role),
      organization_code: userDetails.organization_code,
      profile: userDetails,
    });

  } catch (error) {
    res.status(500).json({
      message: "Error fetching user details",
      error: error.message
    });
  }
};
