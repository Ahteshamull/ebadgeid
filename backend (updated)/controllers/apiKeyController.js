const ApiKey = require('../models/api_keys');
const crypto = require('crypto');
const { hashApiKey } = require('../middleware/requireApiKey');
// Generate 256-bit (32-byte) secure token
const generateSecureApiKey = () => {
    return crypto.randomBytes(32).toString('hex'); // 256 bits in hex
};

exports.createApiKey = async (req, res) => {
    try {
        const organization_code = req.user.organization_code;

        if (!organization_code) {
            return res.status(400).json({ error: 'Organization code is required' });
        }

        const plainTextKey = generateSecureApiKey();
        const apiKeyData = {
            api_key_hash: hashApiKey(plainTextKey),
            key_prefix: plainTextKey.slice(0, 8),
            last_four: plainTextKey.slice(-4),
            valid_for: 90, // 90 days
            organization_code,
            status: 'Active',
            requests_allowed_per_minute: 120,
        };

        const apiKey = new ApiKey(apiKeyData);
        const savedKey = await apiKey.save();
        const response = savedKey.toObject();
        delete response.api_key_hash;
        delete response.api_key;
        res.status(201).json({ ...response, api_key: plainTextKey });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Get all tokens for a specific organization
exports.getOrganizationTokens = async (req, res) => {
    try {
        const tokens = await ApiKey.find({ organization_code: req.user.organization_code });
        res.status(200).json(tokens);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Revoke a token by ID
exports.revokeToken = async (req, res) => {
    try {
        const tokenId = req.params.token_id;

        const updated = await ApiKey.findOneAndUpdate(
            { _id: tokenId, organization_code: req.user.organization_code },
            { status: 'Revoked' },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ message: 'Token not found' });
        }

        res.status(200).json({ message: 'Token revoked successfully', token: updated });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Get All API Keys
exports.getAllApiKeys = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 200, 500);
        const skip = parseInt(req.query.skip) || 0;
        const keys = await ApiKey.find({ organization_code: req.user.organization_code }).skip(skip).limit(limit).lean();
        res.status(200).json(keys);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Get API Key by ID
exports.getApiKeyById = async (req, res) => {
    try {
        const key = await ApiKey.findOne({ _id: req.params.id, organization_code: req.user.organization_code });
        if (!key) return res.status(404).json({ message: 'API Key not found' });
        res.status(200).json(key);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Update API Key
exports.updateApiKey = async (req, res) => {
    try {
        const allowed = {};
        for (const field of ['status', 'valid_for', 'requests_allowed_per_minute']) {
          if (req.body[field] !== undefined) allowed[field] = req.body[field];
        }
        const updatedKey = await ApiKey.findOneAndUpdate(
            { _id: req.params.id, organization_code: req.user.organization_code },
            allowed,
            { new: true, runValidators: true }
        );
        if (!updatedKey) return res.status(404).json({ message: 'API Key not found' });
        res.status(200).json(updatedKey);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Delete API Key
exports.deleteApiKey = async (req, res) => {
    try {
        const deletedKey = await ApiKey.findOneAndDelete({
          _id: req.params.id,
          organization_code: req.user.organization_code,
        });
        if (!deletedKey) return res.status(404).json({ message: 'API Key not found' });
        res.status(200).json({ message: 'API Key deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
