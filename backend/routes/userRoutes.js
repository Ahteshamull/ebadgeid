const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { requireAuth, requireAdmin, requireAdminOrTeacher, requireOwnOrg } = require('../middleware/requireAuth');
const { checkUserLimit } = require('../middleware/enforcePlanLimits');

// Self-signup stays public: it's an intentional entry point for new users.
router.post('/self-signup', userController.self_signup_user);

// Everything else requires a valid session.
// LOW-01 fix: requireAdmin -> requireAdminOrTeacher on create/list --
// sidebar.js grants "Manage Users" to both admin and teacher; see
// requireAdminOrTeacher's own comment in middleware/requireAuth.js. Delete
// deliberately stays admin-only -- the frontend gates page navigation, not
// necessarily every destructive action within it, and removing an account
// is the one irreversible operation here.
router.post('/', requireAuth, requireAdminOrTeacher, checkUserLimit, userController.createUser);
router.get('/', requireAuth, requireAdminOrTeacher, userController.getAllUsers);
router.get('/:id', requireAuth, userController.getUserById);
router.put('/:id', requireAuth, userController.updateUser);
router.delete('/:id', requireAuth, requireAdmin, userController.deleteUser);
router.get('/org/:organization_code', requireAuth, requireOwnOrg(), userController.getUsersByOrgCode);
router.get('/username/:username', requireAuth, userController.getUserByUsername);
module.exports = router;
