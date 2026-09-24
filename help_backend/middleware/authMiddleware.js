const jwt = require("jsonwebtoken");
const User = require("../models/User");

const authMiddleware = (allowedRoles = []) => async (req, res, next) => {
  const authHeader = req.header("Authorization");
  const token = authHeader?.split(" ")[1] || req.cookies?.helpdesk_token || req.cookies?.helpdesk_otp;

  if (!token) {
    return res.status(401).json({ message: "No token, authorization denied" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

    // For temp OTP tokens
    if (decoded.user_type === "otp") {
      if (allowedRoles.length && !allowedRoles.includes("otp")) {
        return res.status(403).json({ message: "Access denied for OTP users" });
      }
      req.user = decoded;
      return next();
    }

    // For regular users
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    if (allowedRoles.length && !allowedRoles.includes(user.user_type)) {
      return res.status(403).json({ message: "Access denied" });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Token is not valid or expired" });
  }
};

module.exports = authMiddleware;
