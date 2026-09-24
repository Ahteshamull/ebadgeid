// services/openRouterService.js
const axios = require('axios');

class OpenRouterService {
  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY;
    this.baseUrl = 'https://openrouter.ai/api/v1';
    
    // List of free models to try in order of preference. Was a single
    // hardcoded model (google/gemma-2-9b-it:free) -- OpenRouter's free
    // catalog turns over; that exact model has since been discontinued
    // ("No endpoints found", confirmed with a real authenticated request
    // during this round's live verification, not assumed), and this loop
    // below already tries each entry in order on a 404 -- it just never
    // had more than one entry to fall through to. Refreshed against
    // OpenRouter's real /api/v1/models list at the time of this fix; three
    // entries so one future deprecation doesn't take the whole provider
    // down again the same way.
    this.freeModels = [
      'google/gemma-4-26b-a4b-it:free',
      'openai/gpt-oss-20b:free',
      'nvidia/nemotron-3-nano-30b-a3b:free',
    ];
    
    this.currentModel = this.freeModels[0];
    
    if (!this.apiKey) {
      console.warn('OPENROUTER_API_KEY not found in environment variables');
    }

    // Session management for conversation context
    this.sessions = new Map();
    this.maxContextLength = 4000; // Adjust based on model's context window
  }

  // Build system prompt based on store context
  // Build system prompt based on eBadge ID support context. This used to
  // be a full e-commerce assistant persona ("helpful customer service
  // assistant for an e-commerce store", with product search, discount
  // codes, and refund-policy branches) -- contamination from the same
  // foreign template found and removed from geminiService.js/
  // chatbotController.js in an earlier audit round (see AUDIT_FIXES.md,
  // "Soraroam"). This file was never wired to any real route, so it was
  // missed until a dedicated pass through every AI service file. Rewritten
  // to match the same intent taxonomy the primary provider
  // (geminiService.js) actually uses, so this is a genuine drop-in
  // fallback, not a different bot with a different personality.
  buildSystemPrompt(context) {
    let systemPrompt = `You are a helpful support assistant for eBadge ID, a digital credentials and badges platform. You help users with questions about their account, verifying or sharing credentials, using the help center, and finding relevant FAQ articles.

Guidelines:
- Be concise, friendly, and professional.
- If you don't know something specific about the user's account, say so and offer to connect them with a human agent rather than guessing.
- Never invent ticket numbers, credential statuses, or account details you don't actually have.
- Keep responses concise but informative.`;

    if (context) {
      systemPrompt += `\n\nCURRENT SITUATION:\n`;

      switch (context.intent) {
        case 'faq_search':
          if (context.matched_faqs && context.matched_faqs.length > 0) {
            systemPrompt += `Found ${context.matched_faqs.length} relevant help articles:\n`;
            context.matched_faqs.forEach((faq, index) => {
              systemPrompt += `${index + 1}. ${faq.question}\n   ${faq.answer}\n`;
            });
          } else {
            systemPrompt += `No matching FAQ article was found for the user's question. Offer to connect them with a support agent.`;
          }
          break;

        case 'ticket_status':
          if (context.ticket) {
            systemPrompt += `Ticket ${context.ticket.ticket_code}: status is "${context.ticket.status}".`;
          } else {
            systemPrompt += `No matching ticket was found. Ask the user for their ticket code.`;
          }
          break;

        case 'technical_support':
          systemPrompt += `User is having a technical issue with the eBadge ID platform. Ask a clarifying question or offer to connect them with a support agent.`;
          break;

        case 'agent_request':
          systemPrompt += context.agentAvailable
            ? `${context.agents?.length || 0} support agents are available. Confirm you're connecting them.`
            : `No agents currently available. Apologize and offer alternatives.`;
          break;

        case 'end_chat':
          systemPrompt += `The user is ending the conversation. Thank them warmly.`;
          break;
      }
    }

    return systemPrompt;
  }

  // Get or create session context
  getSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        messages: [],
        createdAt: new Date()
      });
    }
    return this.sessions.get(sessionId);
  }

  // Add message to session context
  addToSession(sessionId, role, content) {
    const session = this.getSession(sessionId);
    session.messages.push({ role, content });
    
    // Keep context within limits (simple truncation)
    const totalLength = session.messages.reduce((sum, msg) => sum + msg.content.length, 0);
    if (totalLength > this.maxContextLength) {
      // Remove oldest messages except system message
      while (session.messages.length > 1 && 
             session.messages.reduce((sum, msg) => sum + msg.content.length, 0) > this.maxContextLength) {
        // Keep system message at index 0
        if (session.messages[1].role === 'system') {
          session.messages.splice(2, 1);
        } else {
          session.messages.splice(1, 1);
        }
      }
    }
  }

  // Clean up old sessions (call this periodically)
  cleanupSessions() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.createdAt < cutoff) {
        this.sessions.delete(sessionId);
      }
    }
  }

  async getResponse(userMessage, sessionId = 'default', context = null) {
    try {
      if (!this.apiKey) {
        throw new Error('OpenRouter API key not configured');
      }

      const session = this.getSession(sessionId);
      
      // Build system prompt with context
      const systemPrompt = this.buildSystemPrompt(context);
      
      // Prepare messages array
      const messages = [];
      
      // Add system message
      messages.push({
        role: 'system',
        content: systemPrompt
      });
      
      // Add conversation history (excluding old system messages)
      const conversationHistory = session.messages.filter(msg => msg.role !== 'system');
      messages.push(...conversationHistory);
      
      // Add current user message
      messages.push({
        role: 'user',
        content: userMessage
      });

      // Try models in order until one works
      let lastError = null;
      
      for (const model of this.freeModels) {
        try {
          console.log(`Trying model: ${model}`);
          
          const response = await axios.post(
            `${this.baseUrl}/chat/completions`,
            {
              model: model,
              messages: messages,
              temperature: 0.7,
              max_tokens: 512,
              top_p: 1,
              frequency_penalty: 0,
              presence_penalty: 0
            },
            {
              headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
                'X-Title': 'eBadge ID Help Desk Chatbot'
              },
              timeout: 30000 // 30 second timeout
            }
          );

          const assistantMessage = response.data.choices[0].message.content;
          
          // Update current model if successful
          this.currentModel = model;
          
          // Add both messages to session history
          this.addToSession(sessionId, 'user', userMessage);
          this.addToSession(sessionId, 'assistant', assistantMessage);
          
          console.log(`Successfully used model: ${model}`);
          return assistantMessage;

        } catch (modelError) {
          console.log(`Model ${model} failed:`, modelError.response?.data?.error?.message || modelError.message);
          lastError = modelError;

          // A 429 here used to return the "high traffic" apology
          // immediately, on the very FIRST model tried -- confirmed for
          // real during this round's live verification: OpenRouter's free
          // tier is a shared pool per model, and it's routine for one
          // model to be rate-limited while the others in this.freeModels
          // are not. Returning early defeated the entire point of having
          // a fallback list. Falls through to the next model now, same as
          // 404 always did; only the generic catch below (after every
          // model in the list has failed) still returns a real apology.
          
          // For other errors, try next model
          continue;
        }
      }
      
      // If all models failed
      throw lastError;

    } catch (error) {
      console.error('OpenRouter API Error:', error.response?.data || error.message);
      
      if (error.response?.status === 401) {
        return "Sorry, there's a configuration issue. Please contact support.";
      } else if (error.code === 'ECONNABORTED') {
        return "The request timed out. Please try again.";
      } else {
        return "I apologize, but I'm having trouble processing your request right now. Please try again later.";
      }
    }
  }

  // Clear session history
  clearSession(sessionId) {
    this.sessions.delete(sessionId);
  }

  // Get session info (for debugging)
  getSessionInfo(sessionId) {
    const session = this.getSession(sessionId);
    return {
      messageCount: session.messages.length,
      createdAt: session.createdAt,
      totalLength: session.messages.reduce((sum, msg) => sum + msg.content.length, 0)
    };
  }
}

// Create singleton instance
const openRouterService = new OpenRouterService();

// Clean up sessions every hour. unref()'d for the same reason as the
// equivalent timers in chatbotController.js and geminiService.js — a real
// server stays alive via its HTTP listener regardless, so this shouldn't
// be what blocks a script or test process from exiting.
setInterval(() => {
  openRouterService.cleanupSessions();
}, 60 * 60 * 1000).unref();

module.exports = {
  getResponse: (message, sessionId, context) => openRouterService.getResponse(message, sessionId, context),
  clearSession: (sessionId) => openRouterService.clearSession(sessionId),
  getSessionInfo: (sessionId) => openRouterService.getSessionInfo(sessionId)
};