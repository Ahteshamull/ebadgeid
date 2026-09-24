// controllers/brandKitController.js
//
// One brand kit per organization -- see models/organizationBrandKit.js.
// GET always returns something usable (the schema's own defaults) even
// before an org has ever saved one, so the design editor doesn't need a
// separate "no brand kit yet" state.
const OrganizationBrandKit = require('../models/organizationBrandKit');
const { isAllowedCredentialImage } = require('./credentialController');
const { belongsToOrganization } = require('../utils/managedStorage');

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

const getBrandKit = async (req, res) => {
    try {
        const brandKit = await OrganizationBrandKit.findOne({ organization_code: req.user.organization_code }).lean();
        if (brandKit) return res.status(200).json({ success: true, data: brandKit });
        // No kit saved yet -- the schema's own defaults, not persisted
        // until the org actually saves one via PUT below.
        res.status(200).json({
            success: true,
            data: { organization_code: req.user.organization_code, primary_color: '#4f46e5', secondary_color: '#1f2937', logo_url: '' },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch brand kit', error: error.message });
    }
};

const updateBrandKit = async (req, res) => {
    try {
        const { primary_color, secondary_color, logo_url } = req.body;
        if (primary_color !== undefined && !HEX_COLOR_PATTERN.test(primary_color)) {
            return res.status(400).json({ success: false, message: 'primary_color must be a 6-digit hex color, e.g. #4f46e5' });
        }
        if (secondary_color !== undefined && !HEX_COLOR_PATTERN.test(secondary_color)) {
            return res.status(400).json({ success: false, message: 'secondary_color must be a 6-digit hex color, e.g. #1f2937' });
        }
        if (logo_url && !isAllowedCredentialImage(logo_url)) {
            return res.status(400).json({ success: false, message: 'logo_url must be a real, previously uploaded managed-storage image URL' });
        }
        if (logo_url && !await belongsToOrganization(logo_url, req.user.organization_code)) {
            return res.status(403).json({ success: false, message: 'logo_url does not belong to your organization' });
        }
        const update = {};
        if (primary_color !== undefined) update.primary_color = primary_color;
        if (secondary_color !== undefined) update.secondary_color = secondary_color;
        if (logo_url !== undefined) update.logo_url = logo_url;

        const brandKit = await OrganizationBrandKit.findOneAndUpdate(
            { organization_code: req.user.organization_code },
            { organization_code: req.user.organization_code, ...update },
            { upsert: true, new: true }
        );
        res.status(200).json({ success: true, message: 'Brand kit updated', data: brandKit });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update brand kit', error: error.message });
    }
};

module.exports = { getBrandKit, updateBrandKit };
