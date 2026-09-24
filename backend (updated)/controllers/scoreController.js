const Score = require('../models/score_schema');

const scoreFields = body => Object.fromEntries(
  Object.entries(body).filter(([key]) => ['goal_code', 'username', 'score'].includes(key))
);

// Create a new score
exports.createScore = async (req, res) => {
  try {
    const fields = scoreFields(req.body);
    const newScore = new Score({ ...fields, organization_code: req.user.organization_code });
    const savedScore = await newScore.save();
    res.status(201).json(savedScore);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Get all scores
exports.getAllScores = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const skip = parseInt(req.query.skip) || 0;
    const scores = await Score.find({ organization_code: req.user.organization_code }).skip(skip).limit(limit).lean();
    res.json(scores);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get score by ID
exports.getScoreById = async (req, res) => {
  try {
    const score = await Score.findById(req.params.id);
    if (!score) return res.status(404).json({ message: 'Score not found' });
    if (req.user.organization_code && score.organization_code !== req.user.organization_code) {
      return res.status(403).json({ message: 'Not allowed to access another organization\'s score' });
    }
    res.json(score);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update score
exports.updateScore = async (req, res) => {
  try {
    const allowedFields = scoreFields(req.body);
    const updatedScore = await Score.findOneAndUpdate(
      { _id: req.params.id, organization_code: req.user.organization_code },
      allowedFields,
      { new: true, runValidators: true }
    );
    if (!updatedScore) return res.status(404).json({ message: 'Score not found' });
    res.json(updatedScore);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Delete score
exports.deleteScore = async (req, res) => {
  try {
    const deletedScore = await Score.findOneAndDelete({
      _id: req.params.id,
      organization_code: req.user.organization_code,
    });
    if (!deletedScore) return res.status(404).json({ message: 'Score not found' });
    res.json({ message: 'Score deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
