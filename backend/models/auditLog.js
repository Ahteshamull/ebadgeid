const mongoose = require('mongoose');

// Append-only audit trail for credential lifecycle events (issued, claimed,
// revoked). This didn't exist before — the only history was whatever the
// current credential_status field said, with no record of who changed it,
// when, or what it was before. For a product whose core promise is
// "verifiable and trustworthy," being able to answer "who revoked this and
// when" is not optional.
const auditLogSchema = new mongoose.Schema({
  entity_type: { type: String, required: true, index: true }, // e.g. 'credential'
  entity_id: { type: String, required: true, index: true },   // e.g. credential_code
  event: { type: String, required: true },                    // e.g. 'issued', 'claimed', 'revoked'
  organization_code: { type: String, required: true, index: true },
  actor_username: { type: String, default: null },            // null for system/API-key actions
  metadata: { type: Object, default: {} },
}, { timestamps: true });

module.exports = mongoose.model('AuditLog', auditLogSchema);
