const mongoose = require('mongoose');

const credentialSchema = new mongoose.Schema({
    // unique + indexed: this is looked up by code on every verification
    // page view, and used to be duplicable since it had no uniqueness
    // constraint at all.
    credential_code: { type: String, required: true, unique: true, index: true },
    credential_title: {type:String, required: false},
    credential_issue_date: {type:String, required: true},
    credential_expiry_date: {type:String, required: true},
    credential_pic_url: { type: String, required: true },
    // Kept the historical field name (frontend already reads/displays it),
    // but this is a content-integrity hash, not a blockchain record — see
    // AUDIT_FIXES.md. It's now reproducible: computed only from the
    // credential's own persisted fields, so anyone can recompute it later
    // and compare, which is what actually makes it useful as a tamper check.
    credential_blockchain_hashes: { type: String, required: true },
    achiever_username: { type: String, required: true, index: true },
    // Denormalized from organization_detail.code so credentials can be
    // scoped/indexed directly by organization without joining through Users.
    organization_code: { type: String, required: true, index: true },
    credential_status: {type:String, required: true, enum: ['Issued', 'Claimed', 'Expired', 'Revoked'], default: 'Issued'},
    // Explicit recipient consent for the public portal (GET /credentials/
    // portal/:username) -- separate from credential_status itself.
    // Defaults to true so a credential a recipient already Claimed today
    // keeps behaving exactly as it did before this field existed (visible
    // once claimed); the control this adds is the ability to opt OUT
    // afterward (see PUT /credentials/portal-visibility/:code), not a
    // silent new gate on every existing claimed credential.
    portal_visible: { type: Boolean, default: true },
    // Set once scripts/notifyExpiringCredentials.js sends the "this is
    // about to expire" notice, so a daily cron run doesn't re-notify the
    // same credential every day between the first warning and the actual
    // expiry date.
    expiry_notified_at: { type: Date, default: null },
    achiever_details: Object,
    organization_detail: Object,
    // Org-defined field values (course name, cohort, score, etc. -- see
    // models/designSchema.js's textAttributeSchema) actually burned into
    // this specific credential's image at issuance time, kept here purely
    // for display on the credential detail page. Undefined, not {}, when
    // the template had none -- matches how achiever_details/organization_detail
    // are also left as plain Objects with no required shape.
    custom_fields: Object,
    // Set only by bulk issuance: "<batchId>:<achiever_username>". BullMQ
    // retries a failed job up to three times, and a job can fail AFTER the
    // credential document was already written -- a process restart or a
    // deploy between the save and the job being acked is enough. Without
    // this, that retry issues a second credential to the same person for
    // the same batch: a duplicate certificate, a second email, and a
    // second charge against the monthly plan quota. The sparse unique
    // index below makes the second insert impossible rather than merely
    // unlikely, so the guard holds even against two workers racing.
    //
    // Sparse on purpose: every credential issued before this field existed,
    // and every single-issue credential, simply has no value here and is
    // untouched by the constraint.
    bulk_issuance_key: { type: String, default: undefined },
    // Which integrity-hash scheme credential_blockchain_hashes was produced
    // by. 1 = the current, reproducible content hash (see
    // computeIntegrityHash). 0 = issued before that existed, when this field
    // held a non-reproducible pseudo-random value that was never a hash of
    // anything -- those credentials are perfectly valid, but their content
    // integrity simply cannot be checked, and reporting them as "integrity
    // check FAILED" told every verifier that a genuine credential looked
    // tampered with.
    //
    // Absent is treated as 1: a credential issued under the current scheme
    // must still fail loudly if its hash does not match, which is the whole
    // point of having one.
    integrity_hash_version: { type: Number, default: 1 },
}, { timestamps: true });

// E2E audit finding H-11: overviewController.js and organization_dashboard.js
// both run a dozen-plus $regex('^YYYY-MM') counts against
// credential_issue_date, filtered/grouped by credential_status, on every
// single dashboard load -- with no index covering either field, every one
// of those was a full collection scan.
credentialSchema.index({ organization_code: 1, credential_status: 1, credential_issue_date: 1 });

// See bulk_issuance_key above. Unique + sparse: it constrains only the
// documents that actually carry a key.
credentialSchema.index({ bulk_issuance_key: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Credentials', credentialSchema);
