const User = require("../models/User");
const bcrypt = require("bcryptjs");
const generateToken = require("../utils/generateToken");
const sendMail = require("../utils/sendMail");

const authCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 24 * 60 * 60 * 1000
});

exports.register = async (req, res) => {
  try {
    const { name, password, profile_picture, address, user_type } = req.body;
    // Same NoSQL-injection guard as login: reject non-string email/username
    // instead of letting an object (e.g. {"$ne": null}) reach a $or query.
    const email = typeof req.body.email === 'string' ? req.body.email : '';
    const username = typeof req.body.username === 'string' ? req.body.username : '';

    if (!name || !email || !username || !password) {
      return res.status(400).json({ message: "Name, email, username, and password are required" });
    }

    const exists = await User.findOne({
      org_code: req.user.org_code,
      $or: [{ email }, { username }],
    });
    if (exists) return res.status(400).json({ message: "Email or Username already exists" });

    if (!req.user?.org_code) return res.status(403).json({ message: 'Administrator organization is required' });
    if (password.length < 12) return res.status(400).json({ message: 'Password must contain at least 12 characters' });
    const hashedPassword = await bcrypt.hash(password, 12);

    const newUser = new User({
      name,
      email,
      username,
      password: hashedPassword,
      profile_picture,
      address,
      user_type: ["admin", "agent", "user"].includes(user_type) ? user_type : "user",
      org_code: req.user.org_code,
      last_seen: new Date(), // Set initial last_seen
      is_active: false // User starts as inactive
    });

    await newUser.save();

    // ✅ Send welcome email if user is a support agent
    if (user_type === "agent") {
      const subject = "Welcome to the Support Desk";
      const message = `Welcome ${name}! Your support account has been created.\n\nUsername: ${username}\nEmail: ${email}\nFor security, obtain your initial password from your administrator and change it after your first login.`;
      await sendMail(email, subject, message);
    }

    const safeUser = newUser.toObject();
    delete safeUser.password;
    res.status(201).json(safeUser);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    // Both fields must be plain strings before they ever reach a Mongo
    // query. Unlike this file's other handlers (requestOtp/verifyOtp
    // already do `String(req.body.x || '')`), this endpoint used to pass
    // req.body.emailOrUsername straight into a $or filter — a client could
    // send `{"emailOrUsername": {"$ne": null}, ...}` and have Mongoose
    // evaluate it as a query operator instead of an equality match (NoSQL
    // injection / CWE-943), matching an arbitrary user document instead of
    // a specific account. bcrypt.compare still gates the actual login, but
    // there's no reason to let an object reach the query at all.
    const emailOrUsername = String(req.body.emailOrUsername || '').trim().toLowerCase();
    const orgCode = String(req.body.organization_code || '').trim();
    const { password } = req.body;
    if (!emailOrUsername || !orgCode || typeof password !== 'string') {
      return res.status(400).json({ message: "Invalid credentials" });
    }
    const user = await User.findOne({
      org_code: orgCode,
      $or: [{ email: emailOrUsername }, { username: emailOrUsername }],
    }).select('+password');
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    // Update last seen and set user as active on login
    await User.updateLastSeen(user._id);

    const token = generateToken(user);
    res.cookie('helpdesk_token', token, authCookieOptions());
    const safeUser = user.toObject();
    delete safeUser.password;
    res.json({ user: safeUser });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(400).json({ message: "User ID not found in token" });
    }

    const user = await User.findById(userId).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (err) {
    console.error('getProfile error:', err.message);
    res.status(500).json({ message: err.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const allowedFields = ["name", "username", "profile_picture", "address", "password"];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([key]) => allowedFields.includes(key))
    );
    if (updates.password) {
      updates.password = await bcrypt.hash(updates.password, 10);
    }

    // Note: last_seen is updated by middleware, no need to do it here
    const user = await User.findByIdAndUpdate(req.user.id, updates, { new: true }).select("-password");
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const filters = { org_code: req.user.org_code };

    // Optional filters
    if (req.query.org_code && req.query.org_code !== req.user.org_code) {
      return res.status(403).json({ message: 'Not allowed to access another organization' });
    }
    // Security fix, found during an audit round: only a plain string from
    // the allowed enum is ever assigned into the query filter --
    // req.query.user_type could otherwise be an object (Express's query
    // parser supports ?user_type[$ne]=agent), which would reach Mongo as
    // a real query operator instead of a literal value match. Same
    // pattern already used for asset_type in organizationAssetController.js.
    if (typeof req.query.user_type === 'string' && ['admin', 'agent', 'user'].includes(req.query.user_type)) {
      filters.user_type = req.query.user_type;
    }

    const users = await User.find(filters).select("-password"); // exclude password
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// New endpoint to fetch active agents
exports.getActiveAgents = async (req, res) => {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const filters = {
      org_code: req.user.org_code,
      user_type: "agent",
      $or: [
        { is_active: true, last_seen: { $gte: fiveMinutesAgo } },
        { last_seen: { $gte: fiveMinutesAgo } }
      ]
    };

    // Optional org_code filter
    if (req.query.org_code && req.query.org_code !== req.user.org_code) {
      return res.status(403).json({ message: 'Not allowed to access another organization' });
    }

    const activeAgents = await User.find(filters)
      .select("-password")
      .sort({ last_seen: -1 }); // Sort by most recently active

    // Add computed field for current active status
    const agentsWithStatus = activeAgents.map(agent => ({
      ...agent.toObject(),
      isCurrentlyActive: agent.isCurrentlyActive(),
      lastSeenFormatted: agent.last_seen
    }));

    res.json({
      count: agentsWithStatus.length,
      agents: agentsWithStatus
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Endpoint to manually update user's last seen (useful for heartbeat calls)
// Note: This is now redundant since middleware handles it, but keeping for explicit calls
exports.updateLastSeen = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    
    if (!userId) {
      return res.status(400).json({ message: "User ID not found in token" });
    }

    // Note: Middleware already updated it, but we can confirm the update
    const user = await User.findById(userId).select("-password");
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ 
      message: "Last seen updated successfully (via middleware)",
      last_seen: user.last_seen,
      is_active: user.is_active
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Endpoint to set user as offline
exports.setUserOffline = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    
    if (!userId) {
      return res.status(400).json({ message: "User ID not found in token" });
    }

    const updatedUser = await User.setUserOffline(userId);
    
    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ 
      message: "User set as offline successfully",
      is_active: updatedUser.is_active,
      last_seen: updatedUser.last_seen
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const requesterId = String(req.user._id || req.user.id);
    if (requesterId === req.params.userId) {
      return res.status(400).json({ message: 'You cannot delete your own account' });
    }
    const deleted = await User.findOneAndDelete({
      _id: req.params.userId,
      org_code: req.user.org_code,
    });
    if (!deleted) return res.status(404).json({ message: 'User not found' });
    return res.json({ message: 'User deleted successfully' });
  } catch (err) {
    return res.status(500).json({ message: 'Unable to delete user' });
  }
};

exports.logout = (req, res) => {
  res.clearCookie('helpdesk_token', authCookieOptions());
  res.clearCookie('helpdesk_otp', authCookieOptions());
  res.status(200).json({ message: 'Logged out' });
};
