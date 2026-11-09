const mongoose = require('mongoose');

const goalSchema = new mongoose.Schema({
  organization_code: { type: String, required: true, index: true },
  goal_code: { type: String, required: true },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  total_score: {type:Number, required: true},
  qualifying_score: { type: Number, required: true },
  start_date: {type:String, required: true},
  end_date: {type:String, required: true},

}, { timestamps: true });

goalSchema.index({ organization_code: 1, goal_code: 1 }, { unique: true });

module.exports = mongoose.model('Goals', goalSchema);
