// websocket/agentChatSocket.js
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const { 
  handleChat, 
  rateChatSession, 
  connectToAgent, 
  getSessionInfo, 
  clearSession 
} = require("../controllers/chatbotController");
const { v4: uuidv4 } = require('uuid');
const { resolvePublicOrganizationCode } = require('../middleware/publicOrganization');

// Store connections
const customerSessions = new Map(); // customer connections
const agentSessions = new Map();    // agent connections
const chatRooms = new Map();        // chat room mappings
const typingTimers = new Map();     // typing indicator timers

function initWebSocketWithAgentSupport(server) {
  const wss = new WebSocket.Server({ 
    server,
    clientTracking: true,
    maxPayload: 16 * 1024,
  });

  wss.on("connection", (ws, req) => {
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      ws.close(1008, 'Origin not allowed');
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const isAgent = url.searchParams.get('agent') === 'true';
    const cookies = Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => {
      const separator = part.indexOf('=');
      return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1))];
    }));
    const token = cookies.helpdesk_token;
    
    if (isAgent) {
      handleAgentConnection(ws, token, req);
    } else {
      handleCustomerConnection(ws, req, url.searchParams.get('org'));
    }
  });

  // Handle agent connections
  function handleAgentConnection(ws, token, req) {
    // Authenticate agent
    if (!token) {
      ws.close(1008, 'Authentication token required');
      return;
    }

    let agentInfo;
    try {
      agentInfo = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      
      // Verify agent role
      if (agentInfo.user_type !== 'agent') {
        ws.close(1008, 'Agent privileges required');
        return;
      }
    } catch (error) {
      ws.close(1008, 'Invalid authentication token');
      return;
    }

    const agentId = agentInfo.id || agentInfo._id;
    ws.agentId = agentId;
    ws.agentInfo = agentInfo;

    // If this agent already has a live connection (e.g. a second tab, or a
    // reconnect racing the old socket's close event), close the stale one
    // instead of silently overwriting its Map entry. Without this, the old
    // socket's eventual 'close'/'error' handler would look up agentSessions
    // by agentId, find THIS new session, and delete/mutate it -- wiping the
    // still-open connection's routing state (activeChats, typing
    // indicators) out from under it.
    const existingSession = agentSessions.get(agentId);
    if (existingSession && existingSession.ws !== ws && existingSession.ws.readyState === WebSocket.OPEN) {
      existingSession.ws.close(1000, 'Replaced by a newer connection');
    }

    // Store agent connection
    agentSessions.set(agentId, {
      ws: ws,
      agentInfo: agentInfo,
      connectedAt: new Date(),
      lastActivity: new Date(),
      status: 'available',
      activeChats: new Set(),
      typingIndicators: new Map(), // Track typing state for each chat
      orgCode: agentInfo.org_code,
      ip: req.connection.remoteAddress
    });

    console.log(`Agent ${agentInfo.name} connected - ID: ${agentId}`);

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'agent_connected',
      message: 'Connected to support dashboard',
      agentInfo: {
        id: agentId,
        name: agentInfo.name,
        email: agentInfo.email
      }
    }));

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        // Only the message type is logged, never its content (data.message
        // may be a real chat message; data.sessionId targets a real
        // customer) -- full-content logging here would put PII in plain
        // text into whatever aggregates stdout in production.
        console.log(`Agent ${agentId} sent:`, data.type);

        const session = agentSessions.get(agentId);
        if (session) {
          session.lastActivity = new Date();
        }

        switch (data.type) {
          case 'agent_status_update':
            handleAgentStatusUpdate(agentId, data.status);
            break;

          case 'accept_chat':
            handleAcceptChat(agentId, data.sessionId);
            break;

          case 'agent_message':
            handleAgentMessage(agentId, data.sessionId, data.message);
            break;

          case 'agent_typing':
            handleAgentTyping(agentId, data.sessionId, data.isTyping);
            break;

          case 'end_chat':
            handleEndChat(agentId, data.sessionId);
            break;

          case 'transfer_chat':
            handleTransferChat(agentId, data.sessionId, data.targetAgentId);
            break;

          default:
            console.log('Unknown agent message type:', data.type);
        }
      } catch (error) {
        console.error(`Agent ${agentId} message error:`, error);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid message format'
        }));
      }
    });

    ws.on('close', () => {
      console.log(`Agent ${agentId} disconnected`);

      // Only clean up if this socket is still the one tracked for this
      // agentId. A newer connection (see the replacement check above) may
      // have already taken over the Map entry; in that case this stale
      // socket's close must NOT delete or mutate the live session.
      const session = agentSessions.get(agentId);
      if (!session || session.ws !== ws) return;

      // Clear all typing indicators for this agent
      session.typingIndicators.forEach((_, sessionId) => {
        clearAgentTyping(agentId, sessionId);
      });

      // Handle active chats
      if (session.activeChats.size > 0) {
        // Notify customers about agent disconnection
        session.activeChats.forEach(sessionId => {
          const customerSession = customerSessions.get(sessionId);
          if (customerSession && customerSession.ws.readyState === WebSocket.OPEN) {
            customerSession.ws.send(JSON.stringify({
              type: 'agent_disconnected',
              message: 'Your support agent has disconnected. Please wait while we connect you to another agent.'
            }));

            // Try to reassign to another agent
            reassignCustomerToAgent(sessionId);
          }
        });
      }

      agentSessions.delete(agentId);
    });

    ws.on('error', (error) => {
      console.error(`Agent ${agentId} connection error:`, error);
      // Same guard as 'close': don't delete a newer connection's session.
      const session = agentSessions.get(agentId);
      if (session && session.ws === ws) {
        agentSessions.delete(agentId);
      }
    });
  }

  // Handle customer connections
  //
  // The widget identifies which organization a visitor belongs to via an
  // `org` query param on the WebSocket URL (e.g.
  // wss://hapi.ebadgeid.com?org=ACME), validated here against a real
  // Organizations document before the connection is allowed to do anything.
  // Replaces the previous single process.env.DEFAULT_ORG_CODE used for
  // every visitor regardless of which organization's site they came from.
  async function handleCustomerConnection(ws, req, rawOrgCode) {
    // The organization check below is async (a real query against
    // Organizations), which used to mean the "message" listener wasn't
    // attached until it resolved -- any message the client sent in that
    // window (trivially reachable: a client that sends right on `open`)
    // was silently dropped, no error, no reply. Reproduced with a real
    // WebSocket client -- see AUDIT_FIXES.md, ronda 21. Fixed by
    // registering every listener synchronously, before the first
    // `await`, and buffering whatever arrives until the session is
    // actually ready (or discarding it if the organization turns out to
    // be invalid and the socket gets closed instead).
    let sessionId = null;
    let ready = false;
    const pendingMessages = [];

    ws.on("message", (message) => {
      if (!ready) {
        pendingMessages.push(message);
        return;
      }
      processCustomerMessage(sessionId, message);
    });

    ws.on("close", () => {
      if (!sessionId) return; // never became a real session (org rejected, or closed before validation finished)
      console.log(`Customer ${sessionId} disconnected`);

      // Clear typing indicators
      clearCustomerTyping(sessionId);

      // Notify agent if customer was in chat
      const session = customerSessions.get(sessionId);
      if (session && session.agentId) {
        const agentSession = agentSessions.get(session.agentId);
        if (agentSession && agentSession.ws.readyState === WebSocket.OPEN) {
          agentSession.ws.send(JSON.stringify({
            type: 'customer_disconnected',
            sessionId: sessionId,
            message: 'Customer has left the chat'
          }));

          // Remove from agent's active chats and typing indicators
          agentSession.activeChats.delete(sessionId);
          agentSession.typingIndicators.delete(sessionId);
        }

        // Remove chat room mapping
        chatRooms.delete(sessionId);
      }

      customerSessions.delete(sessionId);

      // Clear session data
      setTimeout(() => {
        const { clearHistory } = require("../services/geminiService");
        clearHistory(sessionId);
        clearSession(sessionId);
      }, 5000);
    });

    ws.on("error", (error) => {
      console.error(`Customer${sessionId ? ' ' + sessionId : ''} connection error:`, error);
      if (sessionId) customerSessions.delete(sessionId);
    });

    const orgCode = await resolvePublicOrganizationCode(rawOrgCode);
    if (!orgCode) {
      ws.close(1008, 'A valid ?org= organization code is required');
      return;
    }

    sessionId = uuidv4();
    ws.sessionId = sessionId;

    customerSessions.set(sessionId, {
      ws: ws,
      sessionId: sessionId,
      connectedAt: new Date(),
      lastActivity: new Date(),
      agentId: null,
      chatHistory: [],
      isTyping: false,
      typingTimer: null,
      orgCode: orgCode,
      messageWindow: { startedAt: Date.now(), count: 0 },
      userAgent: req.headers['user-agent'],
      ip: req.connection.remoteAddress
    });

    console.log(`Customer connected - Session: ${sessionId} (org: ${orgCode})`);

    ready = true;
    // ws.close() above returns before this runs, so the socket may
    // already have gone away by the time we get here for a slow/aborted
    // handshake -- readyState guards against replaying into a dead
    // connection.
    if (ws.readyState === WebSocket.OPEN) {
      for (const message of pendingMessages) {
        processCustomerMessage(sessionId, message);
      }
    }
  }

  // The actual per-message handling logic, unchanged from before except
  // for being extracted into its own function so both the live listener
  // and the buffered-message replay above can call it identically.
  async function processCustomerMessage(sessionId, message) {
    const ws = customerSessions.get(sessionId)?.ws;
    if (!ws) return;
    try {
      let messageData;

      try {
        messageData = JSON.parse(message.toString());
      } catch (e) {
        messageData = {
          type: "message",
          content: message.toString()
        };
      }

      // Only the message type is logged, never its content -- see the
      // matching comment on the agent side above.
      console.log(`Customer ${sessionId} sent:`, messageData.type || 'message');

      const session = customerSessions.get(sessionId);
      if (session) {
        session.lastActivity = new Date();
        const now = Date.now();
        if (now - session.messageWindow.startedAt >= 60_000) {
          session.messageWindow = { startedAt: now, count: 0 };
        }
        session.messageWindow.count += 1;
        if (session.messageWindow.count > 30) {
          ws.close(1008, 'Message rate exceeded');
          return;
        }
      }

      switch (messageData.type) {
        case "message":
        case undefined:
          // Stop typing indicator when message is sent
          handleCustomerTyping(sessionId, false);
          await handleCustomerMessage(sessionId, messageData.content || messageData.message || message.toString());
          break;

        case "typing":
          handleCustomerTyping(sessionId, messageData.isTyping);
          break;

        case "request_agent":
          await handleCustomerAgentRequest(sessionId, messageData.userInfo);
          break;

        case "rate_chat":
          await handleChatRating(sessionId, messageData.rating, messageData.feedback);
          break;

        case "end_chat":
          handleCustomerEndChat(sessionId);
          break;

        default:
          ws.send(JSON.stringify({
            type: "error",
            response: "Unknown message type"
          }));
      }

    } catch (error) {
      console.error(`Customer ${sessionId} message error:`, error);
      ws.send(JSON.stringify({
        type: "error",
        response: "Sorry, something went wrong. Please try again."
      }));
    }
  }

  // Handle customer typing indicators
  function handleCustomerTyping(sessionId, isTyping) {
    const customerSession = customerSessions.get(sessionId);
    if (!customerSession) return;

    // Clear existing timer
    if (customerSession.typingTimer) {
      clearTimeout(customerSession.typingTimer);
      customerSession.typingTimer = null;
    }

    customerSession.isTyping = isTyping;

    // If customer is connected to an agent, forward typing indicator
    if (customerSession.agentId) {
      const agentSession = agentSessions.get(customerSession.agentId);
      if (agentSession && agentSession.ws.readyState === WebSocket.OPEN) {
        agentSession.ws.send(JSON.stringify({
          type: 'customer_typing',
          sessionId: sessionId,
          isTyping: isTyping,
          customerName: `Customer ${sessionId.slice(-4)}`
        }));

        // Auto-stop typing indicator after 3 seconds
        if (isTyping) {
          customerSession.typingTimer = setTimeout(() => {
            handleCustomerTyping(sessionId, false);
          }, 3000);
        }
      }
    }
  }

  // Handle agent typing indicators
  function handleAgentTyping(agentId, sessionId, isTyping) {
    const agentSession = agentSessions.get(agentId);
    const customerSession = customerSessions.get(sessionId);
    
    if (!agentSession || !customerSession) return;

    // Clear existing timer
    const timerId = `${agentId}_${sessionId}`;
    if (typingTimers.has(timerId)) {
      clearTimeout(typingTimers.get(timerId));
      typingTimers.delete(timerId);
    }

    // Update agent's typing state
    agentSession.typingIndicators.set(sessionId, isTyping);

    // Send to customer
    if (customerSession.ws.readyState === WebSocket.OPEN) {
      customerSession.ws.send(JSON.stringify({
        type: "agent_typing",
        isTyping: isTyping,
        agent: agentSession.agentInfo.name
      }));

      // Auto-stop typing indicator after 3 seconds
      if (isTyping) {
        const timer = setTimeout(() => {
          handleAgentTyping(agentId, sessionId, false);
        }, 3000);
        typingTimers.set(timerId, timer);
      }
    }
  }

  // Clear customer typing indicators
  function clearCustomerTyping(sessionId) {
    const customerSession = customerSessions.get(sessionId);
    if (!customerSession) return;

    if (customerSession.typingTimer) {
      clearTimeout(customerSession.typingTimer);
      customerSession.typingTimer = null;
    }
    
    if (customerSession.isTyping) {
      handleCustomerTyping(sessionId, false);
    }
  }

  // Clear agent typing indicators
  function clearAgentTyping(agentId, sessionId) {
    const timerId = `${agentId}_${sessionId}`;
    if (typingTimers.has(timerId)) {
      clearTimeout(typingTimers.get(timerId));
      typingTimers.delete(timerId);
    }

    const agentSession = agentSessions.get(agentId);
    if (agentSession && agentSession.typingIndicators.has(sessionId)) {
      handleAgentTyping(agentId, sessionId, false);
    }
  }

  // Handle customer messages (bot or agent)
  async function handleCustomerMessage(sessionId, message) {
    const customerSession = customerSessions.get(sessionId);
    if (!customerSession) return;

    const ws = customerSession.ws;

    // Check if customer is connected to an agent
    if (customerSession.agentId) {
      // Forward message to agent
      const agentSession = agentSessions.get(customerSession.agentId);
      if (agentSession && agentSession.ws.readyState === WebSocket.OPEN) {
        agentSession.ws.send(JSON.stringify({
          type: 'customer_message',
          sessionId: sessionId,
          message: message,
          customerName: `Customer ${sessionId.slice(-4)}`,
          timestamp: new Date().toISOString()
        }));

        // Store in chat history
        customerSession.chatHistory.push({
          sender: 'customer',
          message: message,
          timestamp: new Date()
        });
      }
    } else {
      // Handle with chatbot - show typing indicator
      ws.send(JSON.stringify({
        type: "bot_typing",
        isTyping: true
      }));

      const response = await handleChat(message, sessionId, customerSession.orgCode);

      // Stop typing indicator
      ws.send(JSON.stringify({
        type: "bot_typing",
        isTyping: false
      }));

      // Check if bot suggests agent handoff
      const sessionInfo = getSessionInfo(sessionId);
      let showHandoffOptions = false;

      if (sessionInfo && (sessionInfo.requestedAgent || sessionInfo.unresolved || sessionInfo.messageCount >= 4)) {
        showHandoffOptions = true;
      }

      ws.send(JSON.stringify({
        type: "response",
        response: response,
        timestamp: new Date().toISOString(),
        showHandoffOptions: showHandoffOptions
      }));

      // Store in chat history
      customerSession.chatHistory.push(
        {
          sender: 'customer',
          message: message,
          timestamp: new Date()
        },
        {
          sender: 'bot',
          message: response,
          timestamp: new Date()
        }
      );
    }
  }

  // Handle customer agent request
  async function handleCustomerAgentRequest(sessionId, userInfo) {
    const customerSession = customerSessions.get(sessionId);
    if (!customerSession) return;

    const ws = customerSession.ws;

    // Find available agent
    const availableAgent = findAvailableAgent(customerSession.orgCode);
    
    if (!availableAgent) {
      ws.send(JSON.stringify({
        type: "agent_unavailable",
        success: false,
        message: "All agents are currently busy. Please try again later or leave a message.",
        showContactForm: true
      }));
      return;
    }

    // Send connection request to agent
    const agentSession = agentSessions.get(availableAgent.agentId);
    if (agentSession && agentSession.ws.readyState === WebSocket.OPEN) {
      // Send chat request to agent
      agentSession.ws.send(JSON.stringify({
        type: 'customer_chat_request',
        sessionId: sessionId,
        customerName: `Customer ${sessionId.slice(-4)}`,
        initialMessage: 'Customer requesting live support',
        priority: 'medium',
        customerInfo: userInfo || {},
        messageHistory: customerSession.chatHistory.slice(-10) // Last 10 messages
      }));

      // Notify customer
      ws.send(JSON.stringify({
        type: "agent_connecting",
        success: true,
        agent: availableAgent,
        message: `Connecting you to ${availableAgent.name}...`,
        estimatedWait: "Less than 2 minutes"
      }));
    }
  }

  // Handle agent accepting chat
  function handleAcceptChat(agentId, sessionId) {
    const agentSession = agentSessions.get(agentId);
    const customerSession = customerSessions.get(sessionId);
    
    if (!agentSession || !customerSession || customerSession.agentId !== agentId) return;
    if (!agentSession.orgCode || agentSession.orgCode !== customerSession.orgCode) return;

    // Create chat room mapping
    chatRooms.set(sessionId, {
      customerId: sessionId,
      agentId: agentId,
      startedAt: new Date(),
      status: 'active'
    });

    // Update sessions
    customerSession.agentId = agentId;
    agentSession.activeChats.add(sessionId);

    // Notify customer
    if (customerSession.ws.readyState === WebSocket.OPEN) {
      customerSession.ws.send(JSON.stringify({
        type: "agent_connected",
        agent: {
          name: agentSession.agentInfo.name,
          id: agentId
        },
        message: `${agentSession.agentInfo.name} has joined the chat. How can I help you?`
      }));
    }

    // Confirm to agent
    if (agentSession.ws.readyState === WebSocket.OPEN) {
      agentSession.ws.send(JSON.stringify({
        type: 'chat_accepted',
        sessionId: sessionId,
        customerName: `Customer ${sessionId.slice(-4)}`,
        message: 'Chat accepted successfully'
      }));
    }

    console.log(`Chat established: Customer ${sessionId} <-> Agent ${agentId}`);
  }

  // Handle agent sending message to customer
  function handleAgentMessage(agentId, sessionId, message) {
    const customerSession = customerSessions.get(sessionId);
    const agentSession = agentSessions.get(agentId);
    
    if (!customerSession || !agentSession || customerSession.agentId !== agentId) return;

    // Clear typing indicator when message is sent
    clearAgentTyping(agentId, sessionId);

    // Send to customer
    if (customerSession.ws.readyState === WebSocket.OPEN) {
      customerSession.ws.send(JSON.stringify({
        type: "agent_response",
        message: message,
        agent: agentSession.agentInfo.name,
        timestamp: new Date().toISOString()
      }));
    }

    // Store in chat history
    customerSession.chatHistory.push({
      sender: 'agent',
      message: message,
      agentName: agentSession.agentInfo.name,
      timestamp: new Date()
    });
  }

  // Handle agent status updates
  function handleAgentStatusUpdate(agentId, status) {
    const agentSession = agentSessions.get(agentId);
    if (agentSession && ['available', 'busy', 'offline'].includes(status)) {
      agentSession.status = status;
      console.log(`Agent ${agentId} status updated to: ${status}`);
    }
  }

  function handleEndChat(agentId, sessionId) {
    const agentSession = agentSessions.get(agentId);
    const customerSession = customerSessions.get(sessionId);
    if (!agentSession || !customerSession || customerSession.agentId !== agentId) return;
    agentSession.activeChats.delete(sessionId);
    customerSession.agentId = null;
    chatRooms.delete(sessionId);
    if (customerSession.ws.readyState === WebSocket.OPEN) {
      customerSession.ws.send(JSON.stringify({ type: 'agent_ended_chat', message: 'The support chat has ended.' }));
    }
  }

  function handleTransferChat(agentId, sessionId, targetAgentId) {
    const currentAgent = agentSessions.get(agentId);
    const targetAgent = agentSessions.get(targetAgentId);
    const customerSession = customerSessions.get(sessionId);
    if (!currentAgent || !targetAgent || !customerSession || customerSession.agentId !== agentId) return;
    if (currentAgent.orgCode !== targetAgent.orgCode || targetAgent.orgCode !== customerSession.orgCode) return;
    if (targetAgent.status !== 'available' || targetAgent.activeChats.size >= 5) return;
    currentAgent.activeChats.delete(sessionId);
    targetAgent.activeChats.add(sessionId);
    customerSession.agentId = targetAgentId;
    chatRooms.set(sessionId, { customerId: sessionId, agentId: targetAgentId, startedAt: new Date(), status: 'active' });
    if (customerSession.ws.readyState === WebSocket.OPEN) {
      customerSession.ws.send(JSON.stringify({
        type: 'agent_transferred',
        agent: { id: targetAgentId, name: targetAgent.agentInfo.name },
      }));
    }
  }

  // Find available agent
  function findAvailableAgent(orgCode) {
    for (const [agentId, session] of agentSessions.entries()) {
      if (session.orgCode === orgCode && session.status === 'available' && session.activeChats.size < 5) { // Max 5 concurrent chats
        return {
          agentId: agentId,
          name: session.agentInfo.name,
          activeChats: session.activeChats.size
        };
      }
    }
    return null;
  }

  // Reassign customer to another agent
  function reassignCustomerToAgent(sessionId) {
    const customerSession = customerSessions.get(sessionId);
    const availableAgent = customerSession ? findAvailableAgent(customerSession.orgCode) : null;
    if (availableAgent) {
      handleCustomerAgentRequest(sessionId, {});
    }
  }

  // Handle chat rating
  async function handleChatRating(sessionId, rating, feedback) {
    const customerSession = customerSessions.get(sessionId);
    if (!customerSession) return;

    const result = await rateChatSession(sessionId, rating, feedback);
    
    customerSession.ws.send(JSON.stringify({
      type: "rating_received",
      success: result.success,
      message: result.message,
      showAgentOption: !customerSession.agentId // Only show if not already with agent
    }));
  }

  // Handle customer ending chat
  function handleCustomerEndChat(sessionId) {
    const customerSession = customerSessions.get(sessionId);
    if (!customerSession) return;

    customerSession.ws.send(JSON.stringify({
      type: "chat_ending",
      showHandoffOptions: true,
      message: "Thank you for chatting with us! Before you go:",
      options: {
        rating: true,
        agentConnect: !customerSession.agentId // Only if not with agent
      }
    }));
  }

  // Cleanup functions
  const cleanupInterval = setInterval(() => {
    const now = new Date();
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
    
    // Clean up inactive customer sessions
    for (const [sessionId, session] of customerSessions.entries()) {
      if (session.lastActivity < thirtyMinutesAgo) {
        clearCustomerTyping(sessionId);
        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.close(1000, 'Session timeout');
        }
        customerSessions.delete(sessionId);
        chatRooms.delete(sessionId);
      }
    }

    // Clean up inactive agent sessions
    for (const [agentId, session] of agentSessions.entries()) {
      if (session.lastActivity < thirtyMinutesAgo) {
        // Clear all typing indicators for this agent
        session.typingIndicators.forEach((_, sessionId) => {
          clearAgentTyping(agentId, sessionId);
        });
        
        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.close(1000, 'Session timeout');
        }
        agentSessions.delete(agentId);
      }
    }

    // Clean up orphaned typing timers
    for (const [timerId, timer] of typingTimers.entries()) {
      const [agentId, sessionId] = timerId.split('_');
      if (!agentSessions.has(agentId) || !customerSessions.has(sessionId)) {
        clearTimeout(timer);
        typingTimers.delete(timerId);
      }
    }
  }, 5 * 60 * 1000); // Check every 5 minutes

  // Add utility methods
  wss.getActiveCustomersCount = () => customerSessions.size;
  wss.getActiveAgentsCount = () => agentSessions.size;
  wss.getActiveChatRooms = () => chatRooms.size;
  
  wss.broadcastToAgents = (data) => {
    agentSessions.forEach((session) => {
      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify(data));
      }
    });
  };

  console.log('WebSocket server initialized with agent support and typing indicators');
  
  // Cleanup on shutdown
  process.on('SIGINT', () => {
    clearInterval(cleanupInterval);
    
    // Clear all typing timers
    typingTimers.forEach(timer => clearTimeout(timer));
    typingTimers.clear();
    
    wss.close();
  });

  // api.js's /health endpoint calls wss.getActiveSessionsCount() — that
  // method never existed on the raw ws.Server instance, so /health threw
  // a 500 on every call. Attaching it here instead of touching api.js.
  wss.getActiveSessionsCount = () => customerSessions.size + agentSessions.size;

  return wss;
}

module.exports = initWebSocketWithAgentSupport;
