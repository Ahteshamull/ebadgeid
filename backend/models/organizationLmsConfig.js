// models/organizationLmsConfig.js
//
// Per-organization config for the OUTBOUND half of LMS integration --
// routes/lmsWebhookRoutes.js already covers the LMS calling US (push);
// this is US calling the LMS (pull), a scheduled reconciliation on top of
// the webhook so a completion never gets lost just because a single
// webhook delivery attempt from the LMS never arrived. sync_api_token is
// stored encrypted at rest (utils/cryptoHelper.js, the same AES-256-GCM
// helper invitation tokens already use) -- unlike an API key WE hand out
// (hashed, never needs to be reversed), this is a token THEY handed US,
// and we need the real value back to send as Bearer auth on every sync.
const mongoose = require('mongoose');

const organizationLmsConfigSchema = new mongoose.Schema({
  organization_code: { type: String, required: true, unique: true, index: true },
  sync_api_url: { type: String, required: true },
  sync_api_token_encrypted: { type: String, required: true, select: false },
  enabled: { type: Boolean, default: true },
  last_synced_at: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('OrganizationLmsConfig', organizationLmsConfigSchema);
