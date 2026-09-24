// services/aiGateway.js
//
// This is the "AI Gateway multi-proveedor" that AI_AUDIT.md documented as
// missing: geminiService.js was the only provider actually wired to
// chatbotController.js, while deepSeekService.js, openRouterService.js,
// and openaiService.js existed as unused files with zero consumers and
// (as found in a later forensic pass) the wrong business persona baked
// into their prompts — leftover contamination from the same foreign
// template already cleaned out of geminiService.js/chatbotController.js.
// Fixed those personas first (see AUDIT_FIXES.md), then built this.
//
// Order: Gemini (primary) -> DeepSeek -> OpenRouter -> OpenAI (last
// resort). A provider is only attempted if its required API key is
// actually configured -- there's no point spending a timeout window on a
// provider that's guaranteed to fail instantly on a missing key. If every
// configured provider fails, this falls back to geminiService's own
// generateFallbackResponse, which already speaks the user's detected
// language and never throws.
const gemini = require('./geminiService');

// Was 8000 -- fine for a single fast API call, but openRouterService (the
// free-tier fallback, most likely to actually be configured -- see
// PROVIDERS below) tries up to 3 free models *sequentially* on its own
// when one is rate-limited or unavailable, exactly the kind of thing that
// used to make gemini fail over to it in the first place. Measured for
// real: a real, correct, high-quality response came back in ~34s after
// the first free model was rate-limited and the second had to actually
// generate -- well past the old 8s budget, which was cutting the request
// off and returning the canned degraded response even though a real
// answer was seconds away. 25s trades a bit of worst-case latency for
// actually getting real AI responses out of a free tier that's
// legitimately slower and more variable than a paid one.
const PROVIDER_TIMEOUT_MS = 25000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

// Lazily required so a provider with a missing/invalid dependency doesn't
// break the whole gateway at require-time -- only when it's actually
// reached in the fallback chain.
const PROVIDERS = [
  {
    name: 'gemini',
    enabled: () => Boolean(process.env.GOOGLE_API_KEY),
    getResponse: (...args) => gemini.getResponse(...args),
  },
  {
    name: 'deepseek',
    enabled: () => Boolean(process.env.DEEPSEEK_API_KEY),
    getResponse: (...args) => require('./deepSeekService').getResponse(...args),
  },
  {
    name: 'openrouter',
    enabled: () => Boolean(process.env.OPENROUTER_API_KEY),
    getResponse: (...args) => require('./openRouterService').getResponse(...args),
  },
  {
    name: 'openai',
    enabled: () => Boolean(process.env.OPENAI_API_KEY),
    getResponse: (...args) => require('./openaiService').getResponse(...args),
  },
];

async function getResponse(prompt, sessionId = 'default', context = null, organizationCode) {
  const attempted = [];
  for (const provider of PROVIDERS) {
    if (!provider.enabled()) continue; // no key configured — skip, don't waste the timeout window
    attempted.push(provider.name);
    try {
      // eslint-disable-next-line no-await-in-loop
      return await withTimeout(
        provider.getResponse(prompt, sessionId, context, organizationCode),
        PROVIDER_TIMEOUT_MS,
        provider.name
      );
    } catch (error) {
      console.error(`[aiGateway] ${provider.name} failed: ${error.message}`);
      // fall through to the next provider
    }
  }

  // Every configured provider failed (or none were configured at all,
  // e.g. no API keys set anywhere) — geminiService's own fallback speaks
  // the user's detected language and never throws, so this is always a
  // safe final step rather than a second failure mode to handle.
  console.error(`[aiGateway] all providers exhausted (attempted: ${attempted.join(', ') || 'none configured'})`);
  const { detectLanguage, getSessionLanguage } = gemini;
  const sessionLang = getSessionLanguage ? getSessionLanguage(sessionId, prompt) : detectLanguage(prompt);
  return gemini.generateFallbackResponse ? gemini.generateFallbackResponse(context, sessionLang) : "I'm having trouble responding right now. Could you try again, or would you like to speak with a support agent?";
}

module.exports = { getResponse, PROVIDERS };
