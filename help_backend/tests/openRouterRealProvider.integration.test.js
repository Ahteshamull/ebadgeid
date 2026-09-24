// tests/openRouterRealProvider.integration.test.js
//
// Real, live verification against OpenRouter's actual API -- not part of
// the standard `npm test` run (same documented pattern as
// tests/lmsSync.integration.test.js's certificate-microservice check):
// skips cleanly when OPENROUTER_API_KEY isn't set, runs for real otherwise.
//
// Two real bugs were found and fixed this round, both discovered only by
// actually calling the live API, not by reading the code:
// 1. The single hardcoded free model (google/gemma-2-9b-it:free) had been
//    discontinued by OpenRouter -- confirmed with a real 404
//    ("No endpoints found"). Refreshed against OpenRouter's real
//    /api/v1/models list, and expanded to 3 fallback models.
// 2. getResponse() returned the canned "high traffic" apology on the
//    FIRST model's 429, without ever trying the other models in the
//    fallback list -- confirmed by a real request that hit exactly this.
//    Fixed to fall through on 429 same as it already did on 404.
const test = require('node:test');
const assert = require('node:assert/strict');

test('openRouterService.getResponse returns a real, non-canned answer when a key is configured', async (t) => {
  if (!process.env.OPENROUTER_API_KEY) {
    return t.skip('needs a real OPENROUTER_API_KEY -- not part of the standard npm test run, see AUDIT_FIXES.md');
  }
  const openRouter = require('../services/openRouterService');
  const response = await openRouter.getResponse(
    'What is 2 + 2? Answer with just the number.',
    `openrouter-real-test-${Date.now()}`,
    null
  );
  assert.equal(typeof response, 'string');
  assert.ok(response.length > 0);
  // The canned fallback strings this file's own code returns on total
  // failure -- a real model response should never exactly equal one of
  // these, even at exact string level (a real LLM doesn't quote its own
  // error-path copy back verbatim).
  const cannedFallbacks = [
    "I'm currently experiencing high traffic. Please try again in a moment.",
    "Sorry, there's a configuration issue. Please contact support.",
    'The request timed out. Please try again.',
    "I apologize, but I'm having trouble processing your request right now. Please try again later.",
  ];
  assert.ok(!cannedFallbacks.includes(response.trim()), `got a canned fallback instead of a real model response: ${response}`);
});
