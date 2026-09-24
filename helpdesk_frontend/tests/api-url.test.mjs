import test from 'node:test';
import assert from 'node:assert/strict';
import { apiUrl, shouldRedirectForSession } from '../src/lib/api-url.mjs';

test('builds relative API URLs without duplicate slashes', () => {
  assert.equal(apiUrl('https://hapi.example/api/', '/tickets/1'), 'https://hapi.example/api/tickets/1');
});

test('preserves explicit upload URLs', () => {
  assert.equal(apiUrl('https://hapi.example/api', 'https://files.example/x'), 'https://files.example/x');
});

test('redirect policy handles authentication failures only', () => {
  assert.equal(shouldRedirectForSession(401), true);
  assert.equal(shouldRedirectForSession(403), true);
  assert.equal(shouldRedirectForSession(500), false);
});
