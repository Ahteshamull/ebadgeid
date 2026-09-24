// models/pendingOrgSignup.js
//
// A self-service signup for a PAID plan is held here between "payment
// started at Tilopay" and an authenticated payment confirmation. A
// browser redirect can request onboarding but never creates the
// organization or admin account. A Free-plan signup (any plan with
// is_free:true -- see plan_schema.js) skips this table entirely and
// creates immediately.
const mongoose = require('mongoose');

const pendingOrgSignupSchema = new mongoose.Schema({
  // The unguessable orderNumber sent to Tilopay's processPayment -- see
  // services/tilopayClient.js's header comment on why this being
  // unguessable matters (Tilopay's redirect confirmation has no
  // documented signature to verify instead).
  payment_reference: { type: String, required: true, unique: true, index: true },
  organization: { type: Object, required: true },
  plan_name: { type: String, required: true },
  expected_amount_cents: { type: Number, required: true, min: 1 },
  expected_currency: { type: String, required: true, uppercase: true, trim: true },
  admin: { type: Object, required: true, select: false }, // includes the pre-hashed password; never selected by default
  // 'failed' = Tilopay reported the payment as declined/cancelled
  // (code !== "1" on the return redirect) -- distinct from 'expired',
  // which is reserved for a pending record nobody ever completed at all.
  // `awaiting_verification` is deliberately distinct from a browser
  // redirect. A redirect is controlled by the browser and is never proof
  // that funds were captured. Only a future authenticated provider
  // confirmation (or a platform_admin's manual review, see
  // manual_verification below) may move a record to `completed`.
  status: { type: String, required: true, enum: ['pending', 'awaiting_verification', 'provisioning', 'completed', 'expired', 'failed'], default: 'pending' },
  organization_code: { type: String, index: true }, // set once completed
  onboarding_notified_at: { type: Date },
  customer_onboarding_notified_at: { type: Date },
  manual_verification: {
    verified_by: { type: String },
    verified_at: { type: Date },
    evidence_reference: { type: String, maxlength: 200 },
    verified_amount_cents: { type: Number },
    verified_currency: { type: String },
    note: { type: String, maxlength: 1000 },
  },
  // Real recovery/rollback fix: every failed provisioning attempt during
  // approveSignup is appended here (not just logged) before the record is
  // reverted to 'awaiting_verification', so a reviewer opening this same
  // pending signup again can see exactly why a previous approval attempt
  // failed instead of retrying blind.
  approval_attempts: [{
    attempted_at: { type: Date, required: true },
    attempted_by: { type: String },
    error: { type: String, maxlength: 1000 },
  }],
}, { timestamps: true });

module.exports = mongoose.model('PendingOrgSignup', pendingOrgSignupSchema);
