const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const logger = require('../utils/logger');
const { sanitizeSvg } = require('../utils/sanitizeSvg');
const StoredFile = require('../models/StoredFile');

// Both file-type v19+ and pdf-to-img are ESM-only packages (no CommonJS
// "require" export — pdf-to-img even has top-level await, which makes
// require() fail outright with ERR_REQUIRE_ASYNC_MODULE, not just a
// resolution error). Dynamic import() is the standard way to consume an
// ESM-only package from a CommonJS file without converting this whole
// backend to ESM.
let _fileTypeFromBuffer = null;
const getFileTypeFromBuffer = async () => {
  if (!_fileTypeFromBuffer) {
    const mod = await import('file-type');
    _fileTypeFromBuffer = mod.fileTypeFromBuffer;
  }
  return _fileTypeFromBuffer;
};

let _renderPdf = null;
const getRenderPdf = async () => {
  if (!_renderPdf) {
    const mod = await import('pdf-to-img');
    _renderPdf = mod.pdf;
  }
  return _renderPdf;
};

// Uploaded backgrounds and converted PDF pages live here, served statically
// by api.js at /uploads/<filename>. This used to not exist at all — the
// design editor only accepted an image URL you had to host somewhere else
// yourself, or (in a later pass) embedded the image as a base64 data URI
// directly inside the saved design document, which bloats the document and
// isn't reusable/CDN-able. This is a real, if simple, alternative: files on
// disk under a persistent volume. Swapping this for S3/GCS later means
// changing this one module, not the API contract (the response shape stays
// { url }).
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
// Signed contracts are legal documents and must never share the public
// /uploads directory used by certificate templates and avatars.
const PRIVATE_CONTRACT_DIR = process.env.PRIVATE_CONTRACT_UPLOAD_DIR || path.join(__dirname, '..', 'private-contracts');
if (!fs.existsSync(PRIVATE_CONTRACT_DIR)) fs.mkdirSync(PRIVATE_CONTRACT_DIR, { recursive: true });

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'image/svg+xml']);
// Wide enough that a rasterized SVG still looks sharp behind the editor's
// 900px canvas and in print, without producing enormous files.
const SVG_RASTER_WIDTH = 1800;
// Enough for a brand book or a deck of templates; past this a PDF is a
// document, not a design source.
const MAX_PDF_PAGES = 20;
const SAFE_TEXT_MIME = new Set(['text/markdown', 'text/plain']);
const MAX_FONT_SIZE = 5 * 1024 * 1024; // 5 MB — real fonts are small; generous headroom over the ~100KB bundled set
// TTF and OTF only, deliberately. The certificate renderer loads a custom
// font with PIL's ImageFont.truetype (utils/main.py's get_font), which
// cannot read WOFF or WOFF2 -- those are web-delivery formats. Accepting
// them meant an admin uploaded a font, the system stored it, the design
// referenced it, and the certificate was then rendered in a COMPLETELY
// DIFFERENT typeface: the loader failed, logged a warning nobody reads, and
// silently fell back to a bundled font. Refusing them up front, with a
// message that says what to upload instead, is the honest behaviour.
const ALLOWED_FONT_MIME = new Set(['font/ttf', 'font/otf']);
const RENDERER_UNSUPPORTED_FONT_MIME = new Set(['font/woff', 'font/woff2']);

// multer.memoryStorage() — the file is validated (real content sniffing,
// not the client-declared Content-Type, which is trivially spoofable)
// before anything ever touches disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
});

exports.uploadMiddleware = upload.single('file');
exports.signedPdfUploadMiddleware = upload.single('file');
exports.fontUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FONT_SIZE },
}).single('file');

const fileUrl = (req, filename, storedFile) => {
  const configuredBase = process.env.PUBLIC_STORAGE_BASE_URL?.replace(/\/$/, '');
  // New files are addressed through the authorization-aware storage route.
  // Legacy /uploads URLs remain separately controlled during migration.
  if (storedFile && configuredBase) return `${configuredBase}/api/files/${encodeURIComponent(storedFile.storage_key)}`;
  if (configuredBase) return `${configuredBase}/uploads/${filename}`;
  if (typeof req.get === 'function') return `${req.protocol}://${req.get('host')}/uploads/${filename}`;
  return `/uploads/${filename}`;
};

const uploadOrganization = req => req.uploadIdentity?.organization_code
  || req.uploadIdentity?.org_code
  || req.user?.organization_code
  || req.user?.org_code
  || null;

const requestedVisibility = req => req.body?.visibility === 'private' ? 'private' : 'public';

async function recordStoredFile(req, filename, buffer, mimeType, purpose) {
  const organizationCode = uploadOrganization(req);
  // Unit tests and legacy tooling can run without Mongo. The production
  // storage service always receives MONGO_URI through Compose, so a real
  // deployment never takes this compatibility branch.
  if (!organizationCode || !process.env.MONGO_URI) return null;
  return StoredFile.create({
    storage_key: filename,
    organization_code: organizationCode,
    original_filename: req.file?.originalname || filename,
    mime_type: mimeType,
    size_bytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    purpose,
    // Existing clients keep working during the staged cut-over. New
    // callers explicitly request private storage; the main API and its
    // design editor do that today. The metadata route remains the canonical
    // URL for both visibility levels, so public legacy static serving can be
    // disabled later without rewriting stored references.
    visibility: requestedVisibility(req),
    uploaded_by: req.uploadIdentity?.username || req.user?.username || null,
  });
}

const privateContractFileUrl = (req, contractCode, filename) => {
  const configuredBase = process.env.PUBLIC_API_BASE_URL?.replace(/\/$/, '');
  const base = configuredBase || `${req.protocol}://${req.get('host')}`;
  return `${base}/api/contracts/${encodeURIComponent(contractCode)}/private-files/${filename}`;
};

const privateContractFilename = filename => /^signed-[a-f0-9]{32}\.pdf$/i.test(filename || '');

// SVG has no magic bytes, so file-type cannot detect it -- "is this really
// an SVG" has to be answered by looking at the text, and the filename is
// not evidence of anything. Anything that gets past this still has to
// survive sanitizeSvg() and then be re-rendered from scratch by resvg, so
// this only has to decide "should we try to treat this as an SVG at all".
const looksLikeSvg = (file) => {
  if (file.buffer.includes(0)) return false;
  const text = file.buffer.toString('utf8');
  // Reject anything that is not valid UTF-8 in the first place -- a
  // lossy decode would mean we sanitize different bytes than we received.
  if (!Buffer.from(text, 'utf8').equals(file.buffer)) return false;
  return /<svg[\s>]/i.test(text.slice(0, 4096));
};

const isSafeMarkdown = (file) => {
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (extension !== '.md' || !SAFE_TEXT_MIME.has(file.mimetype)) return false;
  if (file.buffer.includes(0)) return false;
  return Buffer.from(file.buffer.toString('utf8'), 'utf8').equals(file.buffer);
};

exports.handleUpload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded (expected multipart field "file")' });
    }

    // Sniff the real file type from its actual bytes — the client-sent
    // req.file.mimetype comes from the browser's Content-Type header,
    // which is just a string the uploader controls and proves nothing.
    const fileTypeFromBuffer = await getFileTypeFromBuffer();
    let detected = await fileTypeFromBuffer(req.file.buffer);
    let realMime = detected?.mime;
    if (!realMime && isSafeMarkdown(req.file)) {
      detected = { mime: 'text/markdown', ext: 'md' };
      realMime = detected.mime;
    }
    // An SVG reaches here in one of two states. Written bare, file-type
    // detects nothing (SVG has no magic bytes). Written with the XML
    // declaration that Illustrator and Inkscape both emit
    // (`<?xml version="1.0"?>`), file-type reports application/xml -- and
    // treating that as "not an allowed type" would reject the majority of
    // real-world SVG files with a blanket 415, which is exactly what
    // happened before this branch also accepted the XML case.
    if ((!realMime || realMime === 'application/xml' || realMime === 'text/xml') && looksLikeSvg(req.file)) {
      detected = { mime: 'image/svg+xml', ext: 'svg' };
      realMime = detected.mime;
    }
    if (!realMime || (!ALLOWED_MIME.has(realMime) && realMime !== 'text/markdown')) {
      return res.status(415).json({
        message: 'Unsupported file type. Allowed: PNG, JPEG, WEBP or SVG images, or PDF.',
      });
    }

    // 128 bits of entropy even before the filename reaches a URL. This is
    // defense in depth only; authorization must never rely on obscurity.
    const fileId = crypto.randomBytes(16).toString('hex');
    const isPdf = realMime === 'application/pdf';

    if (isPdf) {
      // The editor's canvas needs a raster image for its CSS background —
      // a PDF can't be used directly. Rendered at 2x scale for reasonable
      // print/screen sharpness by a pure-JS renderer (pdfjs-dist under the
      // hood — no system-level poppler/imagemagick binary required, which
      // keeps this reliable across hosting environments without extra OS
      // packages).
      //
      // Every page is converted, not just the first. A brand book or a
      // multi-template deck is a perfectly ordinary thing to be handed, and
      // silently taking page 1 meant an admin whose certificate was on page
      // 3 had no way to reach it at all -- they had to go and split the PDF
      // themselves. `pages` lets the editor offer a page picker; `url`
      // still points at page 1 so every existing caller keeps working
      // unchanged.
      const tmpPdfPath = path.join(UPLOAD_DIR, `${fileId}.pdf`);
      fs.writeFileSync(tmpPdfPath, req.file.buffer, { flag: 'wx' });

      const pageBuffers = [];
      try {
        const renderPdf = await getRenderPdf();
        const doc = await renderPdf(tmpPdfPath, { scale: 2 });
        for await (const image of doc) {
          pageBuffers.push(image);
          // A cap, not a page limit on the source document: beyond this a
          // file is a book, not a template deck, and converting it would
          // tie up the request and the disk for no one's benefit. Page 1
          // is still returned, so such a PDF is usable rather than refused.
          if (pageBuffers.length >= MAX_PDF_PAGES) break;
        }
      } catch (conversionError) {
        fs.unlinkSync(tmpPdfPath);
        logger.error('pdf_conversion_failed', { message: conversionError.message });
        return res.status(422).json({ message: 'Could not read this PDF — it may be corrupted or password-protected.' });
      }

      if (pageBuffers.length === 0) {
        fs.unlinkSync(tmpPdfPath);
        return res.status(422).json({ message: 'The PDF has no pages to convert.' });
      }

      // Page 1 keeps the bare `${fileId}.png` name it has always had, so
      // URLs already stored against existing designs stay valid.
      //
      // The page marker for pages 2+ is a PREFIX, not a suffix. Managed
      // storage keys must end in the 32 hex characters of the file id
      // immediately before the extension (STORAGE_KEY_PATTERN in
      // utils/managedStorage.js, which also allows a `profile-`/`ai-` style
      // prefix). `<id>-p2.png` breaks that invariant, so every page after
      // the first was rejected by the storage service and rendered as a
      // broken image in the page picker -- found by driving the picker in a
      // real browser, where page 1 loaded and pages 2 and 3 did not.
      const pageAssets = [];
      for (let index = 0; index < pageBuffers.length; index++) {
        const pageFilename = index === 0 ? `${fileId}.png` : `p${index + 1}-${fileId}.png`;
        fs.writeFileSync(path.join(UPLOAD_DIR, pageFilename), pageBuffers[index], { flag: 'wx' });
        const asset = await recordStoredFile(req, pageFilename, pageBuffers[index], 'image/png', 'upload');
        pageAssets.push({ page: index + 1, url: fileUrl(req, pageFilename, asset) });
      }

      const pdfAsset = await recordStoredFile(req, `${fileId}.pdf`, req.file.buffer, 'application/pdf', 'pdf_source');
      return res.status(201).json({
        url: pageAssets[0].url,
        original_pdf_url: fileUrl(req, `${fileId}.pdf`, pdfAsset),
        type: 'pdf-converted',
        pages: pageAssets,
        page_count: pageAssets.length,
      });
    }

    if (realMime === 'image/svg+xml') {
      // An uploaded SVG is never stored as an SVG. It is sanitized, then
      // re-rendered to a PNG by resvg and only the PNG is kept, so nothing
      // a browser could execute is ever served back -- and the rest of the
      // pipeline (the editor canvas, the Python certificate compositor)
      // works on rasters anyway, so there is nothing to gain by keeping the
      // original. resvg itself runs no scripts and fetches no URLs.
      const sanitized = sanitizeSvg(req.file.buffer.toString('utf8'));
      if (!sanitized.ok) {
        logger.warn('svg_upload_rejected', { reason: sanitized.reason });
        return res.status(422).json({ message: `This SVG was rejected: ${sanitized.reason}.` });
      }
      if (sanitized.removed.length > 0) {
        logger.warn('svg_sanitized', { removed_count: sanitized.removed.length });
      }

      let svgPngBuffer;
      try {
        const { Resvg } = require('@resvg/resvg-js');
        const resvg = new Resvg(sanitized.svg, { fitTo: { mode: 'width', value: SVG_RASTER_WIDTH } });
        svgPngBuffer = resvg.render().asPng();
      } catch (renderError) {
        logger.error('svg_render_failed', { message: renderError.message });
        return res.status(422).json({ message: 'Could not render this SVG — it may be malformed.' });
      }

      const svgPngFilename = `${fileId}.png`;
      fs.writeFileSync(path.join(UPLOAD_DIR, svgPngFilename), svgPngBuffer, { flag: 'wx' });
      const svgAsset = await recordStoredFile(req, svgPngFilename, svgPngBuffer, 'image/png', 'upload');
      return res.status(201).json({
        url: fileUrl(req, svgPngFilename, svgAsset),
        type: 'svg-converted',
        // Named so the admin can be told their file was cleaned rather than
        // finding out only by noticing something missing from the render.
        removed: sanitized.removed,
      });
    }

    // Plain image — store as-is under its real detected extension
    // (ignores whatever extension the original filename had).
    const filename = `${fileId}.${detected.ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), req.file.buffer, { flag: 'wx' });
    const asset = await recordStoredFile(req, filename, req.file.buffer, realMime, 'upload');

    res.status(201).json({
      url: fileUrl(req, filename, asset),
      type: realMime === 'text/markdown' ? 'markdown' : 'image',
    });
  } catch (error) {
    // The stack matters here. An upload can fail in half a dozen places --
    // content sniffing, SVG sanitization, the SVG/PDF rasterizers, the disk
    // write, the metadata record -- and logging only the message meant a
    // failure like "Invalid regular expression flags" gave no clue which of
    // them produced it. Trimmed to the frames that identify the origin.
    logger.error('upload_failed', {
      message: error.message,
      stack: (error.stack || '').split('\n').slice(0, 5).join(' | '),
    });
    res.status(500).json({ message: 'Upload failed', details: error.message });
  }
};

exports.handleProfileImageUpload = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No profile image uploaded' });
    const fileTypeFromBuffer = await getFileTypeFromBuffer();
    const detected = await fileTypeFromBuffer(req.file.buffer);
    if (!detected || !['image/png', 'image/jpeg', 'image/webp'].includes(detected.mime)) {
      return res.status(415).json({ message: 'Profile image must be PNG, JPEG, or WEBP' });
    }
    const filename = `profile-${crypto.randomBytes(16).toString('hex')}.${detected.ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), req.file.buffer, { flag: 'wx' });
    const asset = await recordStoredFile(req, filename, req.file.buffer, detected.mime, 'profile');
    return res.status(201).json({ url: fileUrl(req, filename, asset), type: 'profile-image' });
  } catch (error) {
    logger.error('profile_upload_failed', { message: error.message });
    return res.status(500).json({ message: 'Profile image upload failed' });
  }
};

exports.handleFontUpload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No font uploaded (expected multipart field "file")' });
    }
    const fileTypeFromBuffer = await getFileTypeFromBuffer();
    const detected = await fileTypeFromBuffer(req.file.buffer);
    if (!detected || !ALLOWED_FONT_MIME.has(detected.mime)) {
      // Name the reason for the two formats people most often try, so the
      // admin knows to re-export rather than assuming the upload is broken.
      const message = detected && RENDERER_UNSUPPORTED_FONT_MIME.has(detected.mime)
        ? 'WOFF and WOFF2 are web-only formats the certificate renderer cannot draw with. Upload the same font as TTF or OTF.'
        : 'Unsupported font type. Allowed: TTF, OTF.';
      return res.status(415).json({ message });
    }
    const filename = `font-${crypto.randomBytes(16).toString('hex')}.${detected.ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), req.file.buffer, { flag: 'wx' });
    const asset = await recordStoredFile(req, filename, req.file.buffer, detected.mime, 'font');
    return res.status(201).json({ url: fileUrl(req, filename, asset), mime: detected.mime, type: 'font' });
  } catch (error) {
    logger.error('font_upload_failed', { message: error.message });
    return res.status(500).json({ message: 'Font upload failed' });
  }
};

const AI_IMAGE_HOST = 'image.pollinations.ai';
const AI_IMAGE_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AI_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

// Free, keyless AI image/background generation (https://pollinations.ai) --
// the request always goes to this one hardcoded host, so the prompt text
// (the only user-controlled input) can never redirect the request
// anywhere else; it's URL-encoded as a path segment, not interpolated
// into a shell command or a template, so it carries no injection risk
// beyond what any third-party API call already has. Width/height are
// clamped the same way the certificate-service's own image handling caps
// its inputs (utils/main.py's MAX_REMOTE_BYTES).
exports.handleGenerateImage = async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt || prompt.length > 500) {
      return res.status(400).json({ message: 'prompt is required and must be 500 characters or fewer' });
    }
    const width = Math.min(Math.max(parseInt(req.body?.width, 10) || 1024, 256), 2048);
    const height = Math.min(Math.max(parseInt(req.body?.height, 10) || 1024, 256), 2048);
    const seed = Math.floor(Math.random() * 1_000_000_000);

    const genUrl = `https://${AI_IMAGE_HOST}/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true&seed=${seed}`;
    const response = await fetch(genUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      logger.error('ai_image_generation_upstream_failed', { status: response.status });
      return res.status(502).json({ message: 'Image generation service is unavailable' });
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > AI_IMAGE_MAX_BYTES) {
      return res.status(502).json({ message: 'Generated image is too large' });
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > AI_IMAGE_MAX_BYTES) {
      return res.status(502).json({ message: 'Generated image is too large' });
    }

    const fileTypeFromBuffer = await getFileTypeFromBuffer();
    const detected = await fileTypeFromBuffer(buffer);
    if (!detected || !AI_IMAGE_ALLOWED_MIME.has(detected.mime)) {
      return res.status(502).json({ message: 'Image generation service returned an unsupported file type' });
    }

    const filename = `ai-${crypto.randomBytes(16).toString('hex')}.${detected.ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer, { flag: 'wx' });
    const asset = await recordStoredFile(req, filename, buffer, detected.mime, 'ai_generated');
    return res.status(201).json({ url: fileUrl(req, filename, asset), type: 'ai-generated', prompt });
  } catch (error) {
    logger.error('ai_image_generation_failed', { message: error.message });
    return res.status(502).json({ message: 'Image generation failed' });
  }
};

exports.handleSignedPdfUpload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No PDF uploaded (expected multipart field "file")' });
    }
    const fileTypeFromBuffer = await getFileTypeFromBuffer();
    const detected = await fileTypeFromBuffer(req.file.buffer);
    if (detected?.mime !== 'application/pdf') {
      return res.status(415).json({ message: 'Signed contract must be a real PDF file' });
    }
    const contractCode = req.params.contract_code;
    if (!contractCode || !req.contract || req.contract.contract_code !== contractCode) {
      return res.status(403).json({ message: 'Contract access is required' });
    }
    const filename = `signed-${crypto.randomBytes(16).toString('hex')}.pdf`;
    fs.writeFileSync(path.join(PRIVATE_CONTRACT_DIR, filename), req.file.buffer, { flag: 'wx', mode: 0o600 });
    return res.status(201).json({
      url: privateContractFileUrl(req, contractCode, filename),
      type: 'signed-contract',
    });
  } catch (error) {
    logger.error('signed_pdf_upload_failed', { message: error.message });
    return res.status(500).json({ message: 'Signed PDF upload failed' });
  }
};

// Legal/signed PDFs are intentionally unreachable through the public
// storage service -- this is the only way to read one back, gated on
// real contract access AND on the requested filename actually being
// referenced by THAT specific contract's own signed_copies (so an
// authenticated party to contract A can never fetch contract B's signed
// PDF just by knowing/guessing its filename).
exports.downloadSignedPdf = async (req, res) => {
  const { filename } = req.params;
  if (!privateContractFilename(filename)) return res.status(404).json({ message: 'File not found' });
  const referencedByContract = (req.contract?.signed_copies || []).some(copy => {
    try {
      return new URL(copy.signed_copy_url).pathname.endsWith(`/private-files/${filename}`);
    } catch {
      return false;
    }
  });
  if (!referencedByContract) return res.status(404).json({ message: 'File not found' });
  const fullPath = path.join(PRIVATE_CONTRACT_DIR, filename);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ message: 'File not found' });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  return res.sendFile(fullPath);
};
