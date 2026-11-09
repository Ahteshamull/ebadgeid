// utils/backupEncryption.js
//
// Deliberately separate from utils/cryptoHelper.js's EncryptionService:
// that one is keyed by ENCRYPTION_SECRET and shaped for small UTF-8
// strings (invitation tokens). A key compromised for one purpose
// shouldn't also unlock every historical database backup ever taken --
// BACKUP_ENCRYPTION_KEY is its own, separate secret, and this operates
// on Buffers directly (backup payloads are large binary JSON blobs, not
// short tokens).
const crypto = require('crypto');

function getKey() {
  const secret = process.env.BACKUP_ENCRYPTION_KEY;
  if (!secret) throw new Error('BACKUP_ENCRYPTION_KEY is not set — cannot encrypt/decrypt backups');
  return crypto.createHash('sha256').update(secret).digest();
}

// AES-256-GCM: IV + auth tag + ciphertext concatenated into one buffer,
// so a backup file is exactly one encrypted blob, not a matched pair of
// files that could be separated.
function encryptBuffer(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

function decryptBuffer(encrypted) {
  const key = getKey();
  const iv = encrypted.subarray(0, 12);
  const tag = encrypted.subarray(12, 28);
  const ciphertext = encrypted.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

module.exports = { encryptBuffer, decryptBuffer };
