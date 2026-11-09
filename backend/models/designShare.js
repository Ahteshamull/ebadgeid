// models/designShare.js
//
// A share record just grants the target organization visibility into one
// of the source organization's templates -- it does not copy anything by
// itself. The receiving org still has to explicitly import it (see
// controllers/designShareController.js's importSharedDesign) to get a real,
// independent, editable design of their own. Distinct from the public
// "Share on LinkedIn" preview (designController.getPublicDesignPreview),
// which is a read-only public page, not a reusable template handoff between
// organizations inside this system.
const mongoose = require('mongoose');

const designShareSchema = new mongoose.Schema({
  design_code: { type: String, required: true, index: true },
  source_organization_code: { type: String, required: true, index: true },
  target_organization_code: { type: String, required: true, index: true },
  shared_by: { type: String, required: true },
}, { timestamps: true });

// Sharing the same design with the same org twice is a no-op, not a second
// row -- shareDesign relies on this via findOneAndUpdate's upsert.
designShareSchema.index({ design_code: 1, target_organization_code: 1 }, { unique: true });

module.exports = mongoose.model('DesignShare', designShareSchema);
