const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Invalid email address"]
  },
  username: { type: String, required: false, lowercase: true, trim: true },
  password: { type: String, required: true, select: false },
  profile_picture: { type: String, default: "" },
  address: { type: String },
  user_type: { type: String, enum: ["admin", "agent", "user"], default: "user" },
  is_active: { type: Boolean, default: false },
  last_seen: { type: Date, default: Date.now },
  org_code: { type: String, required: true, index: true, trim: true }
}, { timestamps: true });

// A helpdesk identity belongs to exactly one tenant. Global unique indexes
// made it impossible for two organizations to use the same corporate email
// or username, and also made tenant-aware login ambiguous. Keep identity
// uniqueness inside the organization instead.
userSchema.index({ org_code: 1, email: 1 }, { unique: true, name: 'org_email_unique' });
userSchema.index(
  { org_code: 1, username: 1 },
  { unique: true, partialFilterExpression: { username: { $type: 'string' } }, name: 'org_username_unique' }
);

// Method to check if user is currently active (within last 5 minutes)
userSchema.methods.isCurrentlyActive = function() {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  return this.last_seen > fiveMinutesAgo;
};

// Static method to update user's last seen
userSchema.statics.updateLastSeen = async function(userId) {
  return this.findByIdAndUpdate(
    userId,
    { 
      last_seen: new Date(),
      is_active: true 
    },
    { new: true }
  );
};

// Static method to set user offline
userSchema.statics.setUserOffline = async function(userId) {
  return this.findByIdAndUpdate(
    userId,
    { is_active: false },
    { new: true }
  );
};

module.exports = mongoose.model("User", userSchema);
