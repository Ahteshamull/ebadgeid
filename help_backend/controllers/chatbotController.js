// controllers/chatbotController.js
//
// This file used to be an eSIM/mobile-data-plan travel assistant end to
// end -- intent detection tuned for "which country are you visiting",
// entity extraction for destination/duration/data budget, a live call to
// a third-party company's eSIM catalogue API, and installation
// instructions for a phone's cellular settings. None of that has anything
// to do with eBadge ID (a digital credentials/badges platform) -- it was
// copied wholesale from a different product's template ("Soraroam", see
// AUDIT_FIXES.md). Every real visitor to the help center's live chat was
// getting eSIM travel advice instead of help with their account,
// credentials, or a support ticket.
//
// Rewritten to do what an eBadge ID help desk chatbot actually needs:
// search FAQ articles, look up a ticket's status by code, route technical
// issues and human-agent requests. The session/agent-handoff
// infrastructure below (getAvailableAgents, calculateWaitTime,
// shouldOfferHandoff, rateChatSession, connectToAgent, getSessionInfo,
// clearSession) was already generic and is unchanged -- it queries this
// service's own real User/FAQ/Ticket models, not anything eSIM-related.
const { detectLanguage, getSessionLanguage } = require("../services/geminiService");
const aiGateway = require("../services/aiGateway");
const User = require("../models/User");
const FAQ = require("../models/faqSchema");

// Store chat sessions and their states
const chatSessions = new Map();

// Intent detection patterns (multilingual: English, French, Spanish, Arabic)
const INTENT_PATTERNS = {
  END_CHAT: /(?:^(?:end|finish|done|goodbye|bye|quit|exit|close|that's all|no more|thank you|thanks)$)/i,
  END_CHAT_FR: /(?:^(?:fin|terminer|hecho|adios|adieu|chao|salir|cerrar|eso es todo|merci)$)/i,
  END_CHAT_ES: /(?:^(?:fin|terminar|listo|adios|chao|salir|cerrar|eso es todo|gracias)$)/i,

  AGENT_REQUEST: /(?:agent|human|person|live|support|help me|connect|transfer|speak|talk to someone)/i,
  AGENT_REQUEST_FR: /(?:agent|humain|personne|assistance|aide moi|connecter|transferer|parler a quelqu'un)/i,
  AGENT_REQUEST_ES: /(?:agente|humano|persona|ayuda|conectar|transferir|hablar con alguien)/i,
  AGENT_REQUEST_AR: /(?:\u0648\u0643\u064a\u0644|\u0625\u0646\u0633\u0627\u0646|\u0634\u062e\u0635|\u0645\u0633\u0627\u0639\u062f\u0629|\u062a\u062d\u0648\u064a\u0644|\u0627\u0644\u062a\u062d\u062f\u062b \u0645\u0639 \u0634\u062e\u0635)/i,

  TICKET_STATUS: /(?:ticket|tkt-|my ticket|ticket status|ticket number|case number)/i,
  TICKET_STATUS_FR: /(?:ticket|numero de ticket|statut du ticket|dossier)/i,
  TICKET_STATUS_ES: /(?:ticket|numero de ticket|estado del ticket|caso)/i,

  TECHNICAL_SUPPORT: /(?:problem|issue|not working|error|bug|can't (?:log|login|access|verify)|doesn't work|won't work)/i,
  TECHNICAL_SUPPORT_FR: /(?:probleme|souci|ne fonctionne pas|erreur|bug|impossible de me connecter)/i,
  TECHNICAL_SUPPORT_ES: /(?:problema|error|no funciona|falla|no puedo (?:acceder|iniciar sesion|verificar))/i,
  TECHNICAL_SUPPORT_AR: /(?:\u0645\u0634\u0643\u0644\u0629|\u062e\u0637\u0623|\u0644\u0627 \u064a\u0639\u0645\u0644|\u0644\u0627 \u0623\u0633\u062a\u0637\u064a\u0639 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644)/i,
};

// Extract a ticket code from user input, e.g. "TKT-1735689600000-A1B2C3"
// (matches the format generated in controllers/ticketController.js).
function extractEntities(input) {
  const entities = {};
  const ticketMatch = input.match(/TKT-[A-Z0-9-]+/i);
  if (ticketMatch) {
    entities.ticketCode = ticketMatch[0].toUpperCase();
  }
  return entities;
}

// Intent detection (multilingual)
function detectIntent(input) {
  if (/^(hi|hello|hey|bonjour|salut|hola|buenos dias|buenas tardes|good morning|good afternoon|good evening)$/i.test(input)) {
    return 'GREETING';
  }
  if (/how are you|how's it going|what's up|comment ca va|comment allez-vous|como estas|como esta|que tal/i.test(input)) {
    return 'GREETING';
  }
  if (/^(thank you|thanks|thx|ty|merci|gracias)$/i.test(input)) {
    return 'THANKS';
  }
  if (INTENT_PATTERNS.END_CHAT.test(input) || INTENT_PATTERNS.END_CHAT_FR.test(input) || INTENT_PATTERNS.END_CHAT_ES.test(input)) {
    return 'END_CHAT';
  }
  if (INTENT_PATTERNS.AGENT_REQUEST.test(input) || INTENT_PATTERNS.AGENT_REQUEST_FR.test(input) ||
      INTENT_PATTERNS.AGENT_REQUEST_ES.test(input) || INTENT_PATTERNS.AGENT_REQUEST_AR.test(input)) {
    return 'AGENT_REQUEST';
  }
  if (INTENT_PATTERNS.TICKET_STATUS.test(input) || INTENT_PATTERNS.TICKET_STATUS_FR.test(input) ||
      INTENT_PATTERNS.TICKET_STATUS_ES.test(input) || /TKT-[A-Z0-9-]+/i.test(input)) {
    return 'TICKET_STATUS';
  }
  if (INTENT_PATTERNS.TECHNICAL_SUPPORT.test(input) || INTENT_PATTERNS.TECHNICAL_SUPPORT_FR.test(input) ||
      INTENT_PATTERNS.TECHNICAL_SUPPORT_ES.test(input) || INTENT_PATTERNS.TECHNICAL_SUPPORT_AR.test(input)) {
    return 'TECHNICAL_SUPPORT';
  }
  // Default: treat as a question the FAQ articles might answer.
  return 'FAQ_SEARCH';
}

// Search real FAQ articles for ones relevant to the user's question -- a
// simple keyword-overlap match rather than a full search engine, which is
// proportionate to how many FAQ articles a help desk actually has.
async function handleFaqSearch(input, organizationCode) {
  try {
    const keywords = input
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .split(/\s+/)
      .filter((w) => w.length > 3);

    const faqs = await FAQ.find({
      organization_code: organizationCode,
      faq_status: 'visible',
    }).limit(50).lean();
    const scored = faqs
      .map((faq) => {
        const haystack = `${faq.faq_title} ${faq.faq_body}`.toLowerCase();
        const score = keywords.reduce((acc, kw) => acc + (haystack.includes(kw) ? 1 : 0), 0);
        return { faq, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return {
      intent: 'faq_search',
      matched_faqs: scored.map((entry) => ({ question: entry.faq.faq_title, answer: entry.faq.faq_body })),
    };
  } catch (error) {
    return { intent: 'faq_search', matched_faqs: [] };
  }
}

// Ticket state is private. The chatbot identifies the request but sends
// the visitor through the authenticated/OTP tracking flow.
async function handleTicketStatus(entities) {
  if (!entities.ticketCode) {
    return { intent: 'ticket_status', ticket: null };
  }
  return {
    intent: 'ticket_status',
    ticket: null,
    requiresAuthentication: true,
    trackingCode: entities.ticketCode,
  };
}

// Technical support -- routes toward clarifying the issue or a human agent
// rather than guessing at account-specific problems.
async function handleTechnicalSupport() {
  return {
    intent: 'technical_support',
    recommendAgent: true,
  };
}

// Check if should offer handoff
function shouldOfferHandoff(sessionId) {
  const session = chatSessions.get(sessionId);
  if (!session) return false;

  const messageCount = session.messageCount || 0;
  const unresolved = session.unresolved || false;
  const requestedAgent = session.requestedAgent || false;

  return messageCount >= 5 || unresolved || requestedAgent;
}

// Handle end chat
async function handleEndChat(sessionId) {
  return {
    intent: 'end_chat',
    sessionId: sessionId,
    showHandoffOptions: true,
    handoffOptions: {
      rating: true,
      agentConnect: true,
      feedback: true
    }
  };
}

// Handle agent request
async function handleAgentRequest(sessionId, organizationCode) {
  try {
    const activeAgents = await getAvailableAgents(organizationCode);

    return {
      intent: 'agent_request',
      sessionId: sessionId,
      agentAvailable: activeAgents.count > 0,
      estimatedWait: calculateWaitTime(activeAgents.count),
      showAgentConnect: true,
      agents: activeAgents.agents
    };
  } catch (error) {
    return {
      intent: 'agent_request',
      error: 'Unable to check agent availability',
      showContactForm: true
    };
  }
}

// Get available agents
async function getAvailableAgents(organizationCode) {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const activeAgents = await User.find({
      org_code: organizationCode,
      user_type: "agent",
      $or: [
        { is_active: true, last_seen: { $gte: fiveMinutesAgo } },
        { last_seen: { $gte: fiveMinutesAgo } }
      ]
    }).select("name username last_seen").sort({ last_seen: -1 });

    return {
      count: activeAgents.length,
      agents: activeAgents.map(agent => ({
        id: agent._id,
        name: agent.name,
        username: agent.username,
        isCurrentlyActive: agent.last_seen >= fiveMinutesAgo
      }))
    };
  } catch (error) {
    console.error('Error getting available agents:', error);
    return { count: 0, agents: [] };
  }
}

// Calculate wait time
function calculateWaitTime(agentCount) {
  if (agentCount === 0) return "Currently unavailable";
  if (agentCount >= 3) return "Less than 2 minutes";
  if (agentCount >= 2) return "2-5 minutes";
  return "5-10 minutes";
}

// Routes a detected intent to its handler and returns the context object
// passed to the AI response generator (services/geminiService.js).
async function handleIntent(intent, input, entities, sessionId, organizationCode) {
  const session = chatSessions.get(sessionId) || { messageCount: 0, userProfile: {} };
  session.messageCount = (session.messageCount || 0) + 1;
  // Touched on every message so cleanupOldSessions (below) has something
  // real to measure age against — sessionId is client-controlled on the
  // REST fallback with no server-side expiry otherwise, so this Map grows
  // without bound as long as a client keeps minting new session ids.
  session.lastActivity = new Date();
  // Kept on the session (not just threaded through call args) so
  // getSessionInfo/rateChatSession/connectToAgent stay consistent with the
  // organization this session was actually opened for, even though the
  // real security boundary is the signed token verified in chatRoutes.js
  // before organizationCode ever reaches here.
  if (organizationCode) session.organizationCode = organizationCode;
  chatSessions.set(sessionId, session);

  switch (intent) {
    case 'GREETING':
    case 'THANKS':
      return { intent: 'general' };
    case 'END_CHAT':
      return handleEndChat(sessionId);
    case 'AGENT_REQUEST':
      session.requestedAgent = true;
      return handleAgentRequest(sessionId, organizationCode);
    case 'TICKET_STATUS':
      return handleTicketStatus(entities);
    case 'TECHNICAL_SUPPORT':
      return handleTechnicalSupport();
    case 'FAQ_SEARCH':
    default:
      return handleFaqSearch(input, organizationCode);
  }
}

async function handleChat(input, sessionId = 'default', organizationCode) {
  try {
    if (!input || typeof input !== 'string' || input.trim().length === 0) {
      const sessionLang = getSessionLanguage(sessionId);
      const defaultResponses = {
        english: "Hi! I'm here to help with your eBadge ID account, credentials, or any support questions. What can I help you with?",
        french: "Bonjour ! Je suis la pour t'aider avec ton compte eBadge ID, tes diplomes, ou toute question de support. Comment puis-je t'aider ?",
        spanish: "Hola! Estoy aqui para ayudarte con tu cuenta de eBadge ID, tus credenciales, o cualquier pregunta de soporte. En que puedo ayudarte?",
        arabic: "\u0645\u0631\u062d\u0628\u0627\u064b! \u0623\u0646\u0627 \u0647\u0646\u0627 \u0644\u0645\u0633\u0627\u0639\u062f\u062a\u0643 \u0641\u064a \u062d\u0633\u0627\u0628 eBadge ID \u0627\u0644\u062e\u0627\u0635 \u0628\u0643\u060c \u0623\u0648 \u0634\u0647\u0627\u062f\u0627\u062a\u0643\u060c \u0623\u0648 \u0623\u064a \u0623\u0633\u0626\u0644\u0629 \u062f\u0639\u0645. \u0643\u064a\u0641 \u064a\u0645\u0643\u0646\u0646\u064a \u0645\u0633\u0627\u0639\u062f\u062a\u0643\u061f",
        german: "Hallo! Ich bin hier, um dir mit deinem eBadge ID-Konto, deinen Zertifikaten oder anderen Support-Fragen zu helfen. Womit kann ich dir helfen?",
        italian: "Ciao! Sono qui per aiutarti con il tuo account eBadge ID, le tue credenziali o qualsiasi domanda di supporto. Come posso aiutarti?",
        portuguese: "Ola! Estou aqui para ajuda-lo com sua conta eBadge ID, suas credenciais, ou qualquer pergunta de suporte. Como posso ajuda-lo?"
      };
      return defaultResponses[sessionLang] || defaultResponses.english;
    }

    if (input.trim().length > 1000) {
      const sessionLang = getSessionLanguage(sessionId, input);
      const tooLongResponses = {
        english: "That's quite a detailed message! Could you help me by asking a more specific question? I'm here to help with your account, credentials, or a support ticket.",
        french: "C'est un message assez detaille ! Peux-tu m'aider en posant une question plus precise ? Je suis la pour t'aider avec ton compte, tes diplomes, ou un ticket de support.",
        spanish: "Ese es un mensaje bastante detallado! Podrias ayudarme haciendo una pregunta mas especifica? Estoy aqui para ayudar con tu cuenta, tus credenciales, o un ticket de soporte.",
        arabic: "\u0647\u0630\u0647 \u0631\u0633\u0627\u0644\u0629 \u0645\u0641\u0635\u0644\u0629 \u0644\u0644\u063a\u0627\u064a\u0629! \u0647\u0644 \u064a\u0645\u0643\u0646\u0643 \u0645\u0633\u0627\u0639\u062f\u062a\u064a \u0628\u0637\u0631\u062d \u0633\u0624\u0627\u0644 \u0623\u0643\u062b\u0631 \u062a\u062d\u062f\u064a\u062f\u0627\u064b\u061f \u0623\u0646\u0627 \u0647\u0646\u0627 \u0644\u0644\u0645\u0633\u0627\u0639\u062f\u0629 \u0641\u064a \u062d\u0633\u0627\u0628\u0643 \u0623\u0648 \u0634\u0647\u0627\u062f\u0627\u062a\u0643 \u0623\u0648 \u062a\u0630\u0643\u0631\u0629 \u0627\u0644\u062f\u0639\u0645.",
        german: "Das ist eine ziemlich detaillierte Nachricht! Konntest du mir helfen, indem du eine spezifischere Frage stellst? Ich bin hier, um bei deinem Konto, deinen Zertifikaten oder einem Support-Ticket zu helfen.",
        italian: "Questo e un messaggio piuttosto dettagliato! Potresti aiutarmi facendo una domanda piu specifica? Sono qui per aiutare con il tuo account, le tue credenziali o un ticket di supporto.",
        portuguese: "Essa e uma mensagem bastante detalhada! Voce poderia me ajudar fazendo uma pergunta mais especifica? Estou aqui para ajudar com sua conta, suas credenciais ou um chamado de suporte."
      };
      return tooLongResponses[sessionLang] || tooLongResponses.english;
    }

    const cleanInput = input.trim();

    const entities = extractEntities(cleanInput);
    const intent = detectIntent(cleanInput);

    console.log(`[${sessionId}] Intent: ${intent}`, entities);

    const context = await handleIntent(intent, cleanInput, entities, sessionId, organizationCode);

    // Generate natural response using Gemini (language-aware)
    // Was a direct call to geminiService.getResponse — a single point of
    // failure with no fallback if Gemini's API key were invalid, rate
    // limited, or the service were down. aiGateway tries Gemini first
    // (unchanged default behavior when it's healthy), then DeepSeek,
    // OpenRouter, and OpenAI in order, skipping any provider whose API key
    // isn't configured, before falling back to the same
    // generateFallbackResponse this always used as a last resort.
    const response = await aiGateway.getResponse(cleanInput, sessionId, context, organizationCode);

    return response;
  } catch (error) {
    console.error("Error in handleChat:", error);
    const sessionLang = getSessionLanguage(sessionId, input);
    const errorResponses = {
      english: "I apologize for the technical hiccup! I'm here to help with your eBadge ID account or credentials -- could you try asking again, or would you like to speak with a support agent?",
      french: "Je m'excuse pour le probleme technique ! Je suis la pour t'aider avec ton compte ou tes diplomes eBadge ID -- peux-tu reessayer, ou veux-tu parler a un agent de support ?",
      spanish: "Pido disculpas por el problema tecnico! Estoy aqui para ayudarte con tu cuenta o credenciales de eBadge ID -- podrias intentar de nuevo, o prefieres hablar con un agente de soporte?",
      arabic: "\u0623\u0639\u062a\u0630\u0631 \u0639\u0646 \u0627\u0644\u0645\u0634\u0643\u0644\u0629 \u0627\u0644\u062a\u0642\u0646\u064a\u0629! \u0623\u0646\u0627 \u0647\u0646\u0627 \u0644\u0645\u0633\u0627\u0639\u062f\u062a\u0643 \u0641\u064a \u062d\u0633\u0627\u0628 eBadge ID \u0627\u0644\u062e\u0627\u0635 \u0628\u0643 \u0623\u0648 \u0634\u0647\u0627\u062f\u0627\u062a\u0643 -- \u0647\u0644 \u064a\u0645\u0643\u0646\u0643 \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649\u060c \u0623\u0645 \u062a\u0631\u064a\u062f \u0627\u0644\u062a\u062d\u062f\u062b \u0645\u0639 \u0648\u0643\u064a\u0644 \u062f\u0639\u0645\u061f",
      german: "Ich entschuldige mich fur die technische Panne! Ich bin hier, um dir mit deinem eBadge ID-Konto oder deinen Zertifikaten zu helfen -- kannst du es erneut versuchen, oder mochtest du mit einem Support-Mitarbeiter sprechen?",
      italian: "Mi scuso per il problema tecnico! Sono qui per aiutarti con il tuo account o le tue credenziali eBadge ID -- potresti riprovare, o preferisci parlare con un agente di supporto?",
      portuguese: "Peco desculpas pelo problema tecnico! Estou aqui para ajuda-lo com sua conta ou credenciais eBadge ID -- voce poderia tentar novamente, ou prefere falar com um agente de suporte?"
    };
    return errorResponses[sessionLang] || errorResponses.english;
  }
}

// Utility functions
async function rateChatSession(sessionId, rating, feedback = '') {
  try {
    const session = chatSessions.get(sessionId);
    if (!session) {
      return { success: false, message: 'Session not found' };
    }

    session.rating = {
      score: rating,
      feedback: feedback,
      ratedAt: new Date()
    };

    console.log(`Session ${sessionId} rated: ${rating}/5`);

    return {
      success: true,
      message: 'Thank you for your feedback!',
      rating: session.rating
    };
  } catch (error) {
    console.error('Error rating session:', error);
    return { success: false, message: 'Failed to save rating' };
  }
}

async function connectToAgent(sessionId, userInfo = {}, organizationCode) {
  try {
    const availableAgents = await getAvailableAgents(organizationCode);

    if (availableAgents.count === 0) {
      return {
        success: false,
        message: 'No agents available at the moment',
        showContactForm: true
      };
    }

    const selectedAgent = availableAgents.agents[0];

    const session = chatSessions.get(sessionId);
    if (session) {
      session.agentConnection = {
        agentId: selectedAgent.id,
        agentName: selectedAgent.name,
        connectedAt: new Date(),
        userInfo: { ...userInfo, userProfile: session.userProfile }
      };
    }

    return {
      success: true,
      agent: selectedAgent,
      message: `Connecting you to ${selectedAgent.name}...`,
      estimatedWait: calculateWaitTime(availableAgents.count)
    };
  } catch (error) {
    console.error('Error connecting to agent:', error);
    return {
      success: false,
      message: 'Failed to connect',
      showContactForm: true
    };
  }
}

function getSessionInfo(sessionId) {
  return chatSessions.get(sessionId) || null;
}

function clearSession(sessionId) {
  chatSessions.delete(sessionId);
}

// Was written but never called anywhere in the codebase (confirmed with a
// repo-wide grep) — chatSessions grew without bound for as long as the
// process stayed up. Sessions without a lastActivity yet (created before
// this field existed, or mid-flight when this deploys) are treated as
// stale on the first sweep rather than kept forever by default.
function cleanupOldSessions(maxAgeHours = 24) {
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  let removed = 0;
  for (const [sessionId, session] of chatSessions.entries()) {
    const lastActivity = session.lastActivity ? new Date(session.lastActivity).getTime() : 0;
    if (lastActivity < cutoff) {
      chatSessions.delete(sessionId);
      removed += 1;
    }
  }
  return removed;
}

// Same convention already used by services/openRouterService.js for its
// own session Map — a self-contained hourly sweep, no dependency on api.js
// or any other module remembering to wire it up.
// unref() so this periodic sweep doesn't keep a process alive on its own —
// a real server stays up because of its HTTP listener regardless, and a
// script or test that merely imports this module (see
// tests/chatMultiTenant.integration.test.js) shouldn't hang for an hour
// waiting on a cleanup timer it never asked for.
setInterval(() => cleanupOldSessions(24), 60 * 60 * 1000).unref();

module.exports = {
  handleChat,
  detectIntent,
  extractEntities,
  rateChatSession,
  connectToAgent,
  getSessionInfo,
  clearSession,
  cleanupOldSessions,
  getAvailableAgents
};
