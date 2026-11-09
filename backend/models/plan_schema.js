const mongoose = require('mongoose');

// Plan limits, stored in the database rather than hardcoded as constants
// scattered through the enforcement middleware — an admin can adjust a
// tier's limits later (via the API or directly) without a code deploy.
// `price_cents` is deliberately left null: what to charge is a business
// decision, not something this code should decide — the mechanics of
// *enforcing* a limit are separate from *pricing* it. See AUDIT_FIXES.md.
//
// `is_free` is the ONLY thing selfServiceSignup.js's startSignup() trusts
// to decide whether a plan provisions immediately without payment. It
// used to infer that from `!price_cents` -- which meant any paid tier
// that simply hadn't had a real price set yet (the normal state right
// after a fresh deploy, before the business decides pricing) was
// indistinguishable from an intentionally-free plan, and provisioned for
// free. Confirmed exploitable live: a fresh deploy's Enterprise plan
// (unlimited users/credentials/API calls) could be self-signed-up for
// free by anyone, no payment, no platform_admin approval. `is_free` is
// set explicitly per plan below and never inferred from pricing being
// unset -- see the matching guard in startSignup() for the other half of
// this fix (a non-free plan with no price configured is refused, not
// silently treated as free).
const planSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, enum: ['Free', 'Basic', 'Premium', 'Enterprise'] },
  max_users: { type: Number, required: true },          // -1 = unlimited
  max_credentials_per_month: { type: Number, required: true }, // -1 = unlimited
  max_api_calls_per_month: { type: Number, required: true },   // -1 = unlimited
  price_cents: { type: Number, default: null },          // left for business decision, not enforced here
  is_free: { type: Boolean, required: true, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Plan', planSchema);

// Sane starter limits — seeded automatically on server boot (see
// config/db.js) if the Plan collection is empty, so there's no manual
// setup step. These are placeholders for the actual numbers the business
// decides on, not a pricing recommendation. Only "Free" is is_free:true --
// deliberately explicit per plan, not derived from price_cents (see the
// schema comment above for why that distinction is the whole point of
// this fix).
module.exports.DEFAULT_PLANS = [
  { name: 'Free',       max_users: 5,   max_credentials_per_month: 25,   max_api_calls_per_month: 500,   is_free: true },
  { name: 'Basic',      max_users: 25,  max_credentials_per_month: 250,  max_api_calls_per_month: 5000,  is_free: false },
  { name: 'Premium',    max_users: 150, max_credentials_per_month: 2500, max_api_calls_per_month: 50000, is_free: false },
  { name: 'Enterprise', max_users: -1,  max_credentials_per_month: -1,   max_api_calls_per_month: -1,    is_free: false },
];
