// models/systemKeypair.js
//
// Persists auto-generated system-level keypairs (currently just the Open
// Badges 3.0 issuer key) so "generated automatically on first boot" is
// actually stable across restarts -- an env var alone can't do that: if
// OB3_ISSUER_PRIVATE_KEY_PEM isn't set, generating a fresh keypair on
// every boot would rotate the verification method (and invalidate every
// already-issued signature) on every deploy. One singleton document per
// `key_name` -- created once, read forever after.
const mongoose = require('mongoose');

const systemKeypairSchema = new mongoose.Schema({
  key_name: { type: String, required: true, unique: true, index: true },
  private_key_pem: { type: String, required: true, select: false },
  public_key_multibase: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model('SystemKeypair', systemKeypairSchema);
