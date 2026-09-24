const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const updateLastSeenMiddleware = require("../middleware/autoUpdate");
const {
  register,
  login,
  getProfile,
  updateProfile,
  getAllUsers,
  getActiveAgents,
  updateLastSeen,
  setUserOffline
} = require("../controllers/authController");
const { deleteUser } = require('../controllers/authController');
const { logout } = require('../controllers/authController');

router.post("/register", authMiddleware(["admin"]), register);
router.post("/register-user", authMiddleware(["admin"]), (req, res, next) => {
  req.body.user_type = "user";
  return register(req, res, next);
});
router.post("/login", login);
router.post('/logout', logout);

// Apply auto last-seen update middleware to all authenticated routes
router.get("/profile", authMiddleware(), updateLastSeenMiddleware, getProfile);

router.put("/profile", authMiddleware(), updateLastSeenMiddleware, updateProfile);
router.get("/users", authMiddleware(["admin", "agent"]), getAllUsers);
router.delete('/users/:userId', authMiddleware(['admin']), deleteUser);

// New routes for active agents and last seen functionality
router.get("/agents/active", authMiddleware(["admin", "agent"]), getActiveAgents);
router.put("/last-seen", authMiddleware(), updateLastSeenMiddleware, updateLastSeen);
router.put("/offline", authMiddleware(), setUserOffline); // Don't update last_seen when going offline

// Enhanced agents route with additional info for chat handoff
router.get("/agents/available", authMiddleware(["admin", "agent"]), async (req, res) => {
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
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const User = require("../models/User");
    const activeAgents = await User.find(filters)
      .select("-password")
      .sort({ last_seen: -1 });

    // Calculate workload and availability
    const agentsWithStatus = activeAgents.map(agent => {
      const isCurrentlyActive = agent.isCurrentlyActive();
      
      return {
        id: agent._id,
        name: agent.name,
        username: agent.username,
        email: agent.email,
        last_seen: agent.last_seen,
        isCurrentlyActive: isCurrentlyActive,
        status: isCurrentlyActive ? 'available' : 'recently_active',
        // Was `currentChats: 0` and `responseTime: '< 2 minutes'` hardcoded
        // for every agent regardless of actual load — found during a
        // forensic audit pass (this is a separate, duplicate handler from
        // the one already fixed for the same fake-metrics pattern
        // elsewhere; it was missed in that earlier round). There's no real
        // per-agent chat-session store to compute this from, so it's
        // honestly reported as unavailable rather than as invented numbers.
        currentChats: null,
        maxChats: 5,
        canAcceptNewChats: isCurrentlyActive,
        responseTime: null,
        specialties: agent.specialties || [],
        rating: agent.rating || null,
        languages: agent.languages || ['English']
      };
    });

    // Sort by availability (workload sort removed along with the fake
    // currentChats value it depended on)
    agentsWithStatus.sort((a, b) => {
      if (a.canAcceptNewChats && !b.canAcceptNewChats) return -1;
      if (!a.canAcceptNewChats && b.canAcceptNewChats) return 1;
      return new Date(b.last_seen) - new Date(a.last_seen);
    });

    res.json({
      success: true,
      count: agentsWithStatus.length,
      availableCount: agentsWithStatus.filter(a => a.canAcceptNewChats).length,
      agents: agentsWithStatus,
      estimatedWaitTime: calculateEstimatedWaitTime(agentsWithStatus),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error getting available agents for chat:", error);
    res.status(500).json({
      success: false,
      message: "Unable to retrieve available agents",
      count: 0,
      agents: []
    });
  }
});

// Helper function to calculate estimated wait time
function calculateEstimatedWaitTime(agents) {
  const availableAgents = agents.filter(a => a.canAcceptNewChats);
  
  if (availableAgents.length === 0) {
    return "Currently unavailable";
  }
  
  if (availableAgents.length >= 3) {
    return "Less than 2 minutes";
  } else if (availableAgents.length >= 2) {
    return "2-5 minutes";
  } else {
    return "5-10 minutes";
  }
}

// Agent workload management routes
router.get("/agents/:agentId/workload", authMiddleware(), updateLastSeenMiddleware, async (req, res) => {
  try {
    const { agentId } = req.params;
    
    // Check if requesting user is admin or the agent themselves
    if (req.user.user_type !== 'admin' && req.user.id !== agentId) {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    const User = require('../models/User');
    const agent = await User.findOne({ _id: agentId, org_code: req.user.org_code, user_type: 'agent' });
    if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });

    // No durable chat-session metrics exist yet, so unsupported values are
    // reported explicitly instead of fabricated.
    const workload = {
      agentId: agentId,
      activeChats: null,
      pendingChats: null,
      completedToday: null,
      averageResponseTime: null,
      customerSatisfaction: null,
      status: agent.isCurrentlyActive() ? 'available' : 'offline',
      maxConcurrentChats: 5,
      currentCapacity: null
    };

    res.json({
      success: true,
      workload: workload,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error getting agent workload:", error);
    res.status(500).json({
      success: false,
      message: "Unable to retrieve workload information"
    });
  }});
module.exports = router;
