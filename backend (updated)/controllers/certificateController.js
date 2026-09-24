const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Design = require('../models/designSchema');
const User = require('../models/user_model');
const OrganizationAsset = require('../models/organizationAsset');
const logger = require('../utils/logger');
const { sanitizeCustomFields } = require('../utils/customFields');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const publicFileUrl = filename => {
  const base = process.env.PUBLIC_STORAGE_BASE_URL?.replace(/\/$/, '');
  if (!base) throw new Error('PUBLIC_STORAGE_BASE_URL is not configured');
  return `${base}/uploads/${filename}`;
};

const signedStorageFileUrl = (base, storageKey) => {
  const signingKey = process.env.STORAGE_FILE_SIGNING_KEY;
  if (!signingKey) throw new Error('STORAGE_FILE_SIGNING_KEY is not configured');
  const expires = Math.floor(Date.now() / 1000) + 5 * 60;
  const signature = crypto.createHmac('sha256', signingKey).update(`${storageKey}:${expires}`).digest('base64url');
  return `${base}/api/files/${encodeURIComponent(storageKey)}?expires=${expires}&signature=${encodeURIComponent(signature)}`;
};

const internalTemplateUrl = value => {
  const publicBase = process.env.PUBLIC_STORAGE_BASE_URL?.replace(/\/$/, '');
  const internalBase = process.env.STORAGE_INTERNAL_BASE_URL?.replace(/\/$/, '');
  if (publicBase && internalBase && value.startsWith(`${publicBase}/uploads/`)) {
    return `${internalBase}${value.slice(publicBase.length)}`;
  }
  if (publicBase && internalBase && value.startsWith(`${publicBase}/api/files/`)) {
    const storageKey = value.slice(`${publicBase}/api/files/`.length).split(/[?#]/)[0];
    return signedStorageFileUrl(internalBase, storageKey);
  }
  return value;
};

// Fills the {{token}} placeholders the template library writes into its
// designs. Every one of the eight built-in certificate templates carries
// "Issued on {{issue_date}}", and nothing substituted it: each certificate
// was issued with the literal text {{issue_date}} printed on it, which a
// recipient sees and a verifier downloads. Found by reading an actually
// issued certificate image, not the code.
//
// An unrecognized token is deliberately left as-is rather than blanked: a
// mistyped placeholder should be visible in the preview, not silently
// swallowed into an empty gap on a real credential.
const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/gi;
const fillPlaceholders = (text, values) => {
  if (typeof text !== 'string' || !text.includes('{{')) return text;
  return text.replace(PLACEHOLDER, (whole, token) => {
    const value = values[token.toLowerCase()];
    return value === undefined || value === null ? whole : String(value);
  });
};

exports.generateCertificate = async (req, res) => {
  try {
    const { design_code, achiever_username, credential_code, guest_recipient, custom_fields: rawCustomFields } = req.body;
    if (!/^CRED-[A-F0-9]{16}$/.test(String(credential_code || ''))) {
      return res.status(400).json({ message: 'A valid reserved credential code is required' });
    }
    if (!design_code || !achiever_username) {
      return res.status(400).json({ message: 'design_code and achiever_username are required' });
    }
    let custom_fields;
    try {
      custom_fields = sanitizeCustomFields(rawCustomFields);
    } catch (validationError) {
      return res.status(400).json({ message: validationError.message });
    }
    // `recipient` here only ever gates existence — the text actually
    // embossed on the certificate below is the raw achiever_username
    // string, not any field off this User document. When the caller
    // explicitly marks this as a guest issuance (no account in this
    // organization — see credentialController.createCredential, which
    // applies the same guest_recipient gate and is the source of truth
    // for what gets persisted), skip the lookup instead of 404ing on
    // someone who was never supposed to have a User record.
    const [design, recipient, customFonts] = await Promise.all([
      Design.findOne({ design_code, organization_code: req.user.organization_code }).lean(),
      guest_recipient
        ? Promise.resolve(true)
        : User.findOne({ username: achiever_username, organization_code: req.user.organization_code }).lean(),
      OrganizationAsset.find({ organization_code: req.user.organization_code, asset_type: 'font' }).lean(),
    ]);
    if (!design) return res.status(404).json({ message: 'Design not found' });
    if (!recipient) return res.status(404).json({ message: 'Recipient not found' });
    // A draft or archived template isn't ready to issue from -- publish it
    // first (see designController.publishDesign). Missing status (a
    // template saved before this field existed, on the rare read path that
    // bypasses the migration's backfill) is treated as published, matching
    // the schema's own default and the explicit backward-compatibility
    // intent -- this must never retroactively block a template that
    // already worked.
    if (design.status && design.status !== 'published') {
      const reason = design.status === 'archived' ? 'archived' : 'still a draft';
      return res.status(409).json({ message: `This template is ${reason}. Publish it before issuing credentials from it.` });
    }
    // Custom-uploaded fonts (see models/organizationAsset.js) are referenced
    // by name from font_attributes.font_family exactly like a bundled font
    // would be -- the only difference the certificate service needs to
    // know is *where* to fetch the file from, so that's resolved here and
    // forwarded as font_url. A name with no matching upload just renders
    // through the certificate service's existing bundled-font lookup, same
    // as before this existed.
    const customFontUrlByName = new Map(customFonts.map(asset => [asset.name, asset.url]));

    const serviceUrl = process.env.CERTIFICATE_SERVICE_URL;
    const internalKey = process.env.CERTIFICATE_INTERNAL_KEY;
    if (!serviceUrl || !internalKey) {
      return res.status(503).json({ message: 'Certificate generator is not configured' });
    }
    const verificationBase = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
    if (!verificationBase) return res.status(503).json({ message: 'PUBLIC_APP_URL is not configured' });

    // Same YYYY-MM-DD shape credentialController.createCredential stores as
    // credential_issue_date, so the date printed on the image and the date
    // on the record are the same day and the same format.
    const issuedOn = new Date().toISOString().split('T')[0];
    const placeholderValues = {
      issue_date: issuedOn,
      recipient_name: achiever_username,
      credential_id: credential_code,
      credential_code,
      organization_name: design.organization_code,
    };

    const payload = {
      certificate_code: credential_code,
      template_url: internalTemplateUrl(design.template_url),
      text_attributes: design.text_attributes.map(attribute => ({
        ...attribute,
        // recipient_name always comes from achiever_username, never from
        // custom_fields (sanitizeCustomFields already drops that key for
        // the same reason). Any other text_title present in custom_fields
        // is an org-defined field the design editor let an admin add (see
        // models/designSchema.js's textAttributeSchema) -- falls back to
        // the design's own saved placeholder text when the caller didn't
        // supply a value for it.
        // Placeholders are filled last, so they work in the design's own
        // text AND in a value an admin supplied through custom_fields.
        text: fillPlaceholders(
          attribute.text_title === 'recipient_name'
            ? achiever_username
            : Object.prototype.hasOwnProperty.call(custom_fields, attribute.text_title)
              ? custom_fields[attribute.text_title]
              : attribute.text,
          placeholderValues,
        ),
        font_attributes: (attribute.font_attributes || []).map(fontAttr => {
          const customUrl = customFontUrlByName.get(fontAttr.font_family);
          return customUrl ? { ...fontAttr, font_url: internalTemplateUrl(customUrl) } : fontAttr;
        }),
      })),
      QR_CODE: {
        ...design.QR_CODE,
        ecoding_data: `${verificationBase}/verifications/credentials/${encodeURIComponent(credential_code)}`,
      },
      shapes: design.shapes || [],
      // Placed decorative images (asset library / AI-generated, see
      // models/designSchema.js's imageElementSchema) never went through
      // internalTemplateUrl() here, unlike template_url and font_url just
      // above -- so the certificate microservice, which can only reach
      // the storage service internally (TEMPLATE_ALLOWED_HOSTS=storage in
      // docker-compose.yml), rejected every image element on the real
      // public storage URL every design actually stores. Confirmed for
      // real: a real LMS-sync issuance failed with a 422 from the
      // microservice ("Certificate image element rejected") on exactly
      // this -- the template background itself loaded fine (it already
      // went through internalTemplateUrl()), only the placed image
      // didn't. Any design with a placed image was unissuable through
      // this path, not something specific to LMS sync.
      images: (design.images || []).map(image => ({ ...image, url: internalTemplateUrl(image.url) })),
    };

    const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/generate-certificate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Key': internalKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      // The status alone said nothing about WHY. The generator answers with a
      // precise validation detail (which field, which rule), and throwing it
      // away meant every rejection looked identical in the logs and took a
      // manual reproduction to diagnose. Truncated because a rejection body
      // is a diagnostic, not a payload dump.
      const detail = await response.text().catch(() => '');
      logger.error('certificate_generator_rejected', {
        status: response.status,
        detail: detail.slice(0, 500),
      });
      return res.status(502).json({ message: 'Certificate generation failed' });
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > 15 * 1024 * 1024) throw new Error('Generated certificate is too large');
    const image = Buffer.from(await response.arrayBuffer());
    if (image.length > 15 * 1024 * 1024 || !image.subarray(0, 8).equals(PNG_SIGNATURE)) {
      throw new Error('Certificate service returned an invalid image');
    }

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const filename = `credential-${crypto.randomBytes(16).toString('hex')}.png`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), image, { flag: 'wx' });
    return res.status(201).json({ url: publicFileUrl(filename) });
  } catch (error) {
    logger.error('certificate_generation_failed', { message: error.message });
    return res.status(500).json({ message: 'Certificate generation failed' });
  }
};

// Exported for tests: the placeholder substitution is data-driven and
// worth pinning on its own, separately from a full render.
exports.fillPlaceholders = fillPlaceholders;
