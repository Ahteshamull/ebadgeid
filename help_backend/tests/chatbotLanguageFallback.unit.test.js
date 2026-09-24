// tests/chatbotLanguageFallback.unit.test.js
//
// Bug found while verifying (for real, no API keys configured) that the
// chatbot's degraded fallback -- what every user gets when no AI provider
// is configured or every configured one fails -- doesn't crash. It didn't
// crash, but getSessionLanguage(sessionId) always returned 'english' for
// any session with no established history yet (conversationHistory only
// gets populated after a *successful* model call), discarding the language
// of the message actually being answered. A first-time Spanish/French/
// German/Italian/Portuguese/Arabic speaker whose message never reached a
// model got an English reply. Fixed by having getSessionLanguage accept an
// optional fallbackText, detected fresh when there's no session history —
// see services/geminiService.js.
const test = require('node:test');
const assert = require('node:assert/strict');

const { getSessionLanguage, detectLanguage } = require('../services/geminiService');
const aiGateway = require('../services/aiGateway');

test('getSessionLanguage detects the language of fallbackText for a session with no history yet', () => {
  const sessionId = `lang-test-${Date.now()}-es`;
  assert.equal(getSessionLanguage(sessionId, 'Hola, necesito ayuda con mi credencial'), 'spanish');
});

test('getSessionLanguage falls back to english for a session with no history and no fallbackText', () => {
  const sessionId = `lang-test-${Date.now()}-none`;
  assert.equal(getSessionLanguage(sessionId), 'english');
});

test('detectLanguage recognizes each language getSessionLanguage can fall back to', () => {
  assert.equal(detectLanguage('Hola, necesito ayuda'), 'spanish');
  assert.equal(detectLanguage('Bonjour, j ai besoin d aide'), 'french');
  assert.equal(detectLanguage('Hallo, ich brauche Hilfe'), 'german');
  assert.equal(detectLanguage('Ciao, ho bisogno di aiuto'), 'italian');
  assert.equal(detectLanguage('Ola, preciso de ajuda'), 'portuguese');
  assert.equal(detectLanguage('The quick brown fox jumps over the lazy dog'), 'english');
});

test('aiGateway.getResponse — with every provider unconfigured — answers a Spanish message in Spanish, not English', async () => {
  const originalKeys = {
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  delete process.env.GOOGLE_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const sessionId = `lang-test-${Date.now()}-gateway-es`;
    const response = await aiGateway.getResponse('Hola, necesito ayuda con mi credencial de certificacion', sessionId, null);
    assert.equal(typeof response, 'string');
    assert.match(response, /[áéíóúñ]|ayudarte|credenciales|pregunta/i, `expected a Spanish fallback, got: ${response}`);
  } finally {
    Object.assign(process.env, originalKeys);
  }
});

test('aiGateway.getResponse — with every provider unconfigured — never throws, even under a bad/empty prompt', async () => {
  const originalKeys = {
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  delete process.env.GOOGLE_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const response = await aiGateway.getResponse('', `lang-test-${Date.now()}-empty`, null);
    assert.equal(typeof response, 'string');
    assert.ok(response.length > 0);
  } finally {
    Object.assign(process.env, originalKeys);
  }
});
