// services/deepseekService.js
const axios = require('axios');

class DeepSeekService {
  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY;
    this.baseURL = 'https://api.deepseek.com/v1';
    this.model = 'deepseek-chat'; // or 'deepseek-reasoner' for more complex reasoning
    this.conversations = new Map(); // Store conversation history by sessionId
    this.maxContextMessages = 10; // Limit conversation history to control costs
  }

  // Build system prompt for the eBadge ID support chatbot. Was "helpful
  // e-commerce customer service assistant" (help customers find products,
  // order status, store policies) -- same foreign-template contamination
  // found and removed from geminiService.js/chatbotController.js in an
  // earlier audit round (see AUDIT_FIXES.md, "Soraroam"). This service was
  // never wired to any real route, so it was missed until a dedicated pass
  // through every AI service file.
  buildSystemPrompt(context = null) {
    let systemPrompt = `You are a helpful support assistant for eBadge ID, a digital credentials and badges platform.

Your role is to:
- Help users with questions about their account and credentials
- Look up support ticket status when given a ticket code
- Point users to relevant FAQ articles
- Connect users with a human support agent when needed
- Be friendly, professional, and concise

Guidelines:
- Always be helpful and polite
- Provide accurate information based on the context provided
- If you don't have specific information about the user's account, say so and offer to connect them with a support agent rather than guessing
- Never invent ticket numbers, credential statuses, or account details you don't actually have
- Keep responses concise but informative
- Use a conversational tone`;

    if (context) {
      systemPrompt += `\n\nContext for this conversation:\n${JSON.stringify(context, null, 2)}`;
    }

    return systemPrompt;
  }

  // Get conversation history for a session
  getConversationHistory(sessionId) {
    if (!this.conversations.has(sessionId)) {
      this.conversations.set(sessionId, []);
    }
    return this.conversations.get(sessionId);
  }

  // Add message to conversation history
  addToConversationHistory(sessionId, role, content) {
    const history = this.getConversationHistory(sessionId);
    history.push({ role, content });
    
    // Limit conversation history to control token usage and costs
    if (history.length > this.maxContextMessages * 2) { // *2 because each exchange has user + assistant
      history.splice(0, 2); // Remove oldest user-assistant pair
    }
    
    this.conversations.set(sessionId, history);
  }

  // Build messages array for API request
  buildMessages(userInput, sessionId, context = null) {
    const messages = [];
    
    // Add system message
    messages.push({
      role: "system",
      content: this.buildSystemPrompt(context)
    });

    // Add conversation history
    const history = this.getConversationHistory(sessionId);
    messages.push(...history);

    // Add current user message
    messages.push({
      role: "user",
      content: userInput
    });

    return messages;
  }

  // Main function to get response from DeepSeek
  async getResponse(userInput, sessionId = 'default', context = null) {
    try {
      if (!this.apiKey) {
        throw new Error('DeepSeek API key not configured');
      }

      const messages = this.buildMessages(userInput, sessionId, context);

      const requestData = {
        model: this.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 500, // Limit response length to control costs
        stream: false
      };

      const response = await axios.post(`${this.baseURL}/chat/completions`, requestData, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      });

      const assistantResponse = response.data.choices[0].message.content;

      // Add both user message and assistant response to conversation history
      this.addToConversationHistory(sessionId, 'user', userInput);
      this.addToConversationHistory(sessionId, 'assistant', assistantResponse);

      // Log token usage for monitoring
      if (response.data.usage) {
        console.log(`DeepSeek API Usage - Session: ${sessionId}`, {
          prompt_tokens: response.data.usage.prompt_tokens,
          completion_tokens: response.data.usage.completion_tokens,
          total_tokens: response.data.usage.total_tokens
        });
      }

      return assistantResponse;

    } catch (error) {
      console.error('DeepSeek API Error:', error.response?.data || error.message);
      
      // Handle specific error cases
      if (error.response?.status === 401) {
        return "I'm experiencing authentication issues. Please contact support.";
      } else if (error.response?.status === 429) {
        return "I'm currently experiencing high demand. Please try again in a moment.";
      } else if (error.response?.status >= 500) {
        return "I'm experiencing technical difficulties. Please try again later.";
      } else {
        return "I'm sorry, I'm having trouble processing your request right now. Please try again or contact support.";
      }
    }
  }

  // Clear conversation history for a session
  clearConversation(sessionId) {
    this.conversations.delete(sessionId);
  }

  // Get conversation statistics
  getConversationStats(sessionId) {
    const history = this.getConversationHistory(sessionId);
    return {
      messageCount: history.length,
      userMessages: history.filter(msg => msg.role === 'user').length,
      assistantMessages: history.filter(msg => msg.role === 'assistant').length
    };
  }

  // Set model (deepseek-chat or deepseek-reasoner)
  setModel(model) {
    if (['deepseek-chat', 'deepseek-reasoner'].includes(model)) {
      this.model = model;
    } else {
      throw new Error('Invalid model. Use "deepseek-chat" or "deepseek-reasoner"');
    }
  }

  // Set max context messages to control costs
  setMaxContextMessages(count) {
    this.maxContextMessages = Math.max(1, Math.min(count, 20)); // Between 1 and 20
  }
}

// Create singleton instance
const deepSeekService = new DeepSeekService();

// Export the main function and service instance
module.exports = {
  getResponse: (userInput, sessionId, context) => 
    deepSeekService.getResponse(userInput, sessionId, context),
  clearConversation: (sessionId) => 
    deepSeekService.clearConversation(sessionId),
  getConversationStats: (sessionId) => 
    deepSeekService.getConversationStats(sessionId),
  setModel: (model) => 
    deepSeekService.setModel(model),
  setMaxContextMessages: (count) => 
    deepSeekService.setMaxContextMessages(count),
  deepSeekService // Export service instance for advanced usage
};