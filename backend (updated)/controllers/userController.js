const User = require('../models/user_model');
const Organization = require('../models/organization_schema');
const Invitation = require('../models/invitation_schema');
const Auth = require('../models/AuthCredentials');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const encryptionService = require('../utils/cryptoHelper');
const { sendWelcomeEmail } = require('../utils/mailer');
const { wouldExceedUserLimit } = require('../middleware/enforcePlanLimits');
const logger = require('../utils/logger');
// Self-signup user with invite code
exports.self_signup_user = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    // Check for invite code in headers
    const inviteCode = req.headers['x-invite-code'];
    if (!inviteCode) {
      return res.status(400).json({ message: 'Invite code is required in x-invite-code header' });
    }

    // Decrypt the invite code
    let decryptedData;
    try {
      decryptedData = encryptionService.decrypt(inviteCode);
    } catch (error) {
      return res.status(400).json({ message: 'Invalid invite code' });
    }

    // Parse the legacy encrypted invitation payload.
    const [email, orgCode, sixDigitCode] = decryptedData.split(':');
    if (!email || !orgCode || !sixDigitCode) {
      return res.status(400).json({ message: 'Invalid invite code format' });
    }

    const { username, password, confirmPassword } = req.body;
    const allowedProfileFields = ['first_name', 'last_name', 'designation', 'city', 'state', 'country', 'phone', 'profile_picture_url'];
    const profileFields = Object.fromEntries(
      Object.entries(req.body).filter(([key]) => allowedProfileFields.includes(key))
    );
    if (profileFields.profile_picture_url && profileFields.profile_picture_url !== '/avatars/default.svg') {
      try {
        const profileUrl = new URL(profileFields.profile_picture_url);
        const allowedStorageOrigin = new URL(process.env.PUBLIC_STORAGE_BASE_URL).origin;
        if (profileUrl.origin !== allowedStorageOrigin || !/^\/uploads\/profile-[a-f0-9]{32}\.(png|jpe?g|webp)$/i.test(profileUrl.pathname)) {
          return res.status(400).json({ message: 'Profile image URL is not managed by this service' });
        }
      } catch {
        return res.status(400).json({ message: 'Profile image URL is invalid' });
      }
    }
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(String(username || '')) || typeof password !== 'string' || password.length < 12) {
      return res.status(400).json({ message: 'A valid username and a password of at least 12 characters are required' });
    }
    if (confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }
    const requiredProfileFields = ['first_name', 'last_name', 'designation', 'city', 'state', 'country', 'phone'];
    if (!requiredProfileFields.every(field => typeof profileFields[field] === 'string' && profileFields[field].trim())) {
      return res.status(400).json({ message: 'All required profile fields must be completed' });
    }

    let savedUser;
    await session.withTransaction(async () => {
      const invitation = await Invitation.findOne({
        invitation_code: inviteCode,
        status: 'Active',
        expires_at: { $gt: new Date() },
      }).session(session);
      if (!invitation) {
        throw Object.assign(new Error('Invalid or expired invitation code'), { statusCode: 400 });
      }

      // Security fix, found during an audit round: this was the real gap
      // in seat-limit enforcement -- POST /api/users (createUser) checked
      // the plan's max_users, but this is the path virtually every real
      // user actually goes through (admin generates an invite, invitee
      // accepts it here), and it never checked at all. An org on a
      // limited plan could invite and accept unlimited users past its
      // seat count. Checked inside this same transaction, against the
      // invitation's own organization (not any client-supplied value),
      // right before creating the user -- so two invitations accepted
      // concurrently can't both slip past the count check before either
      // commits.
      const limitCheck = await wouldExceedUserLimit(orgCode, { session });
      if (limitCheck.exceeded) {
        throw Object.assign(
          new Error(
            limitCheck.reason === 'limit_reached'
              ? `User limit reached for the ${limitCheck.planName} plan (${limitCheck.limit} users) — ask your organization admin to upgrade before accepting new invitations.`
              : 'Unable to verify plan limits for this organization'
          ),
          { statusCode: 402 }
        );
      }

      const [existingProfile, existingAuth] = await Promise.all([
        User.findOne({ $or: [{ email }, { username }] }).session(session),
        Auth.findOne({ username }).session(session),
      ]);
      if (existingProfile || existingAuth) {
        throw Object.assign(new Error('Email or username is already registered'), { statusCode: 409 });
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      await Auth.create([{
        username,
        password: hashedPassword,
        user_role: 'user',
      }], { session });

      const createdProfiles = await User.create([{
        ...profileFields,
        username,
        email,
        organization_code: orgCode,
        status: 'Active',
      }], { session });
      [savedUser] = createdProfiles;

      invitation.status = 'Expired';
      await invitation.save({ session });
    });

    sendWelcomeEmail(email, `${savedUser.first_name} ${savedUser.last_name}`.trim()).catch((error) => {
      logger.error('signup_welcome_email_failed', { username, message: error.message });
    });

    res.status(201).json(savedUser);
  } catch (error) {
    res.status(error.statusCode || 400).json({ message: error.message });
  } finally {
    await session.endSession();
  }
};

// Create a new user
exports.createUser = async (req, res) => {
  try {
    // Was `new User(req.body)` — an admin could set organization_code to
    // any org in the request body, creating users inside organizations
    // they don't belong to. The new user's org is now always the calling
    // admin's own org, never client-controlled — this is also what makes
    // the plan user-limit check (see routes/userRoutes.js) check the
    // correct organization.
    const user = new User({ ...req.body, organization_code: req.user.organization_code });
    const savedUser = await user.save();
    res.status(201).json(savedUser);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Get all users
exports.getAllUsers = async (req, res) => {
  try {
    // Opt-in limit/skip — response shape (plain array) is unchanged so
    // existing callers keep working, but this now defaults to a sane cap
    // instead of an unbounded dump of every user across every org.
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const skip = parseInt(req.query.skip) || 0;

    // SA-03/SA-04 fix: this used to hard-scope to the caller's own
    // organization_code with no exception, which silently made this
    // endpoint useless for a cross-org caller (super_admin's User
    // Management fetched every user it could see -- only its own org's --
    // then filtered client-side for a designation, so it "worked" only by
    // accident for whichever org happened to hold the super-admin
    // accounts). A platform_admin (this backend's top role) can now see
    // across every organization, exactly like getAllOrganizations already
    // does. Every other role keeps the exact same own-org-only scope as
    // before -- no regression for admin/teacher.
    const filter = {};
    if (req.user.role === 'platform_admin' && req.query.organization_code) {
      filter.organization_code = req.query.organization_code;
    } else if (req.user.role !== 'platform_admin') {
      filter.organization_code = req.user.organization_code;
    }
    if (req.query.designation) {
      filter.designation = req.query.designation;
    }
    if (req.query.status) {
      filter.status = req.query.status;
    }
    // Real server-side search instead of the frontend downloading the
    // full list and filtering with Array.filter() in the browser.
    if (req.query.search) {
      const escaped = String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(escaped, 'i');
      filter.$or = [
        { first_name: pattern },
        { last_name: pattern },
        { email: pattern },
        { username: pattern },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ]);
    // total_count is additive (existing array-consuming callers are
    // unaffected); a new caller can read it for real pagination instead
    // of guessing from the page length.
    res.set('X-Total-Count', String(total));
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get user by ID
exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    // Cross-org IDOR check — was previously just "is this a valid token",
    // not "does this user belong to your organization". See AUDIT_FIXES.md.
    if (req.user.organization_code && user.organization_code !== req.user.organization_code) {
      return res.status(403).json({ message: 'Not allowed to access another organization\'s user' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get user by ID
exports.getUserByUsername = async (req, res) => {
  try {
    const user = await User.findOne({username: req.params.username});
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (req.user.organization_code && user.organization_code !== req.user.organization_code) {
      return res.status(403).json({ message: 'Not allowed to access another organization\'s user' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update user
exports.updateUser = async (req, res) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found' });
    // SA-03 fix: platform_admin (this backend's top role, used by
    // Super Admin) manages users across every organization by design --
    // the same exemption getAllUsers/getAllOrganizations already grant it.
    if (req.user.role !== 'platform_admin' && req.user.organization_code && target.organization_code !== req.user.organization_code) {
      return res.status(403).json({ message: 'Not allowed to modify another organization\'s user' });
    }
    // Auth._id (req.user.id) and Users._id (req.params.id) live in two
    // different collections/ID spaces, joined only by username — so "is
    // this their own profile" has to be checked by username, not by
    // comparing the two _ids directly.
    if (!['admin', 'platform_admin'].includes(req.user.role) && target.username !== req.user.username) {
      return res.status(403).json({ message: 'You can only edit your own profile' });
    }

    // Mass-assignment guard: this used to spread req.body straight into
    // findByIdAndUpdate, so any authenticated caller could rewrite
    // organization_code (moving a user into a different org) or status.
    // Only admins can change status; organization_code can't be changed
    // through this endpoint at all.
    //
    // MED-03 fix (audit finding, confirmed real by code review): username
    // and email were still let through -- Users (this collection) and
    // AuthCredentials (a separate collection, joined ONLY by the username
    // string, never a shared _id) both need to agree on username for login
    // to keep working at all: authController.js's login looks up
    // AuthCredentials by username first, then re-looks-up Users by that
    // SAME username to get organization_code/profile. Changing
    // Users.username here without AuthCredentials.username changing in the
    // same instant would make that second lookup fail for the account's
    // own next login -- a self-inflicted lockout, not a security exploit,
    // but a real one with no recovery path short of an admin fixing the
    // data by hand. A real rename needs a dedicated flow that updates both
    // collections (and re-checks uniqueness) in one transaction -- not
    // built here, since it wasn't asked for; this endpoint just stops
    // being the accidental way to break that link. Switched from a
    // denylist to an explicit allowlist of genuine profile-only fields so
    // adding a new field to the schema later can never silently become
    // editable here by default.
    const allowedProfileFields = ['first_name', 'last_name', 'designation', 'city', 'state', 'country', 'phone', 'profile_picture_url'];
    const allowedFields = Object.fromEntries(
      Object.entries(req.body).filter(([key]) => allowedProfileFields.includes(key))
    );
    if (['admin', 'platform_admin'].includes(req.user.role) && typeof req.body.status === 'string') {
      allowedFields.status = req.body.status;
    }

    const updatedUser = await User.findByIdAndUpdate(req.params.id, allowedFields, {
      new: true,
      runValidators: true,
    });
    res.json(updatedUser);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Delete user
exports.deleteUser = async (req, res) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found' });
    // SA-03 fix: same platform_admin cross-org exemption as updateUser.
    if (req.user.role !== 'platform_admin' && req.user.organization_code && target.organization_code !== req.user.organization_code) {
      return res.status(403).json({ message: 'Not allowed to delete another organization\'s user' });
    }
    await User.findByIdAndDelete(req.params.id);
    // HIGH-02 fix: keeps seat_count (organization_schema.js) in sync with
    // reality -- without this, every deletion would permanently drift the
    // atomic seat counter upward relative to the real Users count,
    // eventually blocking a legitimate signup even with real open seats.
    // $inc: -1 with no floor is intentionally simple: a negative seat_count
    // only ever makes the org's next $lt check MORE permissive than it
    // should be for exactly one signup (a small, self-correcting drift in
    // the safe direction), never blocks a legitimate one.
    await Organization.updateOne({ organization_code: target.organization_code }, { $inc: { seat_count: -1 } });
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
// Get users by organization code
exports.getUsersByOrgCode = async (req, res) => {
  try {
    const { organization_code } = req.params;

    if (!organization_code) {
      return res.status(400).json({ message: 'Organization code is required' });
    }
    // Defense in depth (E2E audit H-21): don't rely solely on the
    // requireOwnOrg route middleware — check it here too.
    if (req.user.organization_code && organization_code !== req.user.organization_code) {
      return res.status(403).json({ message: 'Not allowed to access another organization\'s users' });
    }

    const users = await User.find({ organization_code });

    if (!users || users.length === 0) {
      return res.status(404).json({ message: 'No users found for the given organization code' });
    }

    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
