// tests/logger.test.js
//
// The structured logger is the backbone of the new observability work
// (AUDIT_FIXES.md, ronda 5) — every request and error now goes through it.
// This locks in the one contract that matters: it always emits valid,
// parseable JSON with the fields a log aggregator needs, and respects
// LOG_LEVEL so debug noise doesn't ship to production by default.
const test = require('node:test');
const assert = require('node:assert/strict');

test('logger emits parseable JSON with required fields', () => {
  const originalWrite = process.stdout.write;
  let captured = '';
  process.stdout.write = (chunk) => { captured += chunk; return true; };

  delete require.cache[require.resolve('../utils/logger')];
  const logger = require('../utils/logger');
  logger.info('test_event', { foo: 'bar' });

  process.stdout.write = originalWrite;

  const parsed = JSON.parse(captured.trim());
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.message, 'test_event');
  assert.equal(parsed.foo, 'bar');
  assert.ok(parsed.timestamp);
});

test('logger respects LOG_LEVEL and suppresses debug by default', () => {
  const originalWrite = process.stdout.write;
  let captured = '';
  process.stdout.write = (chunk) => { captured += chunk; return true; };
  const originalLevel = process.env.LOG_LEVEL;
  delete process.env.LOG_LEVEL; // defaults to 'info'

  delete require.cache[require.resolve('../utils/logger')];
  const logger = require('../utils/logger');
  logger.debug('should_not_appear');

  process.stdout.write = originalWrite;
  if (originalLevel) process.env.LOG_LEVEL = originalLevel;

  assert.equal(captured, '', 'debug-level logs should be suppressed when LOG_LEVEL is info');
});

test('logger writes errors to stderr, not stdout', () => {
  const originalErrWrite = process.stderr.write;
  const originalOutWrite = process.stdout.write;
  let stderrCaptured = '';
  let stdoutCaptured = '';
  process.stderr.write = (chunk) => { stderrCaptured += chunk; return true; };
  process.stdout.write = (chunk) => { stdoutCaptured += chunk; return true; };

  delete require.cache[require.resolve('../utils/logger')];
  const logger = require('../utils/logger');
  logger.error('something_broke');

  process.stderr.write = originalErrWrite;
  process.stdout.write = originalOutWrite;

  assert.ok(stderrCaptured.includes('something_broke'));
  assert.equal(stdoutCaptured, '');
});
