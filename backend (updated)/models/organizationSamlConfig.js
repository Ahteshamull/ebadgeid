// models/organizationSamlConfig.js
//
// Per-organization SAML 2.0 SSO config -- what lets an Enterprise
// customer's own Identity Provider (Okta, Azure AD, OneLogin, a custom
// IdP, whichever they already run) authenticate their users into this
// system instead of a local eBadge ID password. Each customer's IdP is
// its own trust relationship: their entity ID, their SSO redirect URL,
// and their signing certificate (used to verify assertions really came
// from them, not forged) -- see services/samlAuth.js for how these get
// turned into a real samlify IdentityProvider per request.
const mongoose = require('mongoose');

const organizationSamlConfigSchema = new mongoose.Schema({
  organization_code: { type: String, required: true, unique: true, index: true },
  idp_entity_id: { type: String, required: true },
  idp_sso_url: { type: String, required: true },
  idp_certificate: { type: String, required: true }, // PEM, no private data -- the IdP's own public signing cert
  enabled: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('OrganizationSamlConfig', organizationSamlConfigSchema);
