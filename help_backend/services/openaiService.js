// services/openaiService.js
//
// Was a 15-line file with the wrong persona ("a helpful assistant for a
// Shopify helpdesk" -- same foreign-template contamination found and
// removed from geminiService.js/chatbotController.js in an earlier audit
// round, see AUDIT_FIXES.md), no error handling, and a getResponse(prompt)
// signature that didn't accept sessionId/context at all -- meaning it
// couldn't have been used as a real fallback for the primary provider
// even if it had been wired up, since it can't build the same contextual
// prompt (FAQ matches, ticket status, etc.) the other providers use.
// Rewritten to match the same interface as geminiService/deepSeekService/
// openRouterService: getResponse(prompt, sessionId, context).
const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function buildSystemPrompt(context) {
  let systemPrompt = `You are a helpful support assistant for eBadge ID, a digital credentials and badges platform. You help users with questions about their account, verifying or sharing credentials, using the help center, and finding relevant FAQ articles.

Guidelines:
- Be concise, friendly, and professional.
- If you don't know something specific about the user's account, say so and offer to connect them with a human agent rather than guessing.
- Never invent ticket numbers, credential statuses, or account details you don't actually have.`;

  if (context?.intent === 'faq_search' && context.matched_faqs?.length) {
    systemPrompt += `\n\nRelevant help articles:\n`;
    context.matched_faqs.forEach((faq, i) => {
      systemPrompt += `${i + 1}. ${faq.question}\n   ${faq.answer}\n`;
    });
  } else if (context?.intent === 'ticket_status' && context.ticket) {
    systemPrompt += `\n\nTicket ${context.ticket.ticket_code}: status is "${context.ticket.status}".`;
  }

  return systemPrompt;
}

async function getResponse(prompt, sessionId = 'default', context = null) {
  const chat = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: buildSystemPrompt(context) },
      { role: "user", content: prompt },
    ],
  });
  return chat.choices[0].message.content.trim();
}

module.exports = { getResponse };
