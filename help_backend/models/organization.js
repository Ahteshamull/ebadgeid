const mongoose = require("mongoose");

const organizationSchema = new mongoose.Schema({
  organization_code: { type: String, unique: true, sparse: true, index: true },
  name: { type: String, required: true },
  support_email: { type: String, required: true, unique: true },
  organization_logo: { type: String, default: "" },
  address: { type: String },
  city: {type:String, required: true},
  country: {type:String, required: true},
  
}, { timestamps: true });

module.exports = mongoose.model("Organizations", organizationSchema);
