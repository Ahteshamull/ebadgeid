// Outbound LMS sync is an SSRF boundary. The destination is configured by
// a tenant admin, not an infrastructure operator, so it must be limited to
// operator-approved HTTPS hostnames. This intentionally does not accept IP
// literals, localhost, credentials in URLs, or arbitrary ports.
const net = require('net');
const dns = require('dns');

const configuredHosts = () => String(process.env.LMS_SYNC_ALLOWED_HOSTS || '')
  .split(',')
  .map(value => value.trim().toLowerCase())
  .filter(Boolean);

const hostAllowed = (hostname, allowedHosts) => allowedHosts.some(pattern => {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1);
    return hostname.endsWith(suffix) && hostname !== suffix.slice(1);
  }
  return hostname === pattern;
});

function validateLmsSyncUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Object.assign(new Error('sync_api_url must be a valid absolute URL'), { statusCode: 400 });
  }
  const hostname = url.hostname.toLowerCase();
  const allowedHosts = configuredHosts();
  if (url.protocol !== 'https:' || url.username || url.password || url.port || net.isIP(hostname) || hostname === 'localhost') {
    throw Object.assign(new Error('sync_api_url must use HTTPS on an approved hostname without credentials or a custom port'), { statusCode: 400 });
  }
  if (allowedHosts.length === 0 || !hostAllowed(hostname, allowedHosts)) {
    throw Object.assign(new Error('sync_api_url host is not approved; configure LMS_SYNC_ALLOWED_HOSTS in the deployment'), { statusCode: 400 });
  }
  return url.toString().replace(/\/$/, '');
}

// IPv4 ranges that must never be a real sync target: loopback, RFC1918
// private space, link-local, and the cloud metadata address specifically
// (169.254.169.254 falls inside link-local anyway, called out by name
// since it's the actual, real-world target this kind of check exists to
// stop). IPv6 equivalents (loopback, unique-local, link-local) alongside.
function isPrivateOrReservedIp(address, family) {
  if (family === 4) {
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true; // malformed -- fail closed
    const [a, b] = parts;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 0) return true; // "this network"
    return false;
  }
  const lower = address.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local (fc00::/7)
  if (lower.startsWith('::ffff:')) return isPrivateOrReservedIp(lower.slice(7), 4); // IPv4-mapped
  return false;
}

// Security fix, found during an audit round: validateLmsSyncUrl only ever
// checked the *hostname* in the URL -- an approved hostname's DNS record
// can point anywhere, including at the moment of the actual request (DNS
// rebinding), and none of that was ever re-checked against the resolved
// IP. Called immediately before every fetch, not just once at config-save
// time, since a DNS answer can legitimately change between requests.
async function assertResolvesToPublicAddress(hostname) {
  const addresses = await new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (error, results) => {
      if (error) return reject(Object.assign(new Error(`sync_api_url host could not be resolved: ${error.message}`), { statusCode: 502 }));
      resolve(results);
    });
  });
  if (addresses.length === 0) {
    throw Object.assign(new Error('sync_api_url host did not resolve to any address'), { statusCode: 502 });
  }
  const unsafe = addresses.find(({ address, family }) => isPrivateOrReservedIp(address, family));
  if (unsafe) {
    throw Object.assign(new Error('sync_api_url host resolves to a private or reserved address'), { statusCode: 502 });
  }
}

module.exports = { validateLmsSyncUrl, assertResolvesToPublicAddress };
