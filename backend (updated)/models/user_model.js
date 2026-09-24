const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, index: true },
  organization_code: { type: String, required: true, index: true },
  first_name: { type: String, required: true },
  last_name: { type: String, required: true },
  designation: { type: String, required: true },
  city: { type: String, required: true },
  state: { type: String, required: true },
  country: { type: String, required: true },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    // Basic shape check at the DB layer — this used to accept any string,
    // so a typo'd email would silently break credential-issued notification
    // emails with no error until someone noticed nothing arrived.
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address'],
  },
  phone: { type: String, required: true },
  status: { type: String, required: true },
  profile_picture_url: { type: String, required: false }
}, { timestamps: true });

module.exports = mongoose.model('Users', userSchema);