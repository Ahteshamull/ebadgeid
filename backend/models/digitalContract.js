// models/DigitalContract.js (FIXED - Removed unique constraint)
const mongoose = require('mongoose');

const digitalContract = new mongoose.Schema({
    contract_code: { type: String, required: true, unique: true }, // Only contract_code should be unique
    contract_title: { type: String, required: false, trim: true, maxlength: 200 },
    contract_issue_date: { type: String, required: true },
    contract_start_date: { type: String },
    contract_end_date: { type: String},
    contract_attachments: [String],
    contract_status: { type: String, required: true, enum: ['active', 'in_discussion', 'on_hold', 'terminated', 'disputed'] },
    contract_content_url: { type: String, required: true, maxlength: 2048 },
    contract_parties: [
        {
            party_name: { type: String, required: true, trim: true, maxlength: 200 },
            party_side: { type: String, required: true }, // e.g "buyer", "seller", "partner", 'any employee of organization'
            party_role: { type: String, required: true, trim: true, maxlength: 100},
            party_email: { type: String, required: true, lowercase: true, trim: true, match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address'] },
            contract_permissions: {
                view: { type: Boolean, default: false },
                write: { type: Boolean, default: false },
                update: { type: Boolean, default: false},
                add_discussion: { type: Boolean, default: false },
                add_timeline_event: { type: Boolean, default: false }
            },
            invited_at: { type: Date, default: Date.now },
            accepted: { type: Boolean, default: false },
            accepted_at: { type: Date }, // Added for tracking when invitation was accepted
            status: { type: String, enum: ['invited', 'accepted', 'declined'], default: 'invited' },
            signed: { type: Boolean, default: false },
            signed_at: { type: Date }
        }
    ],
    discussion: [
        {
            message_id: { type: String, required: true },
            sender_email: { type: String, required: true },
            message: { type: String, required: true, maxlength: 5000 },
            timestamp: { type: Date, default: Date.now},
            attachments: [String]
        }
    ],
    timeline: [
        {
            event_title: { type: String, required: true, maxlength: 200 },
            event_date: { type: Date, required: true },
            description: { type: String, maxlength: 2000 }
        }
    ],
    signed_copies: [
        {
            party_email: { type: String},
            signed_copy_url: { type: String, maxlength: 2048},
            signed_at: { type: Date},
            attachment_name: { type: String}
        }
    ],
    contract_security_hashes: { type: String, required: true },
    organization_code: { type: String, required: true, index: true },
    organization_detail: Object,
    creator_username: { type: String, required: true },
    creator_details: Object
});

// Add compound index to ensure uniqueness only within the same contract
// This allows same email in different contracts, but not duplicates in same contract
digitalContract.index(
    { contract_code: 1, 'contract_parties.party_email': 1 }, 
    { 
        unique: true,
        partialFilterExpression: { 'contract_parties.party_email': { $exists: true } }
    }
);

module.exports = mongoose.model('DigitalContract', digitalContract);
