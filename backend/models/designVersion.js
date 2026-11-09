// models/designVersion.js
//
// Template versioning -- before this, saving a design overwrote it in
// place with no way back. Every real save (create or update) now also
// writes an immutable snapshot here, numbered per design_code, so an
// admin can see what a template looked like before and revert to it.
const mongoose = require('mongoose');

const designVersionSchema = new mongoose.Schema({
  design_code: { type: String, required: true, index: true },
  organization_code: { type: String, required: true, index: true },
  version_number: { type: Number, required: true },
  // The full design document at the moment this version was saved --
  // everything needed to fully restore it, not a diff.
  snapshot: { type: Object, required: true },
  created_by: { type: String, required: true },
}, { timestamps: true });

designVersionSchema.index({ design_code: 1, version_number: 1 }, { unique: true });

module.exports = mongoose.model('DesignVersion', designVersionSchema);
