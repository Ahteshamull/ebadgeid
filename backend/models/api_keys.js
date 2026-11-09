const mongoose = require('mongoose');

const apiKeySchema = new mongoose.Schema({
    // New keys are stored only as a SHA-256 digest. api_key remains as a
    // hidden compatibility field so an existing deployment can migrate
    // legacy plaintext records lazily when each key is next used.
    api_key: { type: String, select: false },
    api_key_hash: { type: String, select: false, unique: true, sparse: true },
    key_prefix: { type: String },
    last_four: { type: String },
    valid_for: { type: Number, required: true }, // number represents time, e.g., 30 means 30 days
    organization_code: { type: String, required: true, index: true },
    status: { type: String, required: true, enum: ['Active', 'Expired', 'Revoked'] },
    requests_allowed_per_minute: { type: Number, required: true, default: 120 },
    last_used_at: { type: Date },
}, { timestamps: true });

apiKeySchema.set('toJSON', {
    transform(_document, value) {
        delete value.api_key;
        delete value.api_key_hash;
        return value;
    },
});

apiKeySchema.index({ organization_code: 1, status: 1 });
apiKeySchema.pre('validate', function requireKeyMaterial(next) {
    if (!this.api_key && !this.api_key_hash) {
        return next(new Error('API key hash is required'));
    }
    return next();
});

module.exports = mongoose.model('ApiKey', apiKeySchema);
