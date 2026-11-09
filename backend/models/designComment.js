const mongoose = require('mongoose');

// A comment left on a template by an admin editing it -- optionally
// anchored to a canvas position (so it can be shown as a pin over a
// specific element), otherwise a general note about the template.
const designCommentSchema = new mongoose.Schema({
    design_code: { type: String, required: true, index: true },
    organization_code: { type: String, required: true, index: true },
    author_username: { type: String, required: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    position: {
        X: { type: Number },
        Y: { type: Number },
    },
    resolved: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('DesignComment', designCommentSchema);
