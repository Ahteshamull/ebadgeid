const mongoose = require("mongoose");

const contactRequestSchema = new mongoose.Schema({
  organization_code: { type: String, required: true, index: true },
  sessionId: {
    type: String,
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 200,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address']
  },
  phone: {
    type: String,
    required: false,
    trim: true,
    maxlength: 20
  },
  message: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  category: {
    type: String,
    enum: ['general', 'order', 'product', 'billing', 'technical', 'complaint'],
    default: 'general'
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'resolved', 'closed'],
    default: 'pending'
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  userInfo: {
    ip: String,
    userAgent: String,
    location: String
  },
  chatContext: {
    messageCount: Number,
    intentsUsed: [String],
    lastMessages: [String] // Store last few messages for context
  },
  response: {
    message: String,
    respondedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    respondedAt: Date
  },
  followUp: {
    required: {
      type: Boolean,
      default: false
    },
    scheduledFor: Date,
    completed: {
      type: Boolean,
      default: false
    }
  },
  tags: [{
    type: String,
    trim: true
  }],
  internalNotes: [{
    note: String,
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  resolvedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
contactRequestSchema.index({ status: 1, createdAt: -1 });
contactRequestSchema.index({ organization_code: 1, status: 1, createdAt: -1 });
contactRequestSchema.index({ assignedTo: 1, status: 1 });
contactRequestSchema.index({ email: 1, createdAt: -1 });
contactRequestSchema.index({ priority: 1, status: 1, createdAt: -1 });

// Pre-save middleware to update status timestamps
contactRequestSchema.pre('save', function(next) {
  if (this.isModified('status')) {
    this.updatedAt = new Date();
    
    if (this.status === 'resolved' || this.status === 'closed') {
      this.resolvedAt = new Date();
    }
  }
  next();
});

// Instance method to assign to agent
contactRequestSchema.methods.assignToAgent = function(agentId) {
  this.assignedTo = agentId;
  this.status = 'in_progress';
  return this.save();
};

// Instance method to add internal note
contactRequestSchema.methods.addInternalNote = function(note, userId) {
  this.internalNotes.push({
    note: note,
    addedBy: userId,
    addedAt: new Date()
  });
  return this.save();
};

// Instance method to mark as resolved
contactRequestSchema.methods.markAsResolved = function(responseMessage, responderId) {
  this.status = 'resolved';
  this.resolvedAt = new Date();
  this.response = {
    message: responseMessage,
    respondedBy: responderId,
    respondedAt: new Date()
  };
  return this.save();
};

module.exports = mongoose.model("ContactRequest", contactRequestSchema);
