const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema({
  organization_code: {type:String, required: true, unique: true, index: true},
  name: {type:String, required: true},
  city: {type:String, required: true},
  state: {type:String, required: true},
  country: {type:String, required: true},
  email: {type:String, required: true, lowercase: true, trim: true, match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address']},
  phone: {type:String, required: true},
  // SA-03 fix: SUSPENDED added so a platform_admin can genuinely disable
  // an organization without deleting it (Super Admin's Enable/Disable
  // action) -- purely additive, every existing document's ACTIVE/TRIAL/
  // DELETED value and every existing status === 'X' check elsewhere in
  // the codebase is unaffected.
  status: {type:String, required: true, enum: ['ACTIVE', 'TRIAL', 'SUSPENDED', 'DELETED']},
  // Soft-delete marker (E2E audit H-22). Deleting an organization used to
  // be a hard Mongo delete with no cascade -- every credential, user,
  // design, contract etc. under it became silently orphaned, and the
  // delete itself was unrecoverable. Set alongside status: 'DELETED' by
  // organizationController.deleteOrganization; a real permanent purge
  // (removing the org and its orphaned data for good, after a retention
  // window) is intentionally a separate, later decision -- not built here.
  deleted_at: { type: Date, required: false },
  plan: {type:String, required: true, enum: ['Free', 'Basic', 'Premium', 'Enterprise'], default: 'Free'},
  users: {type:Number, required: false},
  // HIGH-02 fix (audit finding, confirmed real): the seat/user limit was
  // enforced by counting Users documents, then separately inserting a new
  // one -- not a reservation. Two concurrent invitation acceptances could
  // both read the same under-the-limit count before either commit, since
  // they insert different new documents with no natural write conflict
  // between them, and both would pass. seat_count IS the atomic
  // reservation: middleware/enforcePlanLimits.js's wouldExceedUserLimit
  // increments it via `findOneAndUpdate({ seat_count: { $lt: max_users } },
  // { $inc: { seat_count: 1 } })` -- MongoDB only ever lets one of two
  // concurrent callers racing for the same document win that update, which
  // is what actually closes the race a separate count-then-insert cannot.
  // Backfilled for every pre-existing organization by migration
  // 20260827_backfill_organization_seat_count (from the real Users
  // count at migration time, so this never starts out already wrong).
  seat_count: { type: Number, default: 0 },
  // Bulk issuance quota RESERVATION, same idea as seat_count above and for
  // the same reason. Checking "does this batch fit in the remaining monthly
  // allowance" and then enqueueing it is two steps: two admins submitting
  // 15 each against 15 remaining would both read 15, both pass, and 30 would
  // be issued on a 25-a-month plan. This counter is what makes the check
  // itself the reservation -- the conditional $inc in
  // middleware/enforcePlanLimits.js can only be won by one of two racing
  // requests, because MongoDB serializes updates to a single document.
  //
  // Counts credentials RESERVED but not yet written. The worker decrements
  // it as each credential is actually created (at which point the credential
  // is counted by the issued-this-month query instead), so the two never
  // double-count the same credential.
  bulk_reserved_period: { type: String, default: null },  // "YYYY-MM"
  bulk_reserved_count: { type: Number, default: 0 },
  logo: {type:String, required: false},
  signature: {type:String, required: false},
  // When true, POST /api/credentials/bulk-issue no longer issues
  // immediately -- it creates a BulkIssuanceApproval record instead, and
  // an admin has to explicitly approve it (see routes/credential_routes.js
  // and models/bulkIssuanceApproval.js) before the real batch is
  // enqueued. Defaults to false so an organization that never opts in
  // keeps the exact bulk-issue behavior it already has.
  require_bulk_approval: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Organization', organizationSchema);
