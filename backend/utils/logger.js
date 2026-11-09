// utils/logger.js
//
// Structured JSON logging, zero external dependencies (no need to add
// winston/pino as a new dependency for what this needs). Every log line is
// one JSON object per line — that's what lets a real log aggregator
// (CloudWatch, Datadog, whatever gets used in production) parse, filter,
// and alert on this instead of grepping free-text console.log output.
//
// This does not replace every console.log in the codebase (there are ~38
// scattered across controllers) — it's wired into the two places that give
// the most value for the least risk: the request logger and the central
// error handler in api.js, plus the credential issuance flow, which is the
// core business event worth being able to search for in production logs.
// See AUDIT_FIXES.md for what's covered vs not.
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function write(level, message, meta = {}) {
  if (LEVELS[level] > LEVELS[LOG_LEVEL]) return;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

module.exports = {
  error: (message, meta) => write('error', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  info: (message, meta) => write('info', message, meta),
  debug: (message, meta) => write('debug', message, meta),
};
