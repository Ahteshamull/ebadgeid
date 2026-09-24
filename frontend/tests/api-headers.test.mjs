// tests/api-headers.test.mjs
//
// Locks in a real bug found and fixed while wiring up file uploads:
// getAuthHeaders always forced Content-Type: application/json, which
// silently breaks any multipart/form-data request (the browser needs to
// set its own Content-Type with a boundary for FormData bodies — a
// manually-set one prevents that, and the server ends up unable to parse
// the upload at all, with no obvious error pointing at the cause).
import test from 'node:test';
import assert from 'node:assert/strict';
import { getAuthHeaders } from '../src/lib/api.js';

test('getAuthHeaders sets application/json for a normal JSON request', () => {
  const headers = getAuthHeaders({}, false);
  assert.equal(headers['Content-Type'], 'application/json');
});

test('getAuthHeaders omits Content-Type for a FormData request, letting the browser set the multipart boundary', () => {
  const headers = getAuthHeaders({}, true);
  assert.equal(headers['Content-Type'], undefined);
});
