export function readInvitation(locationLike) {
  // Older links keep the token after #. Mail apps drop that part, so newer
  // links put it in the query string. The page removes it as soon as the
  // session cookie is saved.
  const fragment = new URLSearchParams((locationLike.hash || '').replace(/^#/, ''));
  const query = new URLSearchParams(locationLike.search || '');
  return {
    contractCode: locationLike.pathname.split('/').filter(Boolean).at(-1) || '',
    accessToken: fragment.get('accessToken') || query.get('accessToken') || ''
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
