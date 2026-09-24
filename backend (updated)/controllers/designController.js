const crypto = require('crypto');
const Design = require('../models/designSchema');
const DesignVersion = require('../models/designVersion');
const DesignComment = require('../models/designComment');
const AuditLog = require('../models/auditLog');
const presence = require('../utils/presence');
const { materializeGalleryTemplate } = require('../utils/galleryTemplates');

// Shared by every comment/presence handler below -- confirms the design
// exists and belongs to the caller's own organization before touching
// anything scoped underneath it, same check createDesign/updateDesign/etc
// already apply directly.
async function findOwnOrgDesign(req, res) {
    const design = await Design.findOne({ design_code: req.params.design_code });
    if (!design) {
        res.status(404).json({ success: false, message: 'Design not found' });
        return null;
    }
    if (design.organization_code !== req.user.organization_code) {
        res.status(403).json({ success: false, message: "Not allowed to access another organization's template" });
        return null;
    }
    return design;
}

// Snapshots the design's current, post-save state as a new version --
// called after every real save (create or update), never before, so the
// version stored is exactly what a revert would restore.
async function snapshotVersion(design, createdBy) {
  await DesignVersion.create({
    design_code: design.design_code,
    organization_code: design.organization_code,
    version_number: design.current_version,
    snapshot: design.toObject(),
    created_by: createdBy,
  });
}

// Generates a unique design_code server-side. createDesign used to require
// the client to supply one with no generation/uniqueness logic anywhere —
// same landmine that credential_code had (see AUDIT_FIXES.md) before it
// was fixed the same way.
const generateUniqueDesignCode = async () => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `TPL-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await Design.exists({ design_code: candidate });
    if (!exists) return candidate;
  }
  throw new Error('Could not generate a unique design code');
};

// Create a new design
const createDesign = async (req, res) => {
    try {
        const payload = { ...req.body };
        if (!payload.design_code) {
            payload.design_code = await generateUniqueDesignCode();
        } else {
            const exists = await Design.exists({ design_code: payload.design_code });
            if (exists) {
                return res.status(409).json({ success: false, message: 'design_code already in use' });
            }
        }
        // A template belongs to whichever organization the caller belongs
        // to — never trust a client-supplied organization_code here, or an
        // admin from one org could plant a template inside another's list.
        payload.organization_code = req.user.organization_code;
        // Every new template starts as a draft, regardless of what the
        // client sends -- it only becomes eligible for issuing credentials
        // once an admin explicitly publishes it (see publishDesign below).
        // The schema's own default ('published') only exists to keep
        // templates that were saved before this field existed working
        // exactly as before; a brand-new save always goes through here.
        payload.status = 'draft';

        const design = new Design(payload);
        const savedDesign = await design.save();
        await snapshotVersion(savedDesign, req.user.username);
        res.status(201).json({
            success: true,
            message: "Design created successfully",
            data: savedDesign
        });
    } catch (error) {
        console.error("Error creating design:", error);
        res.status(500).json({
            success: false,
            message: "Failed to create design",
            error: error.message
        });
    }
};

// Update an existing design — this endpoint did not exist at all before;
// once a template was created there was no way to edit or version it.
//
// SEC-AUDIT (Point 4/5, Credential Studio closure round): two real gaps
// found here on inspection, both fixed below.
//
// 1. A template could still be freely edited through this endpoint while
//    status was 'pending_review' -- a reviewer could end up approving
//    different content than whatever the submitter actually asked them to
//    review, with nothing forcing a resubmission. Now blocked with a 409;
//    the submitter has to be rejected back to draft (by another admin)
//    before editing further.
// 2. No protection against a stale write winning a race: autosave and the
//    manual Save button both funnel through this same endpoint (see the
//    frontend's saveTemplate) and can genuinely overlap -- a slower
//    response landing after a faster, newer one had already saved would
//    previously just overwrite it, silently losing the newer content. When
//    the caller supplies known_version (the version its edit actually
//    started from -- see the design editor), the write only applies if the
//    document is still at exactly that version, via one atomic
//    findOneAndUpdate; otherwise this 409s instead of clobbering. Callers
//    that don't send known_version (any direct API integration that
//    predates this) keep the previous unconditional-write behavior.
const updateDesign = async (req, res) => {
    try {
        const design = await Design.findOne({ design_code: req.params.design_code });
        if (!design) return res.status(404).json({ success: false, message: 'Design not found' });
        if (design.organization_code !== req.user.organization_code) {
            return res.status(403).json({ success: false, message: "Not allowed to modify another organization's template" });
        }
        if (design.status === 'pending_review') {
            return res.status(409).json({ success: false, message: 'Cannot edit a template while it is pending review. Ask a reviewer to approve or reject it first.' });
        }

        // organization_code, design_code, current_version, and status are
        // not editable through this endpoint — current_version is server-
        // managed (see below); status only changes through the dedicated
        // publish/unpublish endpoints, so publishing is always a deliberate
        // action, never a side effect of an unrelated field edit.
        // known_version is this request's own optimistic-lock token, never
        // part of the document itself.
        const { organization_code, design_code, current_version, status, known_version, ...allowedFields } = req.body;

        const filter = { design_code: req.params.design_code, organization_code: req.user.organization_code, status: { $ne: 'pending_review' } };
        if (known_version !== undefined) filter.current_version = known_version;

        const updated = await Design.findOneAndUpdate(
            filter,
            { $set: allowedFields, $inc: { current_version: 1 } },
            { new: true, runValidators: true },
        );
        if (!updated) {
            return res.status(409).json({ success: false, message: 'This template was changed by someone else since you loaded it. Reload to see the latest version before saving again.' });
        }
        await snapshotVersion(updated, req.user.username);
        res.status(200).json({ success: true, message: 'Design updated successfully', data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update design', error: error.message });
    }
};

// Publishing is the one and only way a template becomes eligible for
// actually issuing credentials (certificateController.generateCertificate
// rejects a draft) -- a deliberate action, never a side effect of saving.
const publishDesign = async (req, res) => {
    try {
        const design = await findOwnOrgDesign(req, res);
        if (!design) return;
        design.status = 'published';
        const updated = await design.save();
        res.status(200).json({ success: true, message: 'Template published', data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to publish design', error: error.message });
    }
};

// Reverts a published template back to draft -- e.g. an admin realizes it
// still needs work after all. Does not affect any credential already
// issued from it while it was published; only blocks future issuance
// until it's published again.
const unpublishDesign = async (req, res) => {
    try {
        const design = await findOwnOrgDesign(req, res);
        if (!design) return;
        design.status = 'draft';
        const updated = await design.save();
        res.status(200).json({ success: true, message: 'Template reverted to draft', data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to unpublish design', error: error.message });
    }
};

// Submits a draft for another admin to review before it can be published --
// an alternative to publishDesign's direct draft -> published jump for orgs
// that want a second set of eyes first. Only valid from 'draft': a template
// already pending review, published, or archived has to go through the
// matching action for that state instead (reject/unpublish/unarchive) to
// get back to draft before it can be resubmitted.
const submitForReview = async (req, res) => {
    try {
        const design = await findOwnOrgDesign(req, res);
        if (!design) return;
        if (design.status !== 'draft') {
            return res.status(409).json({ success: false, message: `Only a draft template can be submitted for review (this one is ${design.status}).` });
        }
        // SEC-AUDIT (Point 4): atomic status transition -- see approveDesign
        // below for why a plain read-then-save here isn't safe under
        // concurrent requests.
        const updated = await Design.findOneAndUpdate(
            { design_code: design.design_code, organization_code: req.user.organization_code, status: 'draft' },
            { $set: { status: 'pending_review', submitted_by: req.user.username, submitted_at: new Date(), reviewed_by: null, reviewed_at: null, rejection_reason: null } },
            { new: true },
        );
        if (!updated) {
            return res.status(409).json({ success: false, message: `Only a draft template can be submitted for review (this one is ${design.status}).` });
        }
        await AuditLog.create({ entity_type: 'design', entity_id: updated.design_code, event: 'submitted_for_review', organization_code: req.user.organization_code, actor_username: req.user.username });
        res.status(200).json({ success: true, message: 'Submitted for review', data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to submit design for review', error: error.message });
    }
};

// Approves a pending template, publishing it -- the whole point of the
// review step is a second admin looking it over, so whoever submitted it
// cannot also be the one who approves it.
//
// SEC-AUDIT (Point 4): the original version here read the design, checked
// its status in JS, then called .save() -- two concurrent approve requests
// (e.g. a genuine double-click, or two reviewers racing) could both read
// status: 'pending_review' before either write landed, and both would
// then succeed. The status transition is now one atomic findOneAndUpdate
// gated on status still being 'pending_review' at write time: only the
// first of any concurrent pair can ever match, the second gets back null
// and a clean 409 instead of silently double-approving.
const approveDesign = async (req, res) => {
    try {
        const design = await findOwnOrgDesign(req, res);
        if (!design) return;
        if (design.status !== 'pending_review') {
            return res.status(409).json({ success: false, message: `Only a template pending review can be approved (this one is ${design.status}).` });
        }
        if (design.submitted_by === req.user.username) {
            return res.status(403).json({ success: false, message: 'You cannot approve a template you submitted yourself -- ask another admin to review it.' });
        }
        const updated = await Design.findOneAndUpdate(
            { design_code: design.design_code, organization_code: req.user.organization_code, status: 'pending_review', submitted_by: { $ne: req.user.username } },
            { $set: { status: 'published', reviewed_by: req.user.username, reviewed_at: new Date() } },
            { new: true },
        );
        if (!updated) {
            return res.status(409).json({ success: false, message: 'This template was already reviewed by someone else in the meantime. Reload to see its current state.' });
        }
        await AuditLog.create({ entity_type: 'design', entity_id: updated.design_code, event: 'approved', organization_code: req.user.organization_code, actor_username: req.user.username, metadata: { submitted_by: updated.submitted_by } });
        res.status(200).json({ success: true, message: 'Template approved and published', data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to approve design', error: error.message });
    }
};

// Rejects a pending template back to draft, with a reason the submitter can
// act on. Same self-review restriction as approveDesign, for the same
// reason.
const rejectDesign = async (req, res) => {
    try {
        const design = await findOwnOrgDesign(req, res);
        if (!design) return;
        if (design.status !== 'pending_review') {
            return res.status(409).json({ success: false, message: `Only a template pending review can be rejected (this one is ${design.status}).` });
        }
        if (design.submitted_by === req.user.username) {
            return res.status(403).json({ success: false, message: 'You cannot reject a template you submitted yourself.' });
        }
        const { reason } = req.body;
        if (!reason || !String(reason).trim()) {
            return res.status(400).json({ success: false, message: 'A rejection reason is required' });
        }
        const trimmedReason = String(reason).trim().slice(0, 1000);
        // SEC-AUDIT (Point 4): same atomic-transition reasoning as
        // approveDesign above -- a concurrent approve/reject pair must
        // never both succeed.
        const updated = await Design.findOneAndUpdate(
            { design_code: design.design_code, organization_code: req.user.organization_code, status: 'pending_review', submitted_by: { $ne: req.user.username } },
            { $set: { status: 'draft', reviewed_by: req.user.username, reviewed_at: new Date(), rejection_reason: trimmedReason } },
            { new: true },
        );
        if (!updated) {
            return res.status(409).json({ success: false, message: 'This template was already reviewed by someone else in the meantime. Reload to see its current state.' });
        }
        await AuditLog.create({ entity_type: 'design', entity_id: updated.design_code, event: 'rejected', organization_code: req.user.organization_code, actor_username: req.user.username, metadata: { submitted_by: updated.submitted_by, reason: trimmedReason } });
        res.status(200).json({ success: true, message: 'Template rejected', data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to reject design', error: error.message });
    }
};

// Archiving takes a template out of active use (hidden from getAllDesigns
// by default, blocked from issuance the same way a draft is -- see
// certificateController.generateCertificate's gate, which rejects anything
// that isn't exactly 'published') without deleting it -- e.g. a template
// retired for a past event/cohort that shouldn't clutter the active list or
// be issuable by accident, but is still worth keeping around to look at or
// restore later.
const archiveDesign = async (req, res) => {
    try {
        const design = await findOwnOrgDesign(req, res);
        if (!design) return;
        design.status = 'archived';
        const updated = await design.save();
        res.status(200).json({ success: true, message: 'Template archived', data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to archive design', error: error.message });
    }
};

// Restores an archived template to draft -- not straight back to published,
// on the same reasoning createDesign always forces new templates to draft:
// re-publishing is a deliberate, separate action, never a side effect of
// un-archiving.
const unarchiveDesign = async (req, res) => {
    try {
        const design = await findOwnOrgDesign(req, res);
        if (!design) return;
        design.status = 'draft';
        const updated = await design.save();
        res.status(200).json({ success: true, message: 'Template restored to draft', data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to unarchive design', error: error.message });
    }
};

// Clones a template's full visual content (background, text, shapes,
// images, QR position) into a brand-new design -- distinct from duplicating
// a single element inside the editor (see design-editor/page.js's
// duplicateSelected), which only copies one shape/image/text field within
// the SAME template. This copies the whole template as a new starting
// point, e.g. "start next quarter's badge from this one." Always starts as
// a draft, exactly like createDesign, regardless of the source's status --
// copying a published template must never immediately be issuable without
// review.
const duplicateDesign = async (req, res) => {
    try {
        const source = await findOwnOrgDesign(req, res);
        if (!source) return;
        const payload = source.toObject();
        delete payload._id;
        delete payload.__v;
        delete payload.createdAt;
        delete payload.updatedAt;
        payload.design_code = await generateUniqueDesignCode();
        payload.credential_title = `${source.credential_title || source.design_code} (copy)`;
        payload.status = 'draft';
        payload.current_version = 1;
        const copy = new Design(payload);
        const saved = await copy.save();
        await snapshotVersion(saved, req.user.username);
        res.status(201).json({ success: true, message: 'Template duplicated', data: saved });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to duplicate design', error: error.message });
    }
};

// Point 4 (Credential Studio closure round): the append-only trail behind
// the approve/reject actions above -- submitted_by/reviewed_by/
// rejection_reason on the design itself only ever hold the LAST cycle's
// values, so a template rejected and resubmitted more than once had no way
// to see who did what across earlier cycles. Read-only, own-org-scoped
// like every other design endpoint.
const listDesignAuditLog = async (req, res) => {
    try {
        const design = await findOwnOrgDesign(req, res);
        if (!design) return;
        const entries = await AuditLog.find({ entity_type: 'design', entity_id: design.design_code, organization_code: req.user.organization_code })
            .sort({ createdAt: -1 }).lean();
        res.status(200).json({ success: true, data: entries });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch audit log', error: error.message });
    }
};

// Point 8 (Credential Studio closure round): turns one of the 12 official
// gallery starter templates into a real, storage-hosted PNG the certificate
// microservice can actually render -- see utils/galleryTemplates.js for the
// full rationale. Called by the design editor the moment an admin picks a
// gallery template, before the SVG-based frontend URL is ever set as a
// design's background, so nothing unrenderable is ever saved.
const materializeGalleryTemplateHandler = (req, res) => {
    try {
        const { template_id } = req.body;
        const result = materializeGalleryTemplate(template_id, req);
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

// Public, unauthenticated read of a template -- only ever returns a
// PUBLISHED template's visual-only fields (no organization internals
// beyond its public name), and 404s identically for "doesn't exist" and
// "exists but is a draft" so a public caller can never distinguish the
// two -- an org's draft template names/content stay private. Backs the
// public preview page a "Share on LinkedIn" button on a template points
// at (see routes/designRoutes.js).
const getPublicDesignPreview = async (req, res) => {
    try {
        const design = await Design.findOne({ design_code: req.params.design_code, status: 'published' })
            .select('design_code credential_title main_template_url template_url text_attributes shapes images QR_CODE organization_code')
            .lean();
        if (!design) return res.status(404).json({ success: false, message: 'Template not found' });
        const Organization = require('../models/organization_schema');
        const organization = await Organization.findOne({ organization_code: design.organization_code }).select('name').lean();
        const { organization_code, ...publicDesign } = design;
        res.status(200).json({ success: true, data: { ...publicDesign, organization_name: organization?.name || '' } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load template preview', error: error.message });
    }
};

// Version history for a template -- newest first, snapshot content
// omitted from the list view (same "don't ship the heavy payload for a
// list" pattern as the bulk-issuance pending list).
const listDesignVersions = async (req, res) => {
    try {
        const design = await Design.findOne({ design_code: req.params.design_code });
        if (!design) return res.status(404).json({ success: false, message: 'Design not found' });
        if (design.organization_code !== req.user.organization_code) {
            return res.status(403).json({ success: false, message: "Not allowed to access another organization's template" });
        }
        const versions = await DesignVersion.find({ design_code: req.params.design_code })
          .select('-snapshot').sort({ version_number: -1 }).lean();
        res.status(200).json({ success: true, data: versions, current_version: design.current_version });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch version history', error: error.message });
    }
};

// Reverting restores that version's content onto the live design AND
// creates a brand new version for the revert itself -- so the version
// history stays append-only and honest ("this is what it looked like
// after reverting to v3"), never rewound or deleted.
const revertDesignVersion = async (req, res) => {
    try {
        const design = await Design.findOne({ design_code: req.params.design_code });
        if (!design) return res.status(404).json({ success: false, message: 'Design not found' });
        if (design.organization_code !== req.user.organization_code) {
            return res.status(403).json({ success: false, message: "Not allowed to modify another organization's template" });
        }
        const targetVersion = await DesignVersion.findOne({
            design_code: req.params.design_code,
            version_number: Number(req.params.version_number),
        });
        if (!targetVersion) return res.status(404).json({ success: false, message: 'Version not found' });

        const { _id, __v, design_code, organization_code, current_version, createdAt, updatedAt, ...restorable } = targetVersion.snapshot;
        Object.assign(design, restorable);
        design.current_version += 1;
        const updated = await design.save();
        await snapshotVersion(updated, req.user.username);
        res.status(200).json({ success: true, message: `Reverted to version ${req.params.version_number}`, data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to revert design', error: error.message });
    }
};

// ---- Comments (scoped-down collaboration: threaded notes, no live merge) ----

const listComments = async (req, res) => {
    try {
        const design = await findOwnOrgDesign(req, res);
        if (!design) return;
        const comments = await DesignComment.find({ design_code: req.params.design_code }).sort({ createdAt: 1 }).lean();
        res.status(200).json({ success: true, data: comments });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch comments', error: error.message });
    }
};

const createComment = async (req, res) => {
    try {
        const design = await findOwnOrgDesign(req, res);
        if (!design) return;
        const { text, position } = req.body;
        if (!text || !String(text).trim()) {
            return res.status(400).json({ success: false, message: 'text is required' });
        }
        const comment = await DesignComment.create({
            design_code: req.params.design_code,
            organization_code: req.user.organization_code,
            author_username: req.user.username,
            text: String(text).trim(),
            position: position && Number.isFinite(position.X) && Number.isFinite(position.Y) ? position : undefined,
        });
        res.status(201).json({ success: true, data: comment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to create comment', error: error.message });
    }
};

const resolveComment = async (req, res) => {
    try {
        const design = await findOwnOrgDesign(req, res);
        if (!design) return;
        const comment = await DesignComment.findOneAndUpdate(
            { _id: req.params.commentId, design_code: req.params.design_code },
            { resolved: true },
            { new: true },
        );
        if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });
        res.status(200).json({ success: true, data: comment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to resolve comment', error: error.message });
    }
};

const deleteComment = async (req, res) => {
    try {
        const design = await findOwnOrgDesign(req, res);
        if (!design) return;
        const comment = await DesignComment.findOneAndDelete({ _id: req.params.commentId, design_code: req.params.design_code });
        if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });
        res.status(200).json({ success: true, message: 'Comment deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete comment', error: error.message });
    }
};

// ---- Presence ("who else is viewing this template right now") ----

const sendPresenceHeartbeat = async (req, res) => {
    try {
        const design = await findOwnOrgDesign(req, res);
        if (!design) return;
        const redisBacked = await presence.heartbeat(req.params.design_code, req.user.username);
        res.status(200).json({ success: true, redis_backed: redisBacked });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to record presence', error: error.message });
    }
};

const getPresence = async (req, res) => {
    try {
        const design = await findOwnOrgDesign(req, res);
        if (!design) return;
        const usernames = await presence.listActive(req.params.design_code);
        res.status(200).json({ success: true, data: usernames.filter((name) => name !== req.user.username) });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch presence', error: error.message });
    }
};

// Delete a design — also did not exist before.
const deleteDesign = async (req, res) => {
    try {
        const design = await Design.findOne({ design_code: req.params.design_code });
        if (!design) return res.status(404).json({ success: false, message: 'Design not found' });
        if (design.organization_code !== req.user.organization_code) {
            return res.status(403).json({ success: false, message: "Not allowed to delete another organization's template" });
        }
        await Design.deleteOne({ _id: design._id });
        res.status(200).json({ success: true, message: 'Design deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete design', error: error.message });
    }
};

// Get designs by organization code -- archived templates are excluded by
// default (an archived template is meant to be out of the way, not
// cluttering the list an admin picks from every day) unless the caller
// explicitly asks for them with ?include_archived=true, e.g. to browse to
// one and restore or duplicate it.
const getDesignsByOrganizations = async (req, res) => {
    try {
        const { organization_code } = req.params;
        const filter = { organization_code };
        if (req.query.include_archived !== 'true') filter.status = { $ne: 'archived' };
        const designs = await Design.find(filter).sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            data: designs
        });
    } catch (error) {
        console.error("Error fetching designs by organization:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch designs by organization",
            error: error.message
        });
    }
};

// Get a design by code
const getDesignByCode = async (req, res) => {
  try {
    const design = await Design.findOne({design_code: req.params.design_code});
    if (!design) return res.status(404).json({ message: 'Design not found' });
    if (req.user?.organization_code && design.organization_code !== req.user.organization_code) {
      return res.status(403).json({ message: "Not allowed to access another organization's template" });
    }
    res.status(200).json(design);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get all designs belonging to the caller's own organization (admin use)
const getAllDesigns = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 200, 500);
        const skip = parseInt(req.query.skip) || 0;
        const designs = await Design.find({ organization_code: req.user.organization_code })
          .skip(skip).limit(limit).lean();
        res.status(200).json({
            success: true,
            data: designs
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to fetch designs",
            error: error.message
        });
    }
};

module.exports = {
    createDesign,
    updateDesign,
    deleteDesign,
    getAllDesigns,
    getDesignByCode,
    getDesignsByOrganizations,
    listDesignVersions,
    revertDesignVersion,
    listComments,
    createComment,
    resolveComment,
    deleteComment,
    sendPresenceHeartbeat,
    getPresence,
    publishDesign,
    unpublishDesign,
    archiveDesign,
    unarchiveDesign,
    duplicateDesign,
    getPublicDesignPreview,
    submitForReview,
    approveDesign,
    rejectDesign,
    materializeGalleryTemplateHandler,
    listDesignAuditLog,
    // Reused by controllers/designShareController.js's importSharedDesign
    // for the same reason duplicateDesign needs them: turning a shared
    // template into a real, independent copy in the receiving org is the
    // same "generate a fresh code, snapshot version 1" operation, no
    // second implementation of either warranted.
    generateUniqueDesignCode,
    snapshotVersion,
};
