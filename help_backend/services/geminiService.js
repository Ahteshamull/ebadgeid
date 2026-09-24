// services/geminiService.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
const ChatCost = require('../models/ChatCost');
const ChatCostDaily = require('../models/ChatCostDaily');

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Store context and conversation history
const conversationHistory = new Map();
const sessionCosts = new Map();
const AI_COST_RETENTION_DAYS = Math.max(1, Number.parseInt(process.env.AI_COST_RETENTION_DAYS || '90', 10) || 90);
const AI_COST_DAILY_RETENTION_DAYS = Math.max(AI_COST_RETENTION_DAYS, Number.parseInt(process.env.AI_COST_DAILY_RETENTION_DAYS || '400', 10) || 400);
const AI_COST_ALERT_THRESHOLD_USD = Math.max(0, Number.parseFloat(process.env.AI_COST_ALERT_THRESHOLD_USD || '0') || 0);

const addDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
const utcDay = (date) => date.toISOString().slice(0, 10);

// Pricing per 1M tokens
const MODEL_PRICING = {
  "gemini-2.5-flash": {
    input: 0.075,
    output: 0.30
  },
  "gemini-2.0-flash": {
    input: 0.075,
    output: 0.30
  },
  "gemini-2.5-pro": {
    input: 1.25,
    output: 5.00
  }
};

// Language detection patterns
const LANGUAGE_PATTERNS = {
  french: /\b(bonjour|salut|merci|oui|non|comment|quel|quelle|combien|pour|dans|avec|besoin|aide|problème|cherche)\b/i,
  spanish: /\b(hola|gracias|sí|si|no|cómo|como|cuál|cual|cuánto|cuanto|para|con|necesito|ayuda|problema|busco)\b/i,
  arabic: /[\u0600-\u06FF]/,
  german: /\b(hallo|danke|ja|nein|wie|was|wann|wo|brauche|hilfe|problem)\b/i,
  italian: /\b(ciao|grazie|come|cosa|quando|dove|bisogno|aiuto|problema|cerco)\b/i,
  portuguese: /\b(olá|ola|obrigado|obrigada|sim|não|nao|como|qual|quanto|preciso|ajuda|problema|procuro)\b/i
};

// Detect language from text
function detectLanguage(text) {
  const cleanText = text.toLowerCase().trim();
  
  // Check for specific language patterns
  if (LANGUAGE_PATTERNS.french.test(cleanText)) return 'french';
  if (LANGUAGE_PATTERNS.spanish.test(cleanText)) return 'spanish';
  if (LANGUAGE_PATTERNS.arabic.test(cleanText)) return 'arabic';
  if (LANGUAGE_PATTERNS.german.test(cleanText)) return 'german';
  if (LANGUAGE_PATTERNS.italian.test(cleanText)) return 'italian';
  if (LANGUAGE_PATTERNS.portuguese.test(cleanText)) return 'portuguese';
  
  // Default to English
  return 'english';
}

// Get language-specific system context
// Get language-specific system context
function getSystemContextForLanguage(language) {
  // This used to be an eSIM/mobile-data-plan travel assistant persona
  // (~300 lines per language, instructing the model to recommend eSIM
  // data plans, walk through installation steps for a phone's cellular
  // settings, and pivot any off-topic question back to "let me help you
  // find an eSIM plan") — copied wholesale from a different product's
  // template (see AUDIT_FIXES.md, "Soraroam"). Every real visitor to
  // eBadge ID's help center chat was getting eSIM travel advice instead
  // of help with credentials, badges, or their account. Replaced with an
  // actual eBadge ID support assistant persona, in the same languages.
  const contexts = {
    english: `You are a helpful support assistant for eBadge ID, a digital credentials and badges platform. You help users with questions about their account, verifying or sharing credentials, using the platform's help center, and finding relevant FAQ articles.

YOUR CORE CAPABILITIES:
- Answer questions about digital credentials/badges: how they're issued, verified, shared, or revoked
- Help users find relevant FAQ articles and help center content
- Look up the status of a support ticket when the user provides a ticket code
- Explain general platform features (organizations, verification links, credential history)
- Connect the user to a human support agent when the question needs one, or when they ask for a person directly

GUIDELINES:
- Be concise, friendly, and professional.
- If you don't know something specific about the user's account or organization, say so and offer to connect them with a human agent rather than guessing.
- If the user seems frustrated or the issue is complex, proactively offer to connect them with a support agent.
- Never invent ticket numbers, credential statuses, or account details you don't actually have — only report what's in the context you're given.

**ALWAYS RESPOND IN ENGLISH.**`,

    french: `Vous êtes un assistant de support utile pour eBadge ID, une plateforme de badges et de diplômes numériques. Vous aidez les utilisateurs avec des questions sur leur compte, la vérification ou le partage de leurs diplômes, l'utilisation du centre d'aide, et la recherche d'articles pertinents.

VOS CAPACITÉS PRINCIPALES:
- Répondre aux questions sur les diplômes/badges numériques : émission, vérification, partage, révocation
- Aider à trouver des articles pertinents dans le centre d'aide
- Consulter le statut d'un ticket de support quand l'utilisateur fournit un code de ticket
- Expliquer les fonctionnalités générales de la plateforme
- Connecter l'utilisateur à un agent humain si nécessaire, ou sur demande directe

DIRECTIVES:
- Sois concis, amical et professionnel.
- Si tu ne connais pas un détail spécifique du compte de l'utilisateur, dis-le et propose de le connecter à un agent humain plutôt que de deviner.
- Si l'utilisateur semble frustré ou le problème est complexe, propose de le connecter à un agent.
- N'invente jamais de numéros de ticket, de statuts de diplôme, ou de détails de compte que tu n'as pas réellement.

**RÉPONDS TOUJOURS EN FRANÇAIS.**`,

    spanish: `Eres un asistente de soporte útil para eBadge ID, una plataforma de credenciales y insignias digitales. Ayudas a los usuarios con preguntas sobre su cuenta, verificación o compartición de credenciales, uso del centro de ayuda, y búsqueda de artículos relevantes.

TUS CAPACIDADES PRINCIPALES:
- Responder preguntas sobre credenciales/insignias digitales: emisión, verificación, compartición, revocación
- Ayudar a encontrar artículos relevantes del centro de ayuda
- Consultar el estado de un ticket de soporte cuando el usuario proporciona un código de ticket
- Explicar funciones generales de la plataforma
- Conectar al usuario con un agente humano cuando haga falta, o si lo pide directamente

PAUTAS:
- Sé conciso, amigable y profesional.
- Si no sabes un detalle específico de la cuenta del usuario, dilo y ofrece conectarlo con un agente humano en vez de adivinar.
- Si el usuario parece frustrado o el problema es complejo, ofrece conectarlo con un agente.
- Nunca inventes números de ticket, estados de credenciales, ni detalles de cuenta que no tengas realmente.

**RESPONDE SIEMPRE EN ESPAÑOL.**`,

    arabic: `أنت مساعد دعم مفيد لمنصة eBadge ID، وهي منصة للشهادات والشارات الرقمية. تساعد المستخدمين في الأسئلة المتعلقة بحسابهم، والتحقق من الشهادات أو مشاركتها، واستخدام مركز المساعدة، والعثور على المقالات ذات الصلة.

قدراتك الأساسية:
- الإجابة عن أسئلة الشهادات/الشارات الرقمية: كيفية إصدارها، التحقق منها، مشاركتها، أو إلغاؤها
- مساعدة المستخدمين في العثور على مقالات مركز المساعدة ذات الصلة
- البحث عن حالة تذكرة الدعم عند تقديم المستخدم لرمز التذكرة
- شرح ميزات المنصة العامة
- توصيل المستخدم بوكيل بشري عند الحاجة، أو عند الطلب المباشر

الإرشادات:
- كن موجزاً وودوداً ومهنياً.
- إذا كنت لا تعرف تفصيلاً محدداً عن حساب المستخدم، قل ذلك واعرض التوصيل بوكيل بشري بدلاً من التخمين.
- لا تخترع أبداً أرقام تذاكر أو حالات شهادات أو تفاصيل حساب لا تملكها فعلياً.

**أجب دائماً باللغة العربية.**`,

    german: `Du bist ein hilfreicher Support-Assistent für eBadge ID, eine Plattform für digitale Zertifikate und Badges. Du hilfst Nutzern bei Fragen zu ihrem Konto, der Verifizierung oder dem Teilen von Zertifikaten, der Nutzung des Hilfe-Centers und dem Finden relevanter Artikel.

DEINE KERNFÄHIGKEITEN:
- Fragen zu digitalen Zertifikaten/Badges beantworten: Ausstellung, Verifizierung, Teilen, Widerruf
- Relevante Hilfe-Center-Artikel finden
- Den Status eines Support-Tickets nachschlagen, wenn der Nutzer einen Ticketcode angibt
- Allgemeine Plattformfunktionen erklären
- Den Nutzer bei Bedarf oder auf direkte Anfrage mit einem menschlichen Mitarbeiter verbinden

RICHTLINIEN:
- Sei prägnant, freundlich und professionell.
- Wenn du ein bestimmtes Detail zum Konto des Nutzers nicht kennst, sag das und biete an, mit einem menschlichen Mitarbeiter zu verbinden, anstatt zu raten.
- Erfinde niemals Ticketnummern, Zertifikatsstatus oder Kontodetails, die du nicht tatsächlich hast.

**ANTWORTE IMMER AUF DEUTSCH.**`,

    italian: `Sei un assistente di supporto utile per eBadge ID, una piattaforma di credenziali e badge digitali. Aiuti gli utenti con domande sul loro account, la verifica o la condivisione delle credenziali, l'uso del centro assistenza e la ricerca di articoli pertinenti.

LE TUE CAPACITÀ PRINCIPALI:
- Rispondere a domande su credenziali/badge digitali: emissione, verifica, condivisione, revoca
- Aiutare a trovare articoli pertinenti del centro assistenza
- Verificare lo stato di un ticket di supporto quando l'utente fornisce un codice ticket
- Spiegare le funzionalità generali della piattaforma
- Collegare l'utente a un agente umano quando necessario, o su richiesta diretta

LINEE GUIDA:
- Sii conciso, cordiale e professionale.
- Se non conosci un dettaglio specifico dell'account dell'utente, dillo e offri di collegarlo a un agente umano invece di indovinare.
- Non inventare mai numeri di ticket, stati delle credenziali o dettagli dell'account che non hai realmente.

**RISPONDI SEMPRE IN ITALIANO.**`,

    portuguese: `Você é um assistente de suporte útil para o eBadge ID, uma plataforma de credenciais e emblemas digitais. Você ajuda os usuários com perguntas sobre sua conta, verificação ou compartilhamento de credenciais, uso da central de ajuda e busca de artigos relevantes.

SUAS CAPACIDADES PRINCIPAIS:
- Responder perguntas sobre credenciais/emblemas digitais: emissão, verificação, compartilhamento, revogação
- Ajudar a encontrar artigos relevantes da central de ajuda
- Consultar o status de um chamado de suporte quando o usuário fornecer um código de chamado
- Explicar recursos gerais da plataforma
- Conectar o usuário a um agente humano quando necessário, ou a pedido direto

DIRETRIZES:
- Seja conciso, amigável e profissional.
- Se você não souber um detalhe específico da conta do usuário, diga isso e ofereça conectar com um agente humano em vez de adivinhar.
- Nunca invente números de chamado, status de credenciais ou detalhes de conta que você não tenha de fato.

**RESPONDA SEMPRE EM PORTUGUÊS.**`
  };

  return contexts[language] || contexts.english;
}

// Calculate cost for a request
function calculateCost(modelName, promptTokens, responseTokens) {
  const pricing = MODEL_PRICING[modelName];
  if (!pricing) {
    console.warn(`No pricing information for model: ${modelName}`);
    return { inputCost: 0, outputCost: 0, totalCost: 0 };
  }
  
  const inputCost = (promptTokens / 1000000) * pricing.input;
  const outputCost = (responseTokens / 1000000) * pricing.output;
  const totalCost = inputCost + outputCost;
  
  return { inputCost, outputCost, totalCost };
}

// Update session costs
function costKey(sessionId, organizationCode) {
  return `${organizationCode || 'unattributed'}:${sessionId}`;
}

async function notifyDailyBudgetExceeded(organizationCode, daily) {
  const payload = {
    event: 'ai_cost_daily_threshold_exceeded',
    organization_code: organizationCode,
    day: daily.day,
    total_cost: daily.total_cost,
    request_count: daily.request_count,
    threshold_usd: AI_COST_ALERT_THRESHOLD_USD,
  };
  console.warn(JSON.stringify(payload));
  if (!process.env.AI_COST_ALERT_WEBHOOK_URL) return;
  try {
    await fetch(process.env.AI_COST_ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    // Alert delivery must not make chat unavailable.
    console.error(`[ai-cost-alert] delivery failed: ${error.message}`);
  }
}

async function persistSessionCosts(sessionId, cost, organizationCode) {
  if (!organizationCode) return;
  const now = new Date();
  const increment = {
    total_input_cost: cost.inputCost,
    total_output_cost: cost.outputCost,
    total_cost: cost.totalCost,
    request_count: 1,
  };
  try {
    await ChatCost.findOneAndUpdate(
      { organization_code: organizationCode, session_id: sessionId },
      {
        $inc: increment,
        $set: { last_activity_at: now, expires_at: addDays(now, AI_COST_RETENTION_DAYS) },
        $setOnInsert: { organization_code: organizationCode, session_id: sessionId },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const daily = await ChatCostDaily.findOneAndUpdate(
      { organization_code: organizationCode, day: utcDay(now) },
      {
        $inc: { total_cost: cost.totalCost, request_count: 1 },
        $set: { expires_at: addDays(now, AI_COST_DAILY_RETENTION_DAYS) },
        $setOnInsert: { organization_code: organizationCode, day: utcDay(now) },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    if (AI_COST_ALERT_THRESHOLD_USD > 0 && daily.total_cost >= AI_COST_ALERT_THRESHOLD_USD && !daily.alert_sent_at) {
      const claim = await ChatCostDaily.updateOne(
        { _id: daily._id, alert_sent_at: null },
        { $set: { alert_sent_at: now } }
      );
      if (claim.modifiedCount === 1) await notifyDailyBudgetExceeded(organizationCode, daily);
    }
  } catch (error) {
    // The current-process Map still provides the active request's total;
    // persistence failure is observable but never turns a good chat reply
    // into a 500 response.
    console.error(`[ai-cost] persistence failed: ${error.message}`);
  }
}

async function updateSessionCosts(sessionId, cost, organizationCode) {
  const key = costKey(sessionId, organizationCode);
  if (!sessionCosts.has(key)) {
    sessionCosts.set(key, {
      session_id: sessionId,
      organization_code: organizationCode || null,
      totalInputCost: 0,
      totalOutputCost: 0,
      totalCost: 0,
      requestCount: 0
    });
  }
  
  const sessionCost = sessionCosts.get(key);
  sessionCost.totalInputCost += cost.inputCost;
  sessionCost.totalOutputCost += cost.outputCost;
  sessionCost.totalCost += cost.totalCost;
  sessionCost.requestCount += 1;
  await persistSessionCosts(sessionId, cost, organizationCode);
}

// Format cost with high precision
function formatCost(cost) {
  if (cost === 0) return '$0.000000';
  if (cost < 0.000001) return `$${cost.toExponential(6)}`;
  return `$${cost.toFixed(8)}`;
}

// Enhanced context building with language support
function buildContextualPrompt(prompt, history, context, language) {
  const systemContext = getSystemContextForLanguage(language);
  let contextualPrompt = systemContext + "\n\n";
  
  // Add relevant conversation history (last 5 exchanges)
  if (history.length > 0) {
    contextualPrompt += "CONVERSATION HISTORY:\n";
    history.slice(-5).forEach((entry) => {
      contextualPrompt += `User: ${entry.user}\n`;
      contextualPrompt += `Assistant: ${entry.assistant}\n\n`;
    });
    contextualPrompt += "---\n\n";
  }
  
  // Add current context (language-aware). Intents below replace the old
  // eSIM-plan-search flow (needsCountry/needsDuration/recommended_plans)
  // with what an eBadge ID support conversation actually needs: FAQ
  // lookups, ticket status, and general platform help.
  if (context && context.intent) {
    contextualPrompt += "CURRENT SITUATION:\n";
    
    switch (context.intent) {
      case 'faq_search':
        if (context.matched_faqs && context.matched_faqs.length > 0) {
          contextualPrompt += `Found ${context.matched_faqs.length} relevant help articles:\n\n`;
          context.matched_faqs.forEach((faq, idx) => {
            contextualPrompt += `${idx + 1}. ${faq.question}\n   ${faq.answer}\n\n`;
          });
          contextualPrompt += "Summarize the most relevant answer(s) naturally. Mention the user can ask a follow-up or request a human agent if this doesn't resolve it.\n";
        } else {
          contextualPrompt += "User asked a question but no matching FAQ article was found.\n";
          contextualPrompt += "Say you don't have a specific article for that, and offer to connect them with a support agent.\n";
        }
        break;

      case 'ticket_status':
        if (context.ticket) {
          contextualPrompt += `Ticket ${context.ticket.ticket_code}: status is "${context.ticket.status}".\n`;
          contextualPrompt += "Share this status naturally and ask if they need anything else about it.\n";
        } else {
          contextualPrompt += "User asked about a ticket but no matching ticket code was found or provided.\n";
          contextualPrompt += "Ask them for their ticket code (usually shown in their confirmation email).\n";
        }
        break;

      case 'technical_support':
        contextualPrompt += "User is having a technical issue with the eBadge ID platform (login, credential verification, account access, etc.).\n";
        contextualPrompt += "Ask a clarifying question about what specifically isn't working, or offer to connect them with a support agent for account-specific help.\n";
        break;

      case 'agent_request':
        if (context.agentAvailable) {
          contextualPrompt += `${context.agents?.length || 0} support agents are available.\n`;
          contextualPrompt += `Estimated wait time: ${context.estimatedWait}\n`;
          contextualPrompt += "Confirm you're connecting them and that an agent will help shortly.\n";
        } else {
          contextualPrompt += "No agents currently available.\n";
          contextualPrompt += "Apologize and offer alternatives.\n";
        }
        break;
        
      case 'end_chat':
        contextualPrompt += "User is ending the conversation.\n";
        contextualPrompt += "Thank them warmly and briefly mention they can rate the conversation or connect with an agent if needed.\n";
        break;
        
      default:
        if (context.message) {
          contextualPrompt += `Note: ${context.message}\n`;
        }
    }
    contextualPrompt += "\n---\n\n";
  }
  
  contextualPrompt += `USER'S MESSAGE: "${prompt}"\n\n`;
  contextualPrompt += "Respond naturally and helpfully. Be concise but warm.";
  
  return contextualPrompt;
}

async function getResponse(prompt, sessionId = 'default', context = null, organizationCode) {
  // Declared here, outside the try block, on purpose: it used to be
  // `let detectedLanguage = ...` INSIDE the try block below, but also
  // referenced from the catch block at the bottom of this function. In
  // JavaScript, `try` and `catch` are separate block scopes -- a `let`
  // declared inside `try` is not visible inside its own `catch`. So every
  // time every Gemini model attempt failed (as it does right now with no
  // real API key configured), the fallback path itself crashed with
  // "ReferenceError: detectedLanguage is not defined" instead of actually
  // returning the language-aware fallback message it was supposed to.
  let detectedLanguage;
  try {
    const modelNames = [
      "gemini-2.5-flash",
      "gemini-2.0-flash"
    ];
    
    let model;
    let lastError;
    
    // Get or create conversation history
    if (!conversationHistory.has(sessionId)) {
      conversationHistory.set(sessionId, []);
    }
    
    const history = conversationHistory.get(sessionId);
    
    // Detect language from current prompt
    detectedLanguage = detectLanguage(prompt);
    
    // If we have history, check if user consistently uses a language
    if (history.length > 0) {
      const lastLanguage = history[history.length - 1].language;
      // Keep the same language if the current message is ambiguous or short
      if (prompt.trim().split(/\s+/).length < 3) {
        detectedLanguage = lastLanguage || detectedLanguage;
      }
    }
    
    console.log(`Detected language: ${detectedLanguage}`);
    
    // Build enhanced contextual prompt with language support
    const fullPrompt = buildContextualPrompt(prompt, history, context, detectedLanguage);
    
    // Try each model until one works
    for (const modelName of modelNames) {
      try {
        model = genAI.getGenerativeModel({ 
          model: modelName,
          generationConfig: {
            temperature: 0.7,
            topP: 0.9,
            topK: 40,
            maxOutputTokens: 600,
          }
        });
        
        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        const responseText = response.text();
        
        // Clean up the response
        const cleanedResponse = cleanResponse(responseText);
        
        // Get token usage information
        const usageMetadata = response.usageMetadata;
        const promptTokens = usageMetadata?.promptTokenCount || 0;
        const responseTokens = usageMetadata?.candidatesTokenCount || 0;
        const totalTokens = usageMetadata?.totalTokenCount || 0;
        
        // Calculate costs
        const cost = calculateCost(modelName, promptTokens, responseTokens);
        await updateSessionCosts(sessionId, cost, organizationCode);
        
        // Get session totals
        const sessionTotals = sessionCosts.get(costKey(sessionId, organizationCode));
        
        // Logging
        console.log(`\n=== HELPDESK CHATBOT - ${modelName} ===`);
        console.log(`Session: ${sessionId} | Intent: ${context?.intent || 'general'} | Language: ${detectedLanguage}`);
        console.log(`Tokens: ${totalTokens.toLocaleString()} | Cost: ${formatCost(cost.totalCost)}`);
        console.log(`Session Total: ${formatCost(sessionTotals.totalCost)} (${sessionTotals.requestCount} requests)`);
        console.log(`===================================\n`);
        
        // Store conversation history with language info
        history.push({
          user: prompt,
          assistant: cleanedResponse,
          timestamp: new Date(),
          model: modelName,
          language: detectedLanguage,
          intent: context?.intent || 'general',
          tokenUsage: {
            promptTokenCount: promptTokens,
            candidatesTokenCount: responseTokens,
            totalTokenCount: totalTokens
          },
          costs: {
            inputCost: cost.inputCost,
            outputCost: cost.outputCost,
            totalCost: cost.totalCost
          }
        });
        
        // Maintain reasonable history size
        if (history.length > 12) {
          history.splice(0, history.length - 12);
        }
        
        return cleanedResponse;
      } catch (error) {
        console.log(`Model ${modelName} failed: ${error.message}`);
        lastError = error;
        continue;
      }
    }
    
    throw lastError;
  } catch (error) {
    console.error("Error generating response:", error);
    return generateFallbackResponse(context, detectedLanguage || 'english');
  }
}

// Clean and enhance response quality
function cleanResponse(responseText) {
  let cleaned = responseText.trim();
  
  // Remove system artifacts
  cleaned = cleaned.replace(/^(Assistant:|Response:|Your response:)/i, '');
  cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');
  cleaned = cleaned.replace(/^\s+|\s+$/g, '');
  
  return cleaned.trim();
}

// Generate contextual fallback responses with language support
// Generate contextual fallback responses with language support
function generateFallbackResponse(context, language = 'english') {
  // Replaced the old eSIM-plan fallback messages (asking "which country
  // are you visiting" no matter what the user actually asked) with
  // responses that match eBadge ID's real intents.
  const fallbackResponses = {
    english: {
      'faq_search': "I'm having trouble searching our help articles right now. Could you rephrase your question, or would you like me to connect you with a support agent?",
      'ticket_status': "I'm having trouble looking up that ticket right now. Could you double-check the ticket code, or would you like me to connect you with a support agent?",
      'technical_support': "I'm sorry you're running into an issue. Could you tell me a bit more about what's happening, or would you like me to connect you with a support agent?",
      'agent_request': "I'll be happy to connect you with one of our support agents. One moment please...",
      'end_chat': "Thanks for chatting with me today! Feel free to reach out anytime.",
      'general': "I'm here to help with your eBadge ID account, credentials, or any questions you have. What can I help you with?"
    },
    french: {
      'faq_search': "J'ai du mal à rechercher dans nos articles d'aide en ce moment. Peux-tu reformuler ta question, ou veux-tu que je te connecte avec un agent de support ?",
      'ticket_status': "J'ai du mal à retrouver ce ticket en ce moment. Peux-tu vérifier le code du ticket, ou veux-tu que je te connecte avec un agent de support ?",
      'technical_support': "Désolé que tu rencontres un problème. Peux-tu m'en dire un peu plus sur ce qui se passe, ou veux-tu que je te connecte avec un agent de support ?",
      'agent_request': "Je serai heureux de te connecter avec l'un de nos agents de support. Un instant s'il te plaît...",
      'end_chat': "Merci d'avoir discuté avec moi aujourd'hui ! N'hésite pas à me recontacter.",
      'general': "Je suis là pour t'aider avec ton compte eBadge ID, tes diplômes, ou toute autre question. Comment puis-je t'aider ?"
    },
    spanish: {
      'faq_search': "Tengo dificultades para buscar en nuestros artículos de ayuda en este momento. ¿Podrías reformular tu pregunta, o quieres que te conecte con un agente de soporte?",
      'ticket_status': "Tengo dificultades para consultar ese ticket en este momento. ¿Podrías verificar el código del ticket, o quieres que te conecte con un agente de soporte?",
      'technical_support': "Lamento que estés teniendo un problema. ¿Podrías contarme un poco más sobre lo que está pasando, o quieres que te conecte con un agente de soporte?",
      'agent_request': "Estaré feliz de conectarte con uno de nuestros agentes de soporte. Un momento por favor...",
      'end_chat': "¡Gracias por chatear conmigo hoy! No dudes en contactarme cuando quieras.",
      'general': "Estoy aquí para ayudarte con tu cuenta de eBadge ID, tus credenciales, o cualquier pregunta que tengas. ¿En qué puedo ayudarte?"
    },
    arabic: {
      'faq_search': "أواجه صعوبة في البحث في مقالات المساعدة الآن. هل يمكنك إعادة صياغة سؤالك، أم تريد أن أوصلك بوكيل دعم؟",
      'ticket_status': "أواجه صعوبة في العثور على تلك التذكرة الآن. هل يمكنك التحقق من رمز التذكرة، أم تريد أن أوصلك بوكيل دعم؟",
      'technical_support': "آسف لأنك تواجه مشكلة. هل يمكنك إخباري بمزيد من التفاصيل، أم تريد أن أوصلك بوكيل دعم؟",
      'agent_request': "سأكون سعيدًا بتوصيلك بأحد وكلاء الدعم لدينا. لحظة من فضلك...",
      'end_chat': "شكرًا للدردشة معي اليوم! لا تتردد في التواصل في أي وقت.",
      'general': "أنا هنا لمساعدتك في حساب eBadge ID الخاص بك، أو شهاداتك، أو أي أسئلة لديك. كيف يمكنني مساعدتك؟"
    },
    german: {
      'faq_search': "Ich habe gerade Schwierigkeiten, unsere Hilfeartikel zu durchsuchen. Könntest du deine Frage anders formulieren, oder soll ich dich mit einem Support-Mitarbeiter verbinden?",
      'ticket_status': "Ich habe gerade Schwierigkeiten, dieses Ticket zu finden. Könntest du den Ticketcode überprüfen, oder soll ich dich mit einem Support-Mitarbeiter verbinden?",
      'technical_support': "Es tut mir leid, dass du ein Problem hast. Kannst du mir etwas mehr darüber erzählen, oder soll ich dich mit einem Support-Mitarbeiter verbinden?",
      'agent_request': "Ich verbinde dich gerne mit einem unserer Support-Mitarbeiter. Einen Moment bitte...",
      'end_chat': "Danke, dass du heute mit mir gechattet hast! Melde dich jederzeit wieder.",
      'general': "Ich bin hier, um dir mit deinem eBadge ID-Konto, deinen Zertifikaten oder anderen Fragen zu helfen. Womit kann ich dir helfen?"
    },
    italian: {
      'faq_search': "Sto avendo difficoltà a cercare nei nostri articoli di aiuto in questo momento. Potresti riformulare la tua domanda, o vuoi che ti connetta con un agente di supporto?",
      'ticket_status': "Sto avendo difficoltà a trovare quel ticket in questo momento. Potresti verificare il codice del ticket, o vuoi che ti connetta con un agente di supporto?",
      'technical_support': "Mi dispiace che tu stia avendo un problema. Potresti dirmi qualcosa in più su cosa sta succedendo, o vuoi che ti connetta con un agente di supporto?",
      'agent_request': "Sarò felice di connetterti con uno dei nostri agenti di supporto. Un momento per favore...",
      'end_chat': "Grazie per aver chattato con me oggi! Non esitare a contattarmi di nuovo.",
      'general': "Sono qui per aiutarti con il tuo account eBadge ID, le tue credenziali o qualsiasi domanda tu abbia. Come posso aiutarti?"
    },
    portuguese: {
      'faq_search': "Estou com dificuldade para buscar em nossos artigos de ajuda no momento. Você poderia reformular sua pergunta, ou quer que eu o conecte com um agente de suporte?",
      'ticket_status': "Estou com dificuldade para encontrar esse chamado no momento. Você poderia verificar o código do chamado, ou quer que eu o conecte com um agente de suporte?",
      'technical_support': "Sinto muito que você esteja tendo um problema. Você poderia me contar um pouco mais sobre o que está acontecendo, ou quer que eu o conecte com um agente de suporte?",
      'agent_request': "Ficarei feliz em conectá-lo com um de nossos agentes de suporte. Um momento por favor...",
      'end_chat': "Obrigado por conversar comigo hoje! Sinta-se à vontade para entrar em contato quando quiser.",
      'general': "Estou aqui para ajudá-lo com sua conta eBadge ID, suas credenciais, ou qualquer pergunta que você tenha. Como posso ajudá-lo?"
    }
  };
  
  const intent = context?.intent || 'general';
  const languageResponses = fallbackResponses[language] || fallbackResponses.english;
  return languageResponses[intent] || languageResponses['general'];
}
// Session management functions
function clearHistory(sessionId) {
  conversationHistory.delete(sessionId);
  console.log(`Conversation history cleared for session: ${sessionId}`);
}

function getHistory(sessionId) {
  return conversationHistory.get(sessionId) || [];
}

function getSessionTokenUsage(sessionId) {
  const history = conversationHistory.get(sessionId) || [];
  let totalPromptTokens = 0;
  let totalResponseTokens = 0;
  let totalTokens = 0;
  
  history.forEach(entry => {
    if (entry.tokenUsage) {
      totalPromptTokens += entry.tokenUsage.promptTokenCount || 0;
      totalResponseTokens += entry.tokenUsage.candidatesTokenCount || 0;
      totalTokens += entry.tokenUsage.totalTokenCount || 0;
    }
  });
  
  return {
    totalPromptTokens,
    totalResponseTokens,
    totalTokens,
    conversationCount: history.length,
    averageTokensPerMessage: history.length > 0 ? Math.round(totalTokens / history.length) : 0
  };
}

function getSessionCosts(sessionId, organizationCode) {
  const costs = sessionCosts.get(costKey(sessionId, organizationCode));
  if (!costs) {
    return {
      totalInputCost: 0,
      totalOutputCost: 0,
      totalCost: 0,
      requestCount: 0,
      formattedCosts: {
        totalCost: formatCost(0),
        averageCostPerRequest: formatCost(0)
      }
    };
  }
  
  return {
    ...costs,
    formattedCosts: {
      totalCost: formatCost(costs.totalCost),
      averageCostPerRequest: formatCost(costs.totalCost / costs.requestCount)
    }
  };
}

// Aggregate only the organization that owns the authenticated request.
// MongoDB is the durable source of truth; the in-memory fallback preserves
// a useful response only if the database is temporarily unavailable.
async function getAllSessionsCosts(organizationCode) {
  if (!organizationCode) {
    throw new Error('organizationCode is required to aggregate session costs');
  }
  try {
    const [summary] = await ChatCost.aggregate([
      { $match: { organization_code: organizationCode } },
      { $group: {
        _id: null,
        totalSessions: { $sum: 1 },
        totalRequests: { $sum: '$request_count' },
        totalInputCost: { $sum: '$total_input_cost' },
        totalOutputCost: { $sum: '$total_output_cost' },
        totalCost: { $sum: '$total_cost' },
      } },
    ]);
    const topSessions = await ChatCost.find({ organization_code: organizationCode })
      .sort({ total_cost: -1 }).limit(10).lean();
    const values = summary || { totalSessions: 0, totalRequests: 0, totalInputCost: 0, totalOutputCost: 0, totalCost: 0 };
    return {
      ...values,
      formattedGrandTotal: formatCost(values.totalCost),
      averageCostPerRequest: values.totalRequests > 0 ? formatCost(values.totalCost / values.totalRequests) : formatCost(0),
      averageCostPerSession: values.totalSessions > 0 ? formatCost(values.totalCost / values.totalSessions) : formatCost(0),
      topSessions: topSessions.map((session) => ({
        session_id: session.session_id,
        organization_code: session.organization_code,
        totalInputCost: session.total_input_cost,
        totalOutputCost: session.total_output_cost,
        totalCost: session.total_cost,
        requestCount: session.request_count,
        formattedCost: formatCost(session.total_cost),
      })),
    };
  } catch (error) {
    console.error(`[ai-cost] aggregate failed; using current-process fallback: ${error.message}`);
  }
  let totalInputCost = 0;
  let totalOutputCost = 0;
  let totalCost = 0;
  let totalRequests = 0;
  const sessions = [];

  for (const [, costs] of sessionCosts.entries()) {
    if (costs.organization_code !== organizationCode) continue;
    totalInputCost += costs.totalInputCost;
    totalOutputCost += costs.totalOutputCost;
    totalCost += costs.totalCost;
    totalRequests += costs.requestCount;
    sessions.push({ ...costs });
  }

  const totalSessions = sessions.length;
  const topSessions = sessions
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, 10)
    .map((session) => ({ ...session, formattedCost: formatCost(session.totalCost) }));

  return {
    totalSessions,
    totalRequests,
    totalInputCost,
    totalOutputCost,
    totalCost,
    formattedGrandTotal: formatCost(totalCost),
    averageCostPerRequest: totalRequests > 0 ? formatCost(totalCost / totalRequests) : formatCost(0),
    averageCostPerSession: totalSessions > 0 ? formatCost(totalCost / totalSessions) : formatCost(0),
    topSessions,
  };
}

function cleanupOldSessions(maxAgeHours = 24) {
  const cutoffTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  let cleanedCount = 0;
  
  conversationHistory.forEach((history, sessionId) => {
    if (history.length > 0) {
      const lastActivity = new Date(history[history.length - 1].timestamp);
        if (lastActivity < cutoffTime) {
          conversationHistory.delete(sessionId);
          for (const [key, costs] of sessionCosts.entries()) {
            if (costs.session_id === sessionId) sessionCosts.delete(key);
          }
        cleanedCount++;
      }
    }
  });
  
  console.log(`Cleaned up ${cleanedCount} old sessions`);
  return cleanedCount;
}

// A session with real conversation history uses the language it's already
// established -- but a session with none yet (its very first message never
// reached a model, e.g. no provider is configured at all) used to fall
// straight to the 'english' default here, discarding the language of the
// message actually being answered. A first-time Spanish/French/German/
// Italian/Portuguese/Arabic speaker whose message never reached a model got
// an English reply. `fallbackText`, when given, is detected fresh so that
// case answers in the language of the message it's responding to, exactly
// like a successful model call already would via detectLanguage() above --
// this only changes what happens with zero history, never overrides an
// established session language.
function getSessionLanguage(sessionId, fallbackText) {
  const history = conversationHistory.get(sessionId);
  if (history && history.length > 0) return history[history.length - 1].language || 'english';
  return fallbackText ? detectLanguage(fallbackText) : 'english';
}

// Was exported and callable but never actually invoked anywhere — confirmed
// with a repo-wide grep before this fix — so conversationHistory/sessionCosts
// grew without bound for as long as the process stayed up, same class of
// leak already fixed for chatbotController.js's own chatSessions Map (see
// AUDIT_FIXES.md, ronda 15) and for services/openRouterService.js's session
// Map. Same convention as those two: a self-contained hourly sweep here
// instead of relying on some other module to remember to call this.
// unref() so this timer alone can't keep a process alive (a real server
// stays up via its HTTP listener regardless; a script or test that only
// imports this module shouldn't hang for an hour on a cleanup sweep it
// never asked for — same reasoning as chatbotController.js's own version
// of this).
setInterval(() => cleanupOldSessions(24), 60 * 60 * 1000).unref();

module.exports = {
  getResponse, 
  clearHistory, 
  getHistory,
  getSessionTokenUsage,
  getSessionCosts,
  getAllSessionsCosts,
  formatCost,
  cleanupOldSessions,
  generateFallbackResponse,
  detectLanguage,
  getSessionLanguage
};
