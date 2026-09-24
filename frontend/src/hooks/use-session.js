'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export function useSession() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    apiFetch('/auth/me')
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load session');
        const value = await response.json();
        if (active) setSession(value);
      })
      .catch((reason) => { if (active) setError(reason); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return { session, loading, error };
}
