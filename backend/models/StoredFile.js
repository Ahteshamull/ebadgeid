const mongoose = require('mongoose');

// Metadata is the authorization boundary for files. The byte may live on a
// shared Docker volume, but a tenant never gains access merely by knowing a
// random filename: every new upload has an owning organization here.
const storedFileSchema = new mongoose.Schema({
  storage_key: { type: String, required: true, unique: true, trim: true },
  organization_code: { type: String, required: true, index: true, trim: true },
  original_filename: { type: String, trim: true, maxlength: 255 },
  mime_type: { type: String, required: true, maxlength: 100 },
  size_bytes: { type: Number, required: true, min: 0 },
  sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  purpose: { type: String, enum: ['upload', 'profile', 'font', 'ai_generated', 'pdf_source'], default: 'upload' },
  visibility: { type: String, enum: ['private', 'public'], default: 'private' },
  uploaded_by: { type: String, maxlength: 160 },
  deleted_at: { type: Date, default: null },
}, { timestamps: true, collection: 'stored_files' });

storedFileSchema.index({ organization_code: 1, createdAt: -1 }, { name: 'org_stored_files_recent' });
storedFileSchema.index({ organization_code: 1, purpose: 1, createdAt: -1 }, { name: 'org_stored_files_purpose_recent' });

module.exports = mongoose.model('StoredFile', storedFileSchema);
