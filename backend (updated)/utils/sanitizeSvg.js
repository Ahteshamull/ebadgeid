// utils/sanitizeSvg.js
//
// Turns an uploaded SVG into one that is safe to hand to a renderer, or
// refuses it outright.
//
// An SVG is not an image file, it is an XML document, and browsers execute
// it: <script>, on* event handlers, <foreignObject> carrying raw HTML,
// javascript: URLs, and external references that turn a certificate design
// into an SSRF probe or a beacon on whoever opens it. file-type cannot help
// here either -- SVG has no magic bytes, so "is this really an SVG" has to
// be decided by parsing, not by sniffing, and never by trusting a filename.
//
// The posture is allowlist, not blocklist: anything not positively
// recognized as a drawing construct is removed. A blocklist of known-bad
// tags is exactly what gets bypassed by the next spelling of the same idea.
//
// Callers rasterize the result -- controllers/uploadController.js stores a
// PNG rendered by @resvg/resvg-js and never the SVG itself. That makes this
// belt AND braces: even a bug here cannot produce a stored document a
// browser will execute. Both layers are deliberate; the sanitizer also
// protects the renderer, which is a native library being handed an
// attacker-controlled document.

// Drawing constructs only. No <script>, no <foreignObject> (an HTML escape
// hatch), no <a> (navigation), no <handler>, no <set>/<animate> (they can
// set attributes at runtime, including href).
const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'metadata',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textpath',
  'image',
  'lineargradient', 'radialgradient', 'stop', 'pattern',
  'clippath', 'mask', 'filter',
  'fegaussianblur', 'feoffset', 'feblend', 'fecolormatrix', 'feflood',
  'femerge', 'femergenode', 'fecomposite', 'fedropshadow',
  'marker', 'style',
]);

// Presentation and geometry. Deliberately excludes every event handler and
// every attribute that can name an external resource other than the two
// href spellings, which get their own value check below.
const ALLOWED_ATTRIBUTES = new Set([
  'id', 'class', 'style', 'transform', 'viewbox', 'width', 'height', 'x', 'y',
  'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-miterlimit', 'opacity', 'color', 'display', 'visibility',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor',
  'letter-spacing', 'word-spacing', 'dominant-baseline', 'alignment-baseline',
  'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform',
  'spreadmethod', 'patternunits', 'patterncontentunits', 'clip-path', 'clip-rule',
  'mask', 'filter', 'preserveaspectratio', 'xmlns', 'xmlns:xlink', 'version',
  'stddeviation', 'in', 'in2', 'result', 'mode', 'type', 'values', 'flood-color',
  'flood-opacity', 'dx', 'dy', 'markerwidth', 'markerheight', 'refx', 'refy',
  'orient', 'markerunits', 'maskunits', 'filterunits', 'primitiveunits',
  'href', 'xlink:href',
]);

// Only a same-document fragment (#gradient-1, how <use> and gradients
// legitimately refer to each other) or an already-inlined raster. Anything
// that would make the renderer -- or a browser -- reach out to a URL is
// refused: that is the SSRF/beacon case, and a certificate design has no
// reason to need it.
const SAFE_FRAGMENT = /^#[A-Za-z0-9_.:-]+$/;
const SAFE_DATA_IMAGE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i;

const isSafeHref = (value) => {
  const trimmed = String(value).trim();
  return SAFE_FRAGMENT.test(trimmed) || SAFE_DATA_IMAGE.test(trimmed);
};

// url(#local-id) is how fill/clip-path/mask/filter reference defs in the
// same document. url(http://...) is not, and neither is anything that
// resolves to a script URL.
const hasUnsafeUrlReference = (value) => {
  for (const match of String(value).matchAll(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)) {
    if (!SAFE_FRAGMENT.test(match[2].trim())) return true;
  }
  return /(?:javascript|vbscript)\s*:/i.test(value) || /expression\s*\(/i.test(value);
};

const escapeForRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {string} source raw SVG text
 * @returns {{ ok: true, svg: string, removed: string[] } | { ok: false, reason: string }}
 */
function sanitizeSvg(source) {
  if (typeof source !== 'string' || source.length === 0) {
    return { ok: false, reason: 'empty file' };
  }
  // A NUL byte means this is not the text document it claims to be.
  if (source.includes('\0')) {
    return { ok: false, reason: 'not a text document' };
  }

  // Entity and DOCTYPE declarations are refused rather than stripped: they
  // are how both XXE (reading files off the server) and billion-laughs
  // expansion work, and no certificate design needs one.
  if (/<!DOCTYPE/i.test(source) || /<!ENTITY/i.test(source)) {
    return { ok: false, reason: 'XML entity and DOCTYPE declarations are not allowed' };
  }
  // CDATA is the standard way to smuggle a payload past a naive tag filter.
  if (/<!\[CDATA\[/i.test(source)) {
    return { ok: false, reason: 'CDATA sections are not allowed' };
  }

  let working = source.replace(/<\?xml[^>]*\?>/gi, '');
  if (/<\?/.test(working)) {
    return { ok: false, reason: 'XML processing instructions are not allowed' };
  }

  working = working.replace(/<!--[\s\S]*?-->/g, '');

  if (!/<svg[\s>]/i.test(working)) {
    return { ok: false, reason: 'this file is not an SVG' };
  }

  const removed = [];

  const dropElementWithContent = (text, tagPattern) => text
    .replace(new RegExp(`<${tagPattern}\\b[^>]*>[\\s\\S]*?<\\/${tagPattern}\\s*>`, 'gi'), '')
    .replace(new RegExp(`<${tagPattern}\\b[^>]*\\/>`, 'gi'), '')
    .replace(new RegExp(`<\\/?${tagPattern}\\b[^>]*>`, 'gi'), '');

  // Everything not on the allowlist, found by looking at what the document
  // actually contains rather than by guessing which bad tags to name.
  const presentTags = new Set(
    [...working.matchAll(/<\s*\/?\s*([A-Za-z][A-Za-z0-9:._-]*)/g)].map((m) => m[1].toLowerCase()),
  );
  for (const tag of presentTags) {
    const bare = tag.includes(':') ? tag.split(':').pop() : tag;
    if (ALLOWED_ELEMENTS.has(bare)) continue;
    removed.push(`<${tag}>`);
    working = dropElementWithContent(working, escapeForRegex(tag));
  }

  // Now scrub the attributes of what survives.
  working = working.replace(/<([A-Za-z][A-Za-z0-9:._-]*)((?:\s+[^<>]*?)?)(\/?)>/g,
    (whole, tagName, attributeText, selfClose) => {
      if (!attributeText || !attributeText.trim()) return `<${tagName}${selfClose}>`;
      const kept = [];
      const attributePattern = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
      let match;
      while ((match = attributePattern.exec(attributeText)) !== null) {
        const name = match[1].toLowerCase();
        const value = match[3] ?? match[4] ?? match[5] ?? '';

        if (name.startsWith('on')) { removed.push(name); continue; }
        if (!ALLOWED_ATTRIBUTES.has(name)) { removed.push(name); continue; }
        if ((name === 'href' || name === 'xlink:href') && !isSafeHref(value)) {
          removed.push(`${name} (external reference)`);
          continue;
        }
        if (hasUnsafeUrlReference(value)) { removed.push(`${name} (external reference)`); continue; }

        // Re-quote and re-escape so a value can never break out of its own
        // attribute and become markup.
        const safeValue = String(value)
          .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
          .replace(/</g, '&lt;').replace(/>/g, '&gt;');
        kept.push(`${match[1]}="${safeValue}"`);
      }
      return `<${tagName}${kept.length ? ' ' + kept.join(' ') : ''}${selfClose}>`;
    });

  // Last check on the finished document: if any of this is still present,
  // something above did not do its job and the file must not be used.
  //
  // Run against the markup with every quoted attribute VALUE removed. By
  // this point values are escaped (no raw <, >, or quote can remain inside
  // one), so stripping them is reliable -- and necessary: a legitimate
  // label reading `onclick=` or a colour escaped to `fill="red&quot;
  // onload=&quot;alert(1)"` is inert text, and tripping on it would refuse
  // a perfectly safe file while proving nothing about actual active
  // content. What must be caught is a handler in ATTRIBUTE-NAME position,
  // which is exactly what survives this strip.
  const markupOnly = working.replace(/=\s*"[^"]*"/g, '=""').replace(/=\s*'[^']*'/g, "=''");
  if (/<\s*script/i.test(markupOnly) || /\son[a-z]+\s*=/i.test(markupOnly) || /javascript\s*:/i.test(markupOnly)) {
    return { ok: false, reason: 'this SVG contains active content that could not be removed safely' };
  }
  if (!/<svg[\s>]/i.test(working)) {
    return { ok: false, reason: 'nothing drawable was left after removing unsafe content' };
  }

  return { ok: true, svg: working.trim(), removed };
}

module.exports = { sanitizeSvg, ALLOWED_ELEMENTS, ALLOWED_ATTRIBUTES };
