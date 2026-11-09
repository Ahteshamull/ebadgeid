// utils/openBadgeSigning.js
//
// Real W3C Data Integrity signing for Open Badges 3.0 credentials --
// `eddsa-jcs-2022`, a cryptosuite actually registered with the W3C
// (https://www.w3.org/TR/vc-di-eddsa/#eddsa-jcs-2022), not the
// integrity-hash placeholder credentialController.js used before this
// (`ebadgeid-sha256-integrity-2024`, explicitly documented there as not a
// real signature). Ed25519 keys are generated with Node's own built-in
// `crypto` module (native support since Node 12, no external crypto
// library needed) -- see scripts/generateIssuerKeypair.js to create one.
//
// What passing the real 1EdTech conformance test still requires beyond
// this file being correct: the operator actually generating a keypair
// (scripts/generateIssuerKeypair.js), setting OB3_ISSUER_PRIVATE_KEY_PEM,
// publishing the resulting DID document (served at /.well-known/did.json
// once that env var is set -- see routes below), and running the
// conformance suite itself against a real deployment. This file makes all
// of that possible; it doesn't replace 1EdTech's own tool actually
// confirming it.
const crypto = require('crypto');
const bs58 = require('bs58').default || require('bs58');

// `canonicalize` ships ESM-only (no CJS `require` export) while this
// codebase is CommonJS throughout -- loaded via dynamic import() (a
// function call, valid from CJS, unlike a static `import` statement) and
// cached after the first call rather than re-importing on every sign.
let canonicalizePromise = null;
async function getCanonicalize() {
  if (!canonicalizePromise) canonicalizePromise = import('canonicalize').then((mod) => mod.default);
  return canonicalizePromise;
}

// Multicodec prefix for an Ed25519 public key (0xed01), per the
// multikey spec these DID documents use -- not an arbitrary choice, this
// exact prefix is what makes a multibase string decode unambiguously as
// "this is an Ed25519 public key" rather than some other key type.
const ED25519_PUB_MULTICODEC_PREFIX = Buffer.from([0xed, 0x01]);
const ED25519_PRIV_MULTICODEC_PREFIX = Buffer.from([0x80, 0x26]);

function rawPublicKeyFromKeyObject(publicKeyObject) {
  // Node's Ed25519 SPKI DER export is a fixed 12-byte ASN.1 header
  // followed by the raw 32-byte key -- true for every Ed25519 key Node
  // generates (fixed-size, no variable-length fields in this specific
  // structure), not something that needs parsing a general ASN.1 grammar.
  const der = publicKeyObject.export({ type: 'spki', format: 'der' });
  return der.subarray(der.length - 32);
}

function multibasePublicKey(rawPublicKey) {
  return `z${bs58.encode(Buffer.concat([ED25519_PUB_MULTICODEC_PREFIX, rawPublicKey]))}`;
}

// Generates a fresh Ed25519 keypair and returns everything
// scripts/generateIssuerKeypair.js needs to hand the operator: the PEM to
// store as OB3_ISSUER_PRIVATE_KEY_PEM, and the multibase-encoded public
// key that goes in the DID document.
function generateIssuerKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyMultibase = multibasePublicKey(rawPublicKeyFromKeyObject(publicKey));
  return { privateKeyPem, publicKeyMultibase };
}

function isConfigured() {
  return Boolean(process.env.OB3_ISSUER_PRIVATE_KEY_PEM);
}

function loadIssuerKeyPair() {
  if (!isConfigured()) return null;
  const privateKey = crypto.createPrivateKey(process.env.OB3_ISSUER_PRIVATE_KEY_PEM);
  const publicKey = crypto.createPublicKey(privateKey);
  return { privateKey, publicKey, publicKeyMultibase: multibasePublicKey(rawPublicKeyFromKeyObject(publicKey)) };
}

function verificationMethodId(appBaseUrl, publicKeyMultibase) {
  return `${appBaseUrl}/.well-known/did.json#${publicKeyMultibase}`;
}

// The actual eddsa-jcs-2022 signing algorithm: canonicalize (RFC 8785 JSON
// Canonicalization Scheme, via the `canonicalize` package) the proof
// options and the unsecured credential SEPARATELY, hash each with
// SHA-256, concatenate the two hashes, and Ed25519-sign that
// concatenation. Ed25519 (`crypto.sign(null, data, key)` — the `null`
// algorithm is correct here: Ed25519 does its own internal hashing, an
// external digest algorithm is neither needed nor valid for this key
// type) is used, not the SHA-256 digest signed with something else — this
// two-hash-then-sign shape is exactly what the W3C spec (not an
// eBadgeID-specific choice) defines for this cryptosuite.
async function signCredential(unsecuredCredential, { verificationMethod, created = new Date().toISOString() }) {
  const keyPair = loadIssuerKeyPair();
  if (!keyPair) throw new Error('OB3_ISSUER_PRIVATE_KEY_PEM is not configured -- cannot sign');
  const canonicalize = await getCanonicalize();

  const proofConfig = {
    '@context': unsecuredCredential['@context'],
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    created,
    verificationMethod,
    proofPurpose: 'assertionMethod',
  };

  const proofConfigHash = crypto.createHash('sha256').update(canonicalize(proofConfig)).digest();
  const docHash = crypto.createHash('sha256').update(canonicalize(unsecuredCredential)).digest();
  const signature = crypto.sign(null, Buffer.concat([proofConfigHash, docHash]), keyPair.privateKey);

  return {
    ...proofConfig,
    proofValue: `z${bs58.encode(signature)}`,
  };
}

// Verification is the same construction run backward — recompute the
// same two hashes from the credential and the proof's own (public) fields
// minus proofValue, then crypto.verify the signature against them. Not
// wired into any route (nothing in this codebase needs to verify its own
// signatures — a real verifier would do this independently, that's the
// point of a public key), but real and tested, so the signing side is
// checked against something other than itself.
async function verifyCredentialSignature(securedCredential, publicKeyMultibase) {
  const canonicalize = await getCanonicalize();
  const { proof, ...unsecuredCredential } = securedCredential;
  const { proofValue, ...proofConfig } = proof;

  const decodedPub = bs58.decode(publicKeyMultibase.slice(1));
  const rawPub = Buffer.from(decodedPub.subarray(2)); // strip the 2-byte multicodec prefix
  const publicKey = crypto.createPublicKey({ key: Buffer.concat([
    // Re-wrap the raw 32-byte key in the same fixed 12-byte SPKI header
    // Node itself produces for Ed25519 -- crypto.createPublicKey needs a
    // full SPKI structure, not a bare key, to import it as 'der'/'spki'.
    Buffer.from('302a300506032b6570032100', 'hex'),
    rawPub,
  ]), format: 'der', type: 'spki' });

  const proofConfigHash = crypto.createHash('sha256').update(canonicalize(proofConfig)).digest();
  const docHash = crypto.createHash('sha256').update(canonicalize(unsecuredCredential)).digest();
  const signature = Buffer.from(bs58.decode(proofValue.slice(1)));

  return crypto.verify(null, Buffer.concat([proofConfigHash, docHash]), publicKey, signature);
}

// Makes real Ed25519 signing the default for every new deployment, not an
// opt-in step an operator has to remember (scripts/generateIssuerKeypair.js
// + manually setting OB3_ISSUER_PRIVATE_KEY_PEM still works and takes
// priority if set -- this only fires when that env var is absent).
// Called once at boot (see api.js's startServer()), before any request is
// served. Idempotent and safe under concurrent boots of multiple
// instances: the unique index on SystemKeypair.key_name means a losing
// concurrent insert throws E11000, which is caught and treated as "someone
// else just created it" -- falls through to reading the (now-existing)
// document instead of erroring.
async function ensureIssuerKeypair() {
  if (isConfigured()) return; // operator-provided key always wins
  const SystemKeypair = require('../models/systemKeypair');

  const existing = await SystemKeypair.findOne({ key_name: 'ob3_issuer' }).select('+private_key_pem').lean();
  if (existing) {
    process.env.OB3_ISSUER_PRIVATE_KEY_PEM = existing.private_key_pem;
    return;
  }

  const { privateKeyPem, publicKeyMultibase } = generateIssuerKeypair();
  try {
    await SystemKeypair.create({ key_name: 'ob3_issuer', private_key_pem: privateKeyPem, public_key_multibase: publicKeyMultibase });
    process.env.OB3_ISSUER_PRIVATE_KEY_PEM = privateKeyPem;
  } catch (error) {
    if (error.code === 11000) {
      // Lost a race with another instance booting at the same time --
      // read back the one that won instead of using the keypair generated
      // (and discarded) here.
      const winner = await SystemKeypair.findOne({ key_name: 'ob3_issuer' }).select('+private_key_pem').lean();
      process.env.OB3_ISSUER_PRIVATE_KEY_PEM = winner.private_key_pem;
    } else {
      throw error;
    }
  }
}

module.exports = {
  generateIssuerKeypair,
  isConfigured,
  loadIssuerKeyPair,
  verificationMethodId,
  signCredential,
  verifyCredentialSignature,
  ensureIssuerKeypair,
};
