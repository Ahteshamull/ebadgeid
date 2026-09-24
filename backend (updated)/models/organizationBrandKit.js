// models/organizationBrandKit.js
//
// One brand identity per organization -- primary/secondary color and a
// logo -- so a new template doesn't have to start from generic defaults
// every time. Purely a starting point the design editor reads from (see
// controllers/brandKitController.js); it never mutates a design that's
// already been created, and nothing here is enforced on save.
const mongoose = require('mongoose');

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

const organizationBrandKitSchema = new mongoose.Schema({
  organization_code: { type: String, required: true, unique: true, index: true },
  primary_color: { type: String, default: '#4f46e5', match: HEX_COLOR_PATTERN },
  secondary_color: { type: String, default: '#1f2937', match: HEX_COLOR_PATTERN },
  // Empty string, not undefined, when no logo has been set -- matches how
  // every other optional-URL field in this codebase (e.g. imageElementSchema)
  // is checked with a simple truthiness test on the frontend, not
  // separately handling null vs undefined vs ''.
  logo_url: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('OrganizationBrandKit', organizationBrandKitSchema);
