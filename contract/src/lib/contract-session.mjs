export function readInvitation(locationLike) {
  // Only the fragment is ever read for the access token. The fragment
  // (the part after '#') is never sent to the server in the request line,
  // never logged by servers/proxies, and never forwarded in a Referer
  // header — that's the whole point of putting the token there instead of
  // the query string. A query-string fallback here would silently defeat
  // that guarantee for any link (malformed, mis-forwarded by an email
  // scanner, etc.) that ends up with `?accessToken=` instead of
  // `#accessToken=`, so it's deliberately not supported.
  const fragment = new URLSearchParams((locationLike.hash || '').replace(/^#/, ''));
  return {
    contractCode: locationLike.pathname.split('/').filter(Boolean).at(-1) || '',
    accessToken: fragment.get('accessToken') || ''
  };
}

export async function exchangeInvitation(apiBaseUrl, accessToken, fetchImpl = fetch) {
  const response = await fetchImpl(`${apiBaseUrl}/contracts/access-session`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: accessToken })
  });
  if (!response.ok) throw new Error('Invalid or expired contract invitation');
}
