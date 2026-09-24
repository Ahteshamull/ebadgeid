const test = require('node:test');
const assert = require('node:assert/strict');
const { generateOtp } = require('../utils/OtpUtils');

test('OTP generation always yields six numeric digits with nontrivial variation', () => {
  const values = Array.from({ length: 100 }, generateOtp);
  assert.ok(values.every(value => /^\d{6}$/.test(value)));
  assert.ok(new Set(values).size > 95);
});
