// utils/customFields.js
//
// A custom field's value ends up burned into a rendered certificate image
// (see controllers/certificateController.js) and, separately, stored
// verbatim on the issued credential for later display (see
// controllers/credentialController.js) -- both call this so neither can
// accept something the other would reject. `recipient_name` is dropped
// silently rather than rejected: achiever_username is always the single
// source of truth for that field, so a caller sending it here is almost
// certainly just echoing the full text_attributes list back, not trying to
// override anything.
const MAX_FIELDS = 30;
const MAX_VALUE_LENGTH = 300;

function sanitizeCustomFields(raw) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('custom_fields must be an object mapping field name to value');
  }
  const entries = Object.entries(raw);
  if (entries.length > MAX_FIELDS) {
    throw new Error(`custom_fields cannot have more than ${MAX_FIELDS} fields`);
  }
  const sanitized = {};
  for (const [key, value] of entries) {
    if (typeof key !== 'string' || !key.trim() || key === 'recipient_name') continue;
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new Error(`custom_fields.${key} must be a string or number`);
    }
    sanitized[key.trim()] = String(value).slice(0, MAX_VALUE_LENGTH);
  }
  return sanitized;
}

module.exports = { sanitizeCustomFields, MAX_FIELDS, MAX_VALUE_LENGTH };
