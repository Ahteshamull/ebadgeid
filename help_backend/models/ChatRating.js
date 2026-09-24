// models/ChatRating.js
const mongoose = require("mongoose");

const chatRatingSchema = new mongoose.Schema({
  organization_code: { type: String, required: true, index: true },
  sessionId: {
    type: String,
    required: true,
    index: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  feedback: {
    type: String,
    default: '',
    maxlength: 1000
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // Guest users might not have userId
  },
  userInfo: {
    ip: String,
    userAgent: String,
    location: String
  },
  chatDuration: {
    type: Number, // in minutes
    required: false
  },
  messageCount: {
    type: Number,
    default: 0
  },
  intentsUsed: [{
    type: String
  }],
  agentHandoff: {
    requested: {
      type: Boolean,
      default: false
    },
    connected: {
      type: Boolean,
      default: false
    },
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'abandoned'],
    default: 'completed'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for analytics queries
chatRatingSchema.index({ createdAt: -1, rating: 1 });
chatRatingSchema.index({ organization_code: 1, createdAt: -1, rating: 1 });
chatRatingSchema.index({ sessionId: 1, createdAt: -1 });

// Instance method to check if rating is positive
chatRatingSchema.methods.isPositive = function() {
  return this.rating >= 4;
};

module.exports = mongoose.model("ChatRating", chatRatingSchema);

