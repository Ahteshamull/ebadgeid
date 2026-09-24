const mongoose = require('mongoose');

const task_completion = new mongoose.Schema({
  username: { type: String, required: true, index: true },
  message: { type: String, required: true, maxlength: 5000 },
  organization_code: { type: String, required: true, index: true },
  status: {type:String, required: true, enum: ['under_review', 'approved', 'rejected'], default: 'under_review'},
  goal_code: { type: String, required: true }
}, { timestamps: true });

task_completion.index({ organization_code: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Completion', task_completion);
