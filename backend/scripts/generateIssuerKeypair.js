// scripts/generateIssuerKeypair.js
//
// One-time setup step for real Open Badges 3.0 signing (see
// utils/openBadgeSigning.js) — run this once, save the private key PEM it
// prints as OB3_ISSUER_PRIVATE_KEY_PEM in your .env, and the public key
// automatically becomes servable at GET /.well-known/did.json (see
// api.js) once that env var is set. There is no server-side "upload the
// key" step; the DID document route just re-derives the public key from
// whatever private key is configured.
//
//   node scripts/generateIssuerKeypair.js
//
const { generateIssuerKeypair } = require('../utils/openBadgeSigning');

const { privateKeyPem, publicKeyMultibase } = generateIssuerKeypair();

console.log('='.repeat(72));
console.log('New Ed25519 issuer keypair generated.');
console.log('='.repeat(72));
console.log();
console.log('1. Add this to your .env (keep it secret — same handling as JWT_SECRET):');
console.log();
console.log('OB3_ISSUER_PRIVATE_KEY_PEM="' + privateKeyPem.trim().replace(/\n/g, '\\n') + '"');
console.log();
console.log('2. Once set, the matching public key is automatically served at:');
console.log('   GET /.well-known/did.json');
console.log();
console.log('   Public key (multibase):', publicKeyMultibase);
console.log();
console.log('3. This is what makes Open Badges 3.0 credentials from this deployment');
console.log('   carry a real, verifiable signature instead of just an integrity hash');
console.log('   — see utils/openBadgeSigning.js and controllers/credentialController.js');
console.log('   (getCredentialAsOpenBadge) for what changes once this is configured.');
