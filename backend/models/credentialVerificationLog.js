const mongoose = require('mongoose');

// One document per public verification-page view (GET /by-code/:code) --
// deliberately a separate collection, not a counter field on
// credentialSchema. That endpoint is already documented as "the
// highest-traffic, least-controlled endpoint in the system"; writing to
// the credential document itself on every view would add write
// contention to a document other code paths also update (status
// transitions, revocation). An append-only log written fire-and-forget
// (same non-blocking pattern as recordAudit in credentialController.js)
// costs nothing on the read path and gives analytics something real to
// aggregate ("verification rate" — see getOrganizationAnalytics).
const credentialVerificationLogSchema = new mongoose.Schema({
  credential_code: { type: String, required: true, index: true },
  organization_code: { type: String, required: true, index: true },
  verified_at: { type: Date, default: Date.now },
}, { timestamps: false });

module.exports = mongoose.model('CredentialVerificationLogs', credentialVerificationLogSchema);
