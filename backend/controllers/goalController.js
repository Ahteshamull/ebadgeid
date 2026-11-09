const Goal = require('../models/goal_schema');
const crypto = require('crypto');

const goalFields = body => Object.fromEntries(
  Object.entries(body).filter(([key]) => ['name', 'total_score', 'qualifying_score', 'start_date', 'end_date'].includes(key))
);

// Create a new goal
exports.createGoal = async (req, res) => {
  try {
    const fields = goalFields(req.body);
    if (Number(fields.qualifying_score) > Number(fields.total_score)) {
      return res.status(400).json({ message: 'Qualifying score cannot exceed total score' });
    }
    const goal = new Goal({
      ...fields,
      goal_code: `GOAL-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase(),
      organization_code: req.user.organization_code,
    });
    const savedGoal = await goal.save();
    res.status(201).json(savedGoal);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Get all goals
exports.getAllGoals = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const skip = parseInt(req.query.skip) || 0;
    const goals = await Goal.find({ organization_code: req.user.organization_code }).skip(skip).limit(limit).lean();
    res.status(200).json(goals);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get a goal by ID
exports.getGoalById = async (req, res) => {
  try {
    const goal = await Goal.findById(req.params.id);
    if (!goal) return res.status(404).json({ message: 'Goal not found' });
    if (req.user.organization_code && goal.organization_code !== req.user.organization_code) {
      return res.status(403).json({ message: 'Not allowed to access another organization\'s goal' });
    }
    res.status(200).json(goal);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update a goal
exports.updateGoal = async (req, res) => {
  try {
    const allowedFields = goalFields(req.body);
    if (Number(allowedFields.qualifying_score) > Number(allowedFields.total_score)) {
      return res.status(400).json({ message: 'Qualifying score cannot exceed total score' });
    }
    const updatedGoal = await Goal.findOneAndUpdate(
      { _id: req.params.id, organization_code: req.user.organization_code },
      allowedFields,
      { new: true, runValidators: true }
    );
    if (!updatedGoal) return res.status(404).json({ message: 'Goal not found' });
    res.status(200).json(updatedGoal);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Delete a goal
exports.deleteGoal = async (req, res) => {
  try {
    const deletedGoal = await Goal.findOneAndDelete({
      _id: req.params.id,
      organization_code: req.user.organization_code,
    });
    if (!deletedGoal) return res.status(404).json({ message: 'Goal not found' });
    res.status(200).json({ message: 'Goal deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get goals by organization code
exports.getGoalsByOrganization = async (req, res) => {
  try {
    const orgCode = req.params.organization_code;
    // Defense in depth (E2E audit H-21): don't rely solely on the
    // requireOwnOrg route middleware — check it here too.
    if (req.user.organization_code && orgCode !== req.user.organization_code) {
      return res.status(403).json({ message: 'Not allowed to access another organization\'s goals' });
    }
    const goals = await Goal.find({ organization_code: orgCode });
    res.status(200).json(goals);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
