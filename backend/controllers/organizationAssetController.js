const OrganizationAsset = require('../models/organizationAsset');
const { isAllowedCredentialImage } = require('./credentialController');
const { belongsToOrganization } = require('../utils/managedStorage');

const ASSET_TYPES = ['font', 'image'];

// Registers an already-uploaded file (the client must have uploaded it via
// POST /api/uploads or /api/uploads/font first, and got a { url } back --
// same two-step "upload, then reference the URL" flow the design editor
// already uses for template backgrounds) as a reusable org asset.
const createAsset = async (req, res) => {
    try {
        const { asset_type, name, url, mime_type, original_filename } = req.body;
        if (!ASSET_TYPES.includes(asset_type)) {
            return res.status(400).json({ success: false, message: "asset_type must be 'font' or 'image'" });
        }
        if (!name || !url || !mime_type) {
            return res.status(400).json({ success: false, message: 'name, url, and mime_type are required' });
        }
        // Security fix, found during an audit round: unlike every other
        // point in this codebase that stores a client-supplied URL for a
        // file that's meant to have actually been uploaded through the
        // managed storage service (brandKitController's logo_url,
        // ticketController's attachments, digitalContractController's
        // signed copies), this accepted any URL at all with no origin
        // check. Same isAllowedCredentialImage check those already use --
        // despite the name, it's a generic "is this a real URL under our
        // own managed /uploads/ storage" check, not image-specific.
        if (!isAllowedCredentialImage(url)) {
            return res.status(400).json({ success: false, message: 'url must be a real, previously uploaded managed-storage file URL' });
        }
        if (!await belongsToOrganization(url, req.user.organization_code)) {
            return res.status(403).json({ success: false, message: 'The file does not belong to your organization' });
        }
        const asset = await OrganizationAsset.create({
            organization_code: req.user.organization_code,
            asset_type,
            name,
            url,
            mime_type,
            original_filename,
            uploaded_by: req.user.username,
        });
        res.status(201).json({ success: true, data: asset });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ success: false, message: 'An asset with this name already exists for your organization' });
        }
        res.status(500).json({ success: false, message: 'Failed to save asset', error: error.message });
    }
};

const listAssets = async (req, res) => {
    try {
        const filter = { organization_code: req.user.organization_code };
        // Only a plain string from the allowed enum is ever assigned into
        // the query filter -- req.query.asset_type could otherwise be an
        // object (Express's query parser supports ?asset_type[$ne]=x),
        // which would reach Mongo as a real query operator instead of a
        // literal value match.
        if (typeof req.query.asset_type === 'string' && ASSET_TYPES.includes(req.query.asset_type)) {
            filter.asset_type = req.query.asset_type;
        }
        const assets = await OrganizationAsset.find(filter).sort({ createdAt: -1 }).lean();
        res.status(200).json({ success: true, data: assets });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch assets', error: error.message });
    }
};

const deleteAsset = async (req, res) => {
    try {
        const asset = await OrganizationAsset.findById(req.params.id);
        if (!asset) return res.status(404).json({ success: false, message: 'Asset not found' });
        if (asset.organization_code !== req.user.organization_code) {
            return res.status(403).json({ success: false, message: "Not allowed to delete another organization's asset" });
        }
        await OrganizationAsset.deleteOne({ _id: asset._id });
        res.status(200).json({ success: true, message: 'Asset deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete asset', error: error.message });
    }
};

module.exports = { createAsset, listAssets, deleteAsset };
