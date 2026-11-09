const mongoose = require('mongoose');

const scoreSchema = new mongoose.Schema({
  organization_code: { type: String, required: true, index: true },
  goal_code: { type: String, required: true },
  username: { type: String, required: true, index: true },
  score: { type: Number, required: true, min: 0 },
}, { timestamps: true });

// E2E audit finding H-09: unique, matching the analogous compound index
// on goal_schema.js -- a hard DB-level guarantee that at most one Score
// document can ever exist per organization+user+goal, on top of
// completionController.approveCompletion's atomic upsert (which is what
// actually keeps concurrent approvals correct; this index is the backstop
// against any other future write path getting it wrong).
scoreSchema.index({ organization_code: 1, username: 1, goal_code: 1 }, { unique: true });

module.exports = mongoose.model('Score', scoreSchema);
