// utils/languageCookie.js

export const setLanguageCookie = (langCode) => {
  const expiry = 365 * 24 * 60 * 60; // 1 year
  // Was `domain=.soraroam.com` — hardcoded to a domain that doesn't match
  // wherever this app is actually served from. Browsers reject setting a
  // cookie for a domain that doesn't match (or isn't a parent of) the
  // current page's host, so this cookie was silently never being set at
  // all — the "remember my language" feature never worked. Omitting
  // `domain` lets the browser default to the current host, which is
  // correct regardless of which environment (dev/staging/prod) this runs
  // on, without hardcoding a domain here at all.
  document.cookie = `lang=${langCode}; path=/; max-age=${expiry}; Secure; SameSite=Lax`;
};

export const getLanguageCookie = () => {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(^| )lang=([^;]+)/);
  return match ? match[2] : null;
};