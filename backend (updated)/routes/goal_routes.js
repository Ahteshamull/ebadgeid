const express = require('express');
const router = express.Router();
const goalController = require('../controllers/goalController');
const { requireAuth, requireAdminOrTeacher, requireOwnOrg } = require('../middleware/requireAuth');

// LOW-01 fix: requireAdmin -> requireAdminOrTeacher -- sidebar.js grants
// "Manage Goals" to both admin and teacher; see requireAdminOrTeacher's
// own comment in middleware/requireAuth.js for why this is scoped to this
// file specifically, not a broadened requireAdmin.
router.post('/', requireAuth, requireAdminOrTeacher, goalController.createGoal);
router.get('/', requireAuth, requireAdminOrTeacher, goalController.getAllGoals);
router.get('/organization/:organization_code', requireAuth, requireOwnOrg(), goalController.getGoalsByOrganization);
router.get('/:id', requireAuth, goalController.getGoalById);
router.put('/:id', requireAuth, requireAdminOrTeacher, goalController.updateGoal);
router.delete('/:id', requireAuth, requireAdminOrTeacher, goalController.deleteGoal);
module.exports = router;
