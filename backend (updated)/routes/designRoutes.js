const express = require('express');
const router = express.Router();
const {
    createDesign, updateDesign, deleteDesign, getAllDesigns, getDesignByCode, getDesignsByOrganizations,
    listDesignVersions, revertDesignVersion,
    listComments, createComment, resolveComment, deleteComment,
    sendPresenceHeartbeat, getPresence,
    publishDesign, unpublishDesign, archiveDesign, unarchiveDesign, duplicateDesign, getPublicDesignPreview,
    submitForReview, approveDesign, rejectDesign,
    materializeGalleryTemplateHandler, listDesignAuditLog,
} = require('../controllers/designController');
const { requireAuth, requireAdmin, requireOwnOrg } = require('../middleware/requireAuth');

// Public, unauthenticated -- backs the "Share on LinkedIn" preview page.
// Registered before the authenticated routes below so its literal
// "/public" segment is never shadowed by anything else.
router.get('/public/:design_code', getPublicDesignPreview);

// Point 8: turns one of the 12 official gallery templates into a real,
// storage-hosted PNG background -- see utils/galleryTemplates.js. Admin-
// gated like every other design-authoring endpoint below.
router.post('/gallery-templates/materialize', requireAuth, requireAdmin, materializeGalleryTemplateHandler);

router.post('/', requireAuth, requireAdmin, createDesign);
router.get('/', requireAuth, requireAdmin, getAllDesigns);
router.get('/by-code/:design_code', requireAuth, getDesignByCode);
router.put('/:design_code', requireAuth, requireAdmin, updateDesign);
router.delete('/:design_code', requireAuth, requireAdmin, deleteDesign);
router.get('/organization/:organization_code', requireAuth, requireOwnOrg('organization_code'), getDesignsByOrganizations);
router.get('/:design_code/versions', requireAuth, requireAdmin, listDesignVersions);
router.post('/:design_code/versions/:version_number/revert', requireAuth, requireAdmin, revertDesignVersion);
router.get('/:design_code/comments', requireAuth, requireAdmin, listComments);
router.post('/:design_code/comments', requireAuth, requireAdmin, createComment);
router.patch('/:design_code/comments/:commentId/resolve', requireAuth, requireAdmin, resolveComment);
router.delete('/:design_code/comments/:commentId', requireAuth, requireAdmin, deleteComment);
router.post('/:design_code/presence', requireAuth, requireAdmin, sendPresenceHeartbeat);
router.get('/:design_code/presence', requireAuth, requireAdmin, getPresence);
router.post('/:design_code/submit-review', requireAuth, requireAdmin, submitForReview);
router.post('/:design_code/approve', requireAuth, requireAdmin, approveDesign);
router.post('/:design_code/reject', requireAuth, requireAdmin, rejectDesign);
router.get('/:design_code/audit-log', requireAuth, requireAdmin, listDesignAuditLog);
router.post('/:design_code/publish', requireAuth, requireAdmin, publishDesign);
router.post('/:design_code/unpublish', requireAuth, requireAdmin, unpublishDesign);
router.post('/:design_code/archive', requireAuth, requireAdmin, archiveDesign);
router.post('/:design_code/unarchive', requireAuth, requireAdmin, unarchiveDesign);
router.post('/:design_code/duplicate', requireAuth, requireAdmin, duplicateDesign);
module.exports = router;
