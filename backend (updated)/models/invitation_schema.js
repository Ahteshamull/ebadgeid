// models/Invitation.js
const mongoose = require('mongoose');

const invitationSchema = new mongoose.Schema({
    invitation_code: { type: String, required: true, unique: true },
    email_hash: { type: String, index: true },
    organization_code: { type: String, index: true },
    designation: { type: String, maxlength: 200 },
    status: { type: String, required: true, enum: ['Active', 'Expired'], default: 'Active' },
    created_at: { type: Date, default: Date.now },
    expires_at: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) } // 24 hours from creation
});

invitationSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
invitationSchema.index({ organization_code: 1, email_hash: 1, status: 1 });

module.exports = mongoose.model('Invitation', invitationSchema);
