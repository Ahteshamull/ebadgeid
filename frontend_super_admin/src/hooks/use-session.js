'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

const SessionContext = createContext({
  session: null,
  loading: true,
  error: null,
  refresh: async () => {},
});

// SA-01/SA-06 fix: Header, Sidebar, and every layout.js in this app used to
// each read `localStorage.getItem('username'/'role'/'token')` independently
// and do their own bare `fetch()` (no auth header at all on some of them,
// e.g. Header's/Sidebar's own `/users/username/:username` call) -- once
// login stopped writing to localStorage (see auth/login/page.js), every one
// of those reads returns null and the whole app breaks ("Failed to load
// user data"). This is the single shared /auth/me call the whole app now
// uses instead, mirroring the already-proven pattern from the sibling
// `frontend` and `version_two/ebadgeid/frontend` apps -- including a real
// fetch timeout (AbortController), which the latter's copy of this exact
// pattern was missing and is the leading unconfirmed hypothesis for an
// infinite "Checking authentication..." spinner seen there in production.
export function SessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await apiFetch('/auth/me', { redirectOnUnauthorized: false, signal: controller.signal });
      if (!response.ok) {
        setSession(null);
        throw new Error(response.status === 429
          ? 'Too many auth attempts, please try again later.'
          : 'Unable to load session');
      }
      const value = await response.json();
      setSession(value);
      return value;
    } catch (reason) {
      setSession(null);
      setError(reason?.name === 'AbortError' ? new Error('Session check timed out. Please refresh.') : reason);
      return null;
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <SessionContext.Provider value={{ session, loading, error, refresh }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
