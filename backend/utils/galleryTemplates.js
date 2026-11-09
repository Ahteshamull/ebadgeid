// utils/galleryTemplates.js
//
// SEC-AUDIT / Point 8 (Credential Studio closure round): the 12 official
// gallery starter templates (see frontend/src/lib/template-library.js) ship
// as hand-built SVGs served by the *frontend's* static /public/templates/
// folder. Two independent problems made a gallery template unusable end to
// end without the admin manually re-uploading a background before publish:
//
//   1. Reachability -- the certificate microservice can only resolve
//      TEMPLATE_ALLOWED_HOSTS (the internal `storage` host, see
//      controllers/certificateController.js's internalTemplateUrl()), never
//      the frontend's own host. A design saved with a raw frontend SVG URL
//      as its background would always fail to render.
//   2. Format -- even if the frontend host were reachable, utils/main.py's
//      load_template_image() calls Pillow's Image.open() on the fetched
//      bytes, which only decodes raster formats. SVG (vector/XML) is not
//      one of them -- it would fail to open regardless of host.
//
// The fix is server-side materialization: this module holds the backend's
// OWN copy of the 12 official SVGs (assets/gallery-templates/, copied from
// the frontend's public folder, not fetched from it at request time -- a
// controlled, build-time asset source, never an arbitrary or frontend-
// supplied URL) and rasterizes the requested one to a real PNG on demand,
// which is then written through the exact same local-disk path every other
// upload already uses (see controllers/uploadController.js's UPLOAD_DIR),
// producing a normal storage-hosted /uploads/<file>.png URL. From the
// certificate microservice's point of view this is indistinguishable from
// any other background an admin uploaded directly -- no new allowlist
// entry, no frontend coupling, no arbitrary-URL fetch (and therefore no
// SSRF surface) was introduced to get here.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Resvg } = require('@resvg/resvg-js');

const ASSETS_DIR = path.join(__dirname, '..', 'assets', 'gallery-templates');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

// Canvas size every one of the 12 starters is hand-built for -- must match
// frontend/src/app/credentials/design-editor/page.js's CANVAS_W/CANVAS_H
// exactly, since loadStarterTemplate() never probes a gallery background's
// dimensions the way an uploaded image is (see that file's comment on why:
// an SVG with no explicit width/height can report unreliable naturalWidth/
// Height in some browsers).
const CANVAS_W = 900;
const CANVAS_H = 636;

// Mirrors the `id` field of every entry in
// frontend/src/lib/template-library.js -- kept as an explicit allowlist
// (not just "whatever's in the assets folder") so a request can never
// walk this into reading an arbitrary file off disk.
const GALLERY_TEMPLATE_IDS = [
  'classic-gold',
  'modern-minimal',
  'corporate-blue',
  'diploma-formal',
  'badge-circular',
  'badge-achievement',
  'elegant-emerald',
  'bold-crimson',
  'tech-gradient',
  'academic-navy',
  'star-badge',
  'ribbon-seal',
];
const GALLERY_TEMPLATE_ID_SET = new Set(GALLERY_TEMPLATE_IDS);

const fileUrl = (req, filename) => {
  const configuredBase = process.env.PUBLIC_STORAGE_BASE_URL?.replace(/\/$/, '');
  if (configuredBase) return `${configuredBase}/uploads/${filename}`;
  if (typeof req?.get === 'function') return `${req.protocol}://${req.get('host')}/uploads/${filename}`;
  return `/uploads/${filename}`;
};

// Renders template_id's canonical SVG to a fresh PNG file under the same
// uploads/ directory (and therefore the same public URL shape) as any
// other background, and returns its URL. Deliberately stateless -- no
// cross-organization cache keyed by template_id, so one org's materialized
// copy is never silently handed to another (each call, from any org,
// produces its own independent file on disk, same as if they'd uploaded it
// themselves). Rasterizing a ~1KB hand-built SVG is fast enough (single-
// digit milliseconds) that caching would only add invalidation risk for no
// measurable benefit.
function materializeGalleryTemplate(templateId, req) {
  if (!GALLERY_TEMPLATE_ID_SET.has(templateId)) {
    const error = new Error(`Unknown gallery template id: ${templateId}`);
    error.statusCode = 400;
    throw error;
  }
  const svgPath = path.join(ASSETS_DIR, `${templateId}.svg`);
  const svg = fs.readFileSync(svgPath); // safe: templateId is allowlist-checked above, never interpolated from an unchecked path segment

  // No forced background color -- every one of the 12 SVGs already paints
  // its own full-canvas opaque <rect> as the first element (verified by
  // reading all 12 files), so this renders exactly what the SVG declares,
  // nothing composited on top of it.
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: CANVAS_W } });
  const png = resvg.render().asPng();

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const filename = `gallery-${templateId}-${crypto.randomBytes(12).toString('hex')}.png`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), png, { flag: 'wx' });

  return { url: fileUrl(req, filename), width: CANVAS_W, height: CANVAS_H };
}

module.exports = { GALLERY_TEMPLATE_IDS, materializeGalleryTemplate };
