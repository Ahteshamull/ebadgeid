'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

let cachedSession = null;
let sessionFetchPromise = null;

export function clearSessionCache() {
  cachedSession = null;
  sessionFetchPromise = null;
}

export function setCachedSession(session) {
  cachedSession = session;
}

export function useSession() {
  const [session, setSession] = useState(cachedSession);
  const [loading, setLoading] = useState(!cachedSession);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    if (cachedSession) {
      setSession(cachedSession);
      setLoading(false);
      return;
    }

    if (!sessionFetchPromise) {
      sessionFetchPromise = apiFetch('/auth/me', { redirectOnUnauthorized: false })
        .then(async (response) => {
          if (!response.ok) throw new Error('Unable to load session');
          const value = await response.json();
          cachedSession = value;
          return value;
        })
        .finally(() => {
          sessionFetchPromise = null;
        });
    }

    sessionFetchPromise
      .then((value) => {
        if (active) {
          setSession(value);
          setLoading(false);
        }
      })
      .catch((reason) => {
        if (active) {
          setError(reason);
          setLoading(false);
        }
      });

    return () => { active = false; };
  }, []);

  return { session, loading, error };
}
