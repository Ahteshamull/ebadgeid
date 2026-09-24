// routes/chatRoutes.js
const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const updateLastSeenMiddleware = require("../middleware/autoUpdate");
const ChatRating = require('../models/ChatRating');
const ContactRequest = require('../models/ContactRequest');
const { resolvePublicOrganizationCode } = require('../middleware/publicOrganization');
const {
  handleChat,
  rateChatSession,
  connectToAgent,
  getSessionInfo,
  clearSession,
  getAvailableAgents
} = require("../controllers/chatbotController");

// This REST surface is the fallback path for any consumer that talks to the
// help desk chatbot without opening the WebSocket (websocket/chatSocket.js)
// — the WebSocket generates its own sessionId server-side (uuidv4()) and is
// safe as-is. This REST path used to accept sessionId as a bare client-
// supplied string on every route with no proof the caller was the one who
// started that session: anyone who guessed or intercepted a sessionId could
// read another visitor's chat state via GET /session/:id (name/email
// submitted to connect-agent lands in session.agentConnection.userInfo) or
// clear/rate someone else's session. Same HMAC-over-shared-secret pattern
// already used for OTP (see controllers/otpController.js) — a session now
// only exists after POST /session/start issues both the id and a token tied
// to it, and every other route here requires that token back.
//
// The token now signs sessionId AND organization_code together, not just
// sessionId. This service's public surface used to assume a single
// organization (process.env.DEFAULT_ORG_CODE everywhere); making the chat
// real multi-tenant means the session has to carry which organization it
// belongs to, and that value has to be tamper-proof the same way the
// session id already is — a client can't be trusted to just say "I'm
// organization X" on every request without something proving the server
// itself picked that pairing at /session/start.
const signChatSession = (sessionId, organizationCode) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${sessionId}.${organizationCode}`).digest('hex');

function requireChatSessionToken(req, res, next) {
  const sessionId = req.params.sessionId || req.body.sessionId;
  // organization_code (snake_case) everywhere on the wire, matching the
  // rest of this API's naming (article_code, credential_code, and
  // session/start's own request body below) -- this used to read
  // organizationCode (camelCase) here while session/start's request body
  // used organization_code, an inconsistency a real integrator mirroring
  // this API's own conventions would trip on immediately. req.organizationCode
  // (camelCase) stays as the internal JS property name below; only the
  // wire format changed. See AUDIT_FIXES.md, ronda 21.
  const organizationCode = req.body.organization_code || req.query.organization_code;
  const token = req.get('X-Chat-Session-Token');
  if (!sessionId || !organizationCode || !token) {
    return res.status(401).json({ success: false, message: 'A valid chat session token and organization_code are required — call POST /api/chat/session/start first.' });
  }
  const expected = Buffer.from(signChatSession(String(sessionId), String(organizationCode)));
  const provided = Buffer.from(String(token));
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return res.status(401).json({ success: false, message: 'Invalid or expired chat session token' });
  }
  // The HMAC only verifies once we already trust organizationCode is a real
  // org (otherwise we'd be signing off on garbage the client made up out of
  // thin air on session/start, and just re-validating our own signature of
  // it forever after). Verified once here so every downstream handler can
  // treat req.organizationCode as ground truth.
  req.organizationCode = String(organizationCode);
  next();
}

// Starts a new REST-fallback chat session — the id is generated here, never
// accepted from the client, so the token issued alongside it actually means
// something. organization_code IS accepted from the client here (there's no
// session yet to have derived it from) but is validated against a real
// Organizations document before it ever gets signed into a token.
router.post("/session/start", async (req, res) => {
  const organizationCode = await resolvePublicOrganizationCode(req.body.organization_code);
  if (!organizationCode) {
    return res.status(400).json({ success: false, message: 'A valid organization_code is required to start a chat session' });
  }
  const sessionId = crypto.randomUUID();
  res.json({
    success: true,
    sessionId,
    organization_code: organizationCode,
    sessionToken: signChatSession(sessionId, organizationCode),
    timestamp: new Date().toISOString()
  });
});

// Basic chatbot endpoint (REST API fallback)
router.post("/message", requireChatSessionToken, async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: "Message content is required"
      });
    }

    const response = await handleChat(message.trim(), sessionId, req.organizationCode);

    res.json({
      success: true,
      response: response,
      sessionId: sessionId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Chat message error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to process your message. Please try again.",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Rate chat session
router.post("/rate", requireChatSessionToken, async (req, res) => {
  try {
    const { sessionId, rating, feedback } = req.body;
    
    // Validate input
    if (!sessionId || !rating) {
      return res.status(400).json({
        success: false,
        message: "Session ID and rating are required"
      });
    }
    
    const numericRating = Number(rating);
    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5"
      });
    }

    const result = await rateChatSession(sessionId, numericRating, feedback || '');
    await new ChatRating({
      organization_code: req.organizationCode,
      sessionId,
      rating: numericRating,
      feedback: String(feedback || '').slice(0, 1000),
    }).save();
    
    res.json({
      success: result.success,
      message: result.message,
      sessionId: sessionId,
      rating: {
        score: rating,
        feedback: feedback || '',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("Chat rating error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to save your rating. Please try again."
    });
  }
});

// Request agent connection
router.post("/connect-agent", requireChatSessionToken, async (req, res) => {
  try {
    const { sessionId, userInfo } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: "Session ID is required"
      });
    }

    const result = await connectToAgent(sessionId, userInfo || {}, req.organizationCode);
    
    res.json({
      success: result.success,
      message: result.message,
      agent: result.agent || null,
      estimatedWait: result.estimatedWait || null,
      showContactForm: result.showContactForm || false,
      sessionId: sessionId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Agent connection error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to connect to an agent. Please try again.",
      showContactForm: true
    });
  }
});

// Get available agents — public, no chat session required yet, but still
// needs to know which organization's agents to count.
router.get("/agents/available", async (req, res) => {
  try {
    const organizationCode = await resolvePublicOrganizationCode(req.query.organization_code);
    if (!organizationCode) {
      return res.status(400).json({ success: false, message: 'A valid organization_code is required', count: 0, agents: [] });
    }
    const agents = await getAvailableAgents(organizationCode);
    
    res.json({
      success: true,
      count: agents.count,
      agents: agents.agents.map(agent => ({
        id: agent.id,
        name: agent.name,
        username: agent.username,
        isActive: agent.isCurrentlyActive
      })),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Get available agents error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to retrieve available agents",
      count: 0,
      agents: []
    });
  }
});

// Submit contact form when agents are unavailable
router.post("/contact-request", async (req, res) => {
  try {
    const { sessionId, name, email, message } = req.body;

    // Validate input
    if (![name, email, message].every(value => typeof value === 'string' && value.trim())) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and message are required"
      });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address"
      });
    }
    if (name.length > 100 || message.length > 2000) {
      return res.status(400).json({ success: false, message: 'Contact request is too long' });
    }

    const organizationCode = await resolvePublicOrganizationCode(req.body.organization_code);
    if (!organizationCode) {
      return res.status(400).json({ success: false, message: 'A valid organization_code is required' });
    }

    await new ContactRequest({
      organization_code: organizationCode,
      sessionId: String(sessionId || require('crypto').randomUUID()),
      name: name.trim(),
      email: email.trim().toLowerCase(),
      message: message.trim(),
      status: 'pending',
    }).save();
    
    res.json({
      success: true,
      message: "Thank you! We've received your message and will get back to you within 24 hours.",
      sessionId: sessionId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Contact request error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to submit your request. Please try again."
    });
  }
});

// Get session information
router.get("/session/:sessionId", requireChatSessionToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: "Session ID is required"
      });
    }
    
    const sessionInfo = getSessionInfo(sessionId);
    
    if (!sessionInfo) {
      return res.status(404).json({
        success: false,
        message: "Session not found"
      });
    }
    
    res.json({
      success: true,
      sessionId: sessionId,
      messageCount: sessionInfo.messageCount || 0,
      startTime: sessionInfo.startTime,
      unresolved: sessionInfo.unresolved || false,
      requestedAgent: sessionInfo.requestedAgent || false,
      intents: sessionInfo.intents || [],
      rating: sessionInfo.rating || null,
      agentConnection: sessionInfo.agentConnection || null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Get session info error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to retrieve session information"
    });
  }
});

// Clear session
router.delete("/session/:sessionId", requireChatSessionToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: "Session ID is required"
      });
    }
    
    clearSession(sessionId);
    
    // Also clear Gemini conversation history
    const { clearHistory } = require("../services/geminiService");
    clearHistory(sessionId);
    
    res.json({
      success: true,
      message: "Session cleared successfully",
      sessionId: sessionId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Clear session error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to clear session"
    });
  }
});

// Get chat analytics (for admins)
router.get("/analytics", authMiddleware(), updateLastSeenMiddleware, async (req, res) => {
  try {
    // Check if user is admin/agent
    if (req.user.user_type !== 'admin' && req.user.user_type !== 'agent') {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin or agent privileges required."
      });
    }

    if (!req.user.org_code) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Your account is not assigned to an organization."
      });
    }
    
    const { getAllSessionsCosts } = require("../services/geminiService");
    const costs = await getAllSessionsCosts(req.user.org_code);
    
    // Get additional analytics
    const analytics = {
      totalSessions: costs.totalSessions,
      totalRequests: costs.totalRequests,
      totalCost: costs.formattedGrandTotal,
      averageCostPerRequest: costs.averageCostPerRequest,
      averageCostPerSession: costs.averageCostPerSession,
      topSessions: costs.topSessions,
      timestamp: new Date().toISOString()
    };
    
    res.json({
      success: true,
      analytics: analytics
    });
  } catch (error) {
    console.error("Analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to retrieve analytics"
    });
  }
});

// Health check endpoint
router.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "Chat service is running",
    timestamp: new Date().toISOString(),
    version: "1.0.0"
  });
});

module.exports = router;
