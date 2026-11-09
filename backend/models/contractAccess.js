const mongoose = require('mongoose');
const crypto = require('crypto');

const contractAccessToken = new mongoose.Schema({
    contract_code: { type: String, required: true },
    access_token: { type: String, select: false },
    access_token_hash: { type: String, unique: true, sparse: true, select: false },
    token_prefix: { type: String },
    permissions: {
        view: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        update: { type: Boolean, default: false },
        add_discussion: { type: Boolean, default: false },
        add_timeline_event: { type: Boolean, default: false }
    },
    issued_at: { type: Date, default: Date.now },
    expires_at: { type: Date, required: true },
    issued_to_email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
        match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address']
    },
    status: { type: String, enum: ['active', 'revoked', 'expired'], default: 'active' }
}, { timestamps: true });

contractAccessToken.set('toJSON', {
    transform(_document, value) {
        delete value.access_token;
        delete value.access_token_hash;
        return value;
    },
});

contractAccessToken.pre('validate', function hashRawAccessToken(next) {
    if (this.access_token && !this.access_token_hash) {
        this.access_token_hash = crypto.createHash('sha256').update(this.access_token).digest('hex');
        this.token_prefix = this.access_token.slice(0, 8);
        this.access_token = undefined;
    }
    if (!this.access_token_hash) return next(new Error('Access token hash is required'));
    return next();
});
contractAccessToken.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
// E2E audit finding H-11: every contract action (addDiscussion,
// signContract, acceptInvitation, removeUser in digitalContractController.js)
// loops over a contract's parties calling findOne({contract_code,
// issued_to_email, status}) per party -- with no index on contract_code
// at all, this was a full collection scan on every single call.
contractAccessToken.index({ contract_code: 1, issued_to_email: 1, status: 1 });

module.exports = mongoose.model('ContractAccess', contractAccessToken);
