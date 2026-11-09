const mongoose = require('mongoose');

const fontAttributesSchema = new mongoose.Schema({
    font_family: { type: String, required: true },
    font_size: { type: Number, required: true },  // Changed to Number based on example
    font_color: { type: String, required: true },
    font_weight: { type: String, required: true },
    // Both optional with defaults matching the certificate service's own
    // defaults (utils/main.py, FontAttributes) — designs saved before these
    // existed just don't have the key at all, which reads back as the
    // default in both the editor and the renderer, not as a validation gap.
    letter_spacing: { type: Number, required: false, default: 0 },
    line_height: { type: Number, required: false, default: 1.2 }
}, { _id: false });

const positionSchema = new mongoose.Schema({
    X: { type: Number, required: true },
    Y: { type: Number, required: true }
}, { _id: false });

const textAttributeSchema = new mongoose.Schema({
    text_title: { type: String, required: true },
    text: { type: String, required: true },
    font_attributes: [fontAttributesSchema],
    positions: positionSchema
}, { _id: false });

const qrCodeSchema = new mongoose.Schema({
    ecoding_data: { type: String, required: true },
    X: { type: Number, required: true },
    Y: { type: Number, required: true }
}, { _id: false });

// Simple vector primitives on top of the text + QR the editor already
// supported -- a rectangle/line/circle, no path/bezier editing, matching
// how far utils/main.py's renderer actually draws (see draw_shape there).
const shapeSchema = new mongoose.Schema({
    shape_type: { type: String, required: true, enum: ['rectangle', 'line', 'circle'] },
    X: { type: Number, required: true },
    Y: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    stroke_color: { type: String, default: '#000000' },
    fill_color: { type: String, default: '' }, // '' = no fill, stroke only
    stroke_width: { type: Number, default: 2 },
    rotation: { type: Number, default: 0 }, // degrees
}, { _id: false });

// A placed image element (an icon/sticker/decorative image from the asset
// library, or an AI-generated one) -- same X/Y/rotation shape as
// shapeSchema above, plus a url (must resolve through the same trusted-
// host allowlist as template_url/font_url when rendered, see
// utils/main.py's ImageElementAttribute) and an opacity for layering.
const imageElementSchema = new mongoose.Schema({
    url: { type: String, required: true },
    X: { type: Number, required: true },
    Y: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    rotation: { type: Number, default: 0 },
    opacity: { type: Number, default: 1 },
}, { _id: false });

const designSchema = new mongoose.Schema({
 main_template_url: { type: String, required: true },
organization_code: { type: String, required: true, index: true },
    design_code: {type:String, required: true, unique: true, index: true},
    template_url: { type: String, required: true },
    // The design editor (frontend/.../design-editor/page.js) has sent this
    // on every create/update since it was built, and the template list
    // there reads it back to show a friendly name instead of the raw
    // design_code — but it was never declared here, so Mongoose's default
    // strict mode silently dropped it on every save. Every saved template's
    // name was quietly discarded; the list always fell back to showing the
    // design_code. Declaring it now starts persisting it going forward —
    // it does not backfill the name for templates already saved without it.
    credential_title: { type: String, trim: true, maxlength: 200 },
    // Certificate or badge. This product designs and issues both, and the
    // two are different things to the people using them -- a badge is a
    // small square mark, a certificate is a full landscape document -- but
    // nothing recorded WHICH a design was, so every design was implicitly
    // treated as a certificate.
    //
    // Defaults to 'certificate' precisely so that every design saved before
    // this field existed keeps behaving exactly as it always has; nothing is
    // reclassified, and no already-issued credential changes.
    design_kind: { type: String, enum: ['certificate', 'badge'], default: 'certificate', index: true },
    text_attributes: [textAttributeSchema],
    shapes: [shapeSchema],
    images: [imageElementSchema],
    QR_CODE: qrCodeSchema,
    // Incremented on every real save -- see models/designVersion.js, which
    // stores the actual snapshot history this number indexes into.
    current_version: { type: Number, default: 1 },
    // 'draft' vs 'published' vs 'archived' -- an incomplete template
    // shouldn't be available for actually issuing credentials, and neither
    // should a retired one an org wants out of their active list without
    // deleting it outright. The default here is 'published' on purpose:
    // it's what Mongoose backfills for every template that existed before
    // this field did (hydrating a document with no stored status applies
    // the schema default), so nothing already in use suddenly becomes
    // unissuable. createDesign explicitly overrides this to 'draft' for
    // brand-new templates going forward -- see controllers/designController.js.
    // The issuance gate in certificateController.js already rejects
    // anything that isn't exactly 'published', so 'archived' is blocked
    // there with zero additional code, same as 'draft' always was.
    // 'pending_review' sits between 'draft' and 'published' -- an admin who
    // finished a template but wants a second admin to sign off before it
    // becomes issuable submits it here instead of publishing it directly
    // (see submitForReview/approveDesign/rejectDesign in
    // controllers/designController.js). The direct draft -> published path
    // via publishDesign still works unchanged for orgs that don't use
    // review -- this is an additional path, not a replacement for it.
    status: { type: String, enum: ['draft', 'pending_review', 'published', 'archived'], default: 'published' },
    // Who submitted the currently-pending (or most recently reviewed)
    // review, and when -- also doubles as the "you can't approve your own
    // submission" check in approveDesign.
    submitted_by: { type: String, default: null },
    submitted_at: { type: Date, default: null },
    reviewed_by: { type: String, default: null },
    reviewed_at: { type: Date, default: null },
    // Only meaningful right after a rejection -- cleared on the next submit,
    // so an old reason never lingers on screen after a fresh resubmission.
    rejection_reason: { type: String, default: null, maxlength: 1000 },
}, { timestamps: true });

module.exports = mongoose.model('Designs', designSchema);
