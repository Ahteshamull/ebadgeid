import test from 'node:test';
import assert from 'node:assert/strict';
import { exchangeInvitation, readInvitation } from '../src/lib/contract-session.mjs';

test('reads a fragment token without exposing it in the query string', () => {
  assert.deepEqual(readInvitation({ pathname: '/collaborate/C-7', search: '', hash: '#accessToken=secret' }), {
    contractCode: 'C-7', accessToken: 'secret'
  });
});

test('exchanges invitation using credentials and a JSON body', async () => {
  let request;
  await exchangeInvitation('https://api.example.test/api', 'secret', async (url, options) => {
    request = { url, options };
    return { ok: true };
  });
  assert.equal(request.options.credentials, 'include');
  assert.equal(JSON.parse(request.options.body).access_token, 'secret');
  assert.doesNotMatch(request.url, /secret/);
});

test('rejects an invalid invitation exchange', async () => {
  await assert.rejects(() => exchangeInvitation('/api', 'bad', async () => ({ ok: false })), /invalid or expired/i);
});
