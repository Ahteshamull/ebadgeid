export function apiUrl(baseUrl, path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

export function shouldRedirectForSession(status) {
  return status === 401 || status === 403;
}
