const mongoose = require('mongoose');

// Idempotency guard for LMS webhooks. LMS platforms (and webhooks in
// general) commonly retry on a timeout or a 5xx even when the original
// request actually succeeded server-side — without this, a retried
// "course completed" event would issue a second credential for the same
// completion. The compound unique index is the actual guard: the insert
// itself fails on a duplicate (organization_code, external_event_id)
// pair, which is what routes/lmsWebhookRoutes.js relies on to detect a
// replay before doing any issuance work.
const lmsWebhookEventSchema = new mongoose.Schema({
  organization_code: { type: String, required: true, index: true },
  external_event_id: { type: String, required: true },
  credential_code: { type: String, required: true },
}, { timestamps: true });

lmsWebhookEventSchema.index({ organization_code: 1, external_event_id: 1 }, { unique: true });

module.exports = mongoose.model('LmsWebhookEvents', lmsWebhookEventSchema);
