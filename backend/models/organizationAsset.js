const mongoose = require('mongoose');

// One shared model for both "custom fonts" and "the asset library" (icons,
// stickers, prediseñados backgrounds) -- structurally identical: an org
// uploads a file once via /api/uploads or /api/uploads/font (real
// content-sniffing already happens there, see uploadController.js) and
// this just tracks it for reuse across designs. asset_type is the only
// thing that differs in how the editor and the certificate renderer treat
// the row afterwards.
const organizationAssetSchema = new mongoose.Schema({
    organization_code: { type: String, required: true, index: true },
    asset_type: { type: String, required: true, enum: ['font', 'image'] },
    // Display name shown in the editor's font picker / asset library grid.
    // For fonts this is also the exact string designs store as
    // font_attributes.font_family, so it must be unique per org+type to
    // stay unambiguous.
    name: { type: String, required: true, trim: true, maxlength: 100 },
    url: { type: String, required: true },
    mime_type: { type: String, required: true },
    original_filename: { type: String, trim: true, maxlength: 255 },
    uploaded_by: { type: String, required: true },
}, { timestamps: true });

organizationAssetSchema.index({ organization_code: 1, asset_type: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('OrganizationAsset', organizationAssetSchema);
