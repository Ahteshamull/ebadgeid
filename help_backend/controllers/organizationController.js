const Organization = require("../models/organization");

const tenantFilter = req => ({ organization_code: req.user.org_code });
const allowedFields = ["name", "support_email", "organization_logo", "address", "city", "country"];
const sanitize = body => Object.fromEntries(
  Object.entries(body || {}).filter(([key]) => allowedFields.includes(key))
);

// Create new organization
exports.createOrganization = async (req, res) => {
  try {
    if (!req.user.org_code) {
      return res.status(403).json({ message: "The administrator is not assigned to an organization" });
    }
    const data = sanitize(req.body);
    const { name, support_email } = data;
    if (!name || !support_email) {
      return res.status(400).json({ message: "Name and support email are required" });
    }

    const existing = await Organization.findOne({
      $or: [{ support_email }, { organization_code: req.user.org_code }]
    });
    if (existing) {
      return res.status(400).json({ message: "Support email already exists" });
    }

    const organization = new Organization({ ...data, organization_code: req.user.org_code });

    const savedOrg = await organization.save();
    res.status(201).json(savedOrg);
  } catch (error) {
    res.status(500).json({ message: "Failed to create organization", error: error.message });
  }
};

// Get all organizations
exports.getAllOrganizations = async (req, res) => {
  try {
    const organizations = await Organization.find(tenantFilter(req)).sort({ createdAt: -1 });
    res.status(200).json(organizations);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch organizations", error: error.message });
  }
};

// Get organization by ID
exports.getOrganizationById = async (req, res) => {
  try {
    const org = await Organization.findOne({ _id: req.params.id, ...tenantFilter(req) });
    if (!org) {
      return res.status(404).json({ message: "Organization not found" });
    }
    res.status(200).json(org);
  } catch (error) {
    res.status(500).json({ message: "Error retrieving organization", error: error.message });
  }
};

// Update organization
exports.updateOrganization = async (req, res) => {
  try {
    const updated = await Organization.findOneAndUpdate(
      { _id: req.params.id, ...tenantFilter(req) },
      sanitize(req.body),
      { new: true, runValidators: true }
    );
    if (!updated) {
      return res.status(404).json({ message: "Organization not found" });
    }
    res.status(200).json(updated);
  } catch (error) {
    res.status(500).json({ message: "Failed to update organization", error: error.message });
  }
};

// Delete organization
exports.deleteOrganization = async (req, res) => {
  return res.status(403).json({
    message: "Organization deletion is disabled; use the audited platform offboarding process"
  });
};

exports.getOrganizationByCode = async (req, res) => {
  try {
    if (req.params.code !== req.user.org_code) {
      return res.status(403).json({ message: "Access denied" });
    }
    const org = await Organization.findOne({ organization_code: req.user.org_code });
    if (!org) return res.status(404).json({ message: "Organization not found" });
    return res.status(200).json(org);
  } catch (error) {
    return res.status(500).json({ message: "Error retrieving organization" });
  }
};
