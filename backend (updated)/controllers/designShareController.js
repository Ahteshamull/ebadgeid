// controllers/designShareController.js
//
// Cross-organization template sharing: distinct from the "Share on
// LinkedIn" public preview (see designController.getPublicDesignPreview) --
// this reuses a design between two organizations *within* this system.
// A share record only grants visibility; the receiving org still has to
// explicitly import it (see importSharedDesign) to get its own independent,
// editable copy. Nothing here creates a live link back to the source --
// once imported, the copy is a completely normal design the receiving org
// owns and edits on its own, same as anything they built themselves.
const Design = require('../models/designSchema');
const DesignShare = require('../models/designShare');
const Organization = require('../models/organization_schema');
const { generateUniqueDesignCode, snapshotVersion } = require('./designController');

// Share one of the caller's own templates with another organization.
// Idempotent by construction (the schema's compound unique index below) --
// sharing the same design with the same org twice just returns the
// existing share, it never duplicates the row.
const shareDesign = async (req, res) => {
    try {
        const { design_code, target_organization_code } = req.body;
        if (!design_code || !target_organization_code) {
            return res.status(400).json({ success: false, message: 'design_code and target_organization_code are required' });
        }
        if (target_organization_code === req.user.organization_code) {
            return res.status(400).json({ success: false, message: 'Cannot share a template with your own organization' });
        }
        const [design, targetOrg] = await Promise.all([
            Design.findOne({ design_code }),
            Organization.findOne({ organization_code: target_organization_code }).lean(),
        ]);
        if (!design) return res.status(404).json({ success: false, message: 'Design not found' });
        if (design.organization_code !== req.user.organization_code) {
            return res.status(403).json({ success: false, message: "Not allowed to share another organization's template" });
        }
        if (!targetOrg) return res.status(404).json({ success: false, message: 'Target organization not found' });

        const share = await DesignShare.findOneAndUpdate(
            { design_code, target_organization_code },
            {
                design_code,
                source_organization_code: req.user.organization_code,
                target_organization_code,
                shared_by: req.user.username,
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        );
        res.status(201).json({ success: true, message: `Shared with ${targetOrg.name}`, data: share });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to share design', error: error.message });
    }
};

// What other organizations have shared with the caller's own org, joined
// with just enough of the source design's fields to preview it (name,
// thumbnail, status) before importing -- not the full editable content.
const listSharedWithMe = async (req, res) => {
    try {
        const shares = await DesignShare.find({ target_organization_code: req.user.organization_code }).sort({ createdAt: -1 }).lean();
        const designCodes = shares.map(share => share.design_code);
        const orgCodes = [...new Set(shares.map(share => share.source_organization_code))];
        const [designs, orgs] = await Promise.all([
            Design.find({ design_code: { $in: designCodes } })
                .select('design_code credential_title main_template_url template_url organization_code status')
                .lean(),
            Organization.find({ organization_code: { $in: orgCodes } }).select('organization_code name').lean(),
        ]);
        const designByCode = new Map(designs.map(design => [design.design_code, design]));
        const orgNameByCode = new Map(orgs.map(org => [org.organization_code, org.name]));

        const data = shares.map(share => ({
            share_id: share._id,
            design_code: share.design_code,
            shared_at: share.createdAt,
            source_organization_code: share.source_organization_code,
            source_organization_name: orgNameByCode.get(share.source_organization_code) || share.source_organization_code,
            // A design can be deleted (or its share revoked separately)
            // after being shared -- this can legitimately be null; the
            // frontend shows "no longer available" rather than erroring.
            design: designByCode.get(share.design_code) || null,
        }));
        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch shared templates', error: error.message });
    }
};

// What the caller's own org has shared out, and to whom -- lets an admin
// see (and revoke) their own outgoing shares.
const listSharedByMe = async (req, res) => {
    try {
        const shares = await DesignShare.find({ source_organization_code: req.user.organization_code }).sort({ createdAt: -1 }).lean();
        res.status(200).json({ success: true, data: shares });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch outgoing shares', error: error.message });
    }
};

// Only the organization that created the share can revoke it -- the
// receiving org can simply decline to import it, but the decision to stop
// sharing in the first place belongs to the source org.
const revokeShare = async (req, res) => {
    try {
        const share = await DesignShare.findById(req.params.share_id);
        if (!share) return res.status(404).json({ success: false, message: 'Share not found' });
        if (share.source_organization_code !== req.user.organization_code) {
            return res.status(403).json({ success: false, message: "Not allowed to revoke another organization's share" });
        }
        await DesignShare.deleteOne({ _id: share._id });
        res.status(200).json({ success: true, message: 'Share revoked' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to revoke share', error: error.message });
    }
};

// Turns a share into the receiving org's own independent, editable copy --
// same "always starts as a draft, regardless of the source's status" rule
// as designController.duplicateDesign, and for the same reason: a template
// shared while published must never become immediately issuable in the new
// org without that org's own review.
const importSharedDesign = async (req, res) => {
    try {
        const share = await DesignShare.findById(req.params.share_id);
        if (!share) return res.status(404).json({ success: false, message: 'Share not found' });
        if (share.target_organization_code !== req.user.organization_code) {
            return res.status(403).json({ success: false, message: 'This template was not shared with your organization' });
        }
        const source = await Design.findOne({ design_code: share.design_code });
        if (!source) return res.status(404).json({ success: false, message: 'The shared template no longer exists' });

        const payload = source.toObject();
        delete payload._id;
        delete payload.__v;
        delete payload.createdAt;
        delete payload.updatedAt;
        payload.design_code = await generateUniqueDesignCode();
        payload.organization_code = req.user.organization_code;
        payload.credential_title = `${source.credential_title || source.design_code} (shared)`;
        payload.status = 'draft';
        payload.current_version = 1;
        payload.submitted_by = null;
        payload.submitted_at = null;
        payload.reviewed_by = null;
        payload.reviewed_at = null;
        payload.rejection_reason = null;

        const imported = new Design(payload);
        const saved = await imported.save();
        await snapshotVersion(saved, req.user.username);
        res.status(201).json({ success: true, message: 'Template imported into your organization', data: saved });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to import shared design', error: error.message });
    }
};

module.exports = { shareDesign, listSharedWithMe, listSharedByMe, revokeShare, importSharedDesign };
