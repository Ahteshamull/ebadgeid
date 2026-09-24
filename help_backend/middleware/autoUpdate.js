const User = require("../models/User");

// Middleware to automatically update last_seen for authenticated users
const updateLastSeenMiddleware = async (req, res, next) => {
  try {
    // Only update if user is authenticated
    if (req.user && (req.user.id || req.user._id)) {
      const userId = req.user.id || req.user._id;
      
      console.log(`🔄 Auto-updating last_seen for user: ${userId}`);
      
      // Update last_seen in the background (don't wait for it to avoid slowing down requests)
      User.updateLastSeen(userId).catch(err => {
        console.error('❌ Error updating last_seen:', err);
      });
    }
    
    next();
  } catch (error) {
    console.error('❌ Error in updateLastSeenMiddleware:', error);
    next(); // Continue even if there's an error
  }
};

module.exports = updateLastSeenMiddleware;