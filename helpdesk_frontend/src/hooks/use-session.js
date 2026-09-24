'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export function useSession() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    let active = true;
    apiFetch('/auth/profile', { redirectOnUnauthorized: false })
      .then(async response => {
        if (!response.ok) throw new Error('Session is not valid');
        const value = await response.json();
        if (active) setUser(value);
      })
      .catch(reason => { if (active) setError(reason); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return { user, loading, error };
}
