const crypto = require('crypto');

class EncryptionService {
  constructor() {
    const secret = process.env.ENCRYPTION_SECRET;
    if (process.env.NODE_ENV === 'production' && (!secret || secret.length < 32)) {
      throw new Error('ENCRYPTION_SECRET must contain at least 32 characters in production');
    }
    this.secretKey = crypto.createHash('sha256').update(secret || 'development-only-encryption-secret').digest();
  }

  encrypt(text) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.secretKey, iv);
    const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v2', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  decrypt(value) {
    try {
      // Security fix, found during an audit round: this used to fall
      // back to a legacy AES-256-CBC branch (fixed, all-zero IV) for any
      // value not starting with "v2." -- reachable with any attacker-
      // controlled string, before any database lookup ever happens (see
      // controllers/userController.js's self_signup_user). A fixed IV in
      // CBC mode is exactly the shape of a padding-oracle vector (Vaudenay):
      // this method's three distinct failure points used to surface as
      // three different caller-visible outcomes (bad padding here vs. a
      // malformed "email:org:code" payload vs. no matching Invitation
      // row), which is the actual oracle a real attack needs. The comment
      // this replaced said these "naturally disappear after the
      // invitation TTL" -- true, and by now (long after the GCM
      // migration) none are expected to remain; removing the branch
      // entirely closes the crypto weakness outright rather than
      // continuing to carry it as a compatibility shim nothing still
      // needs. Any invitation token that predates the GCM migration
      // simply fails to decrypt now, the same outcome an expired
      // invitation already produces.
      if (!value.startsWith('v2.')) throw new Error('Invalid encrypted token');
      const [, encodedIv, encodedTag, encodedCiphertext] = value.split('.');
      if (!encodedIv || !encodedTag || !encodedCiphertext) throw new Error('Invalid encrypted token');
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.secretKey, Buffer.from(encodedIv, 'base64url'));
      decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('Invalid encrypted token');
    }
  }

  generateInvitationToken(email, orgCode, sixDigitCode, designation) {
    return this.encrypt(`${email}:${orgCode}:${sixDigitCode}:${designation || ''}`);
  }

  verifyInvitationToken(encryptedToken) {
    try {
      const [email, orgCode, sixDigitCode, designation] = this.decrypt(encryptedToken).split(':');
      if (!email || !orgCode || !sixDigitCode) throw new Error('Invalid invitation payload');
      return { isValid: true, email, orgCode, sixDigitCode, designation };
    } catch (error) {
      return { isValid: false, error: error.message };
    }
  }
}

module.exports = new EncryptionService();
