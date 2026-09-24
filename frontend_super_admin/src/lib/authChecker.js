// src/lib/authChecker.js
//
// Real bug closed here: this read the session from
// localStorage.getItem('token'/'role'), which the real login flow
// (SA-01 fix, src/app/auth/login/page.js) stopped writing entirely --
// the session lives only in the httpOnly ebadge_token cookie now. Every
// page that called checkAuth('admin') was redirecting a genuinely
// authenticated admin straight back to /auth/login, because
// localStorage.getItem('token') is now always null. This checks the
// real session via GET /api/auth/me (the same cookie-authenticated
// bootstrap call use-session.js already uses) instead.
import { apiFetch } from './api';

export async function checkAuth(requiredRole) {
  if (typeof window === 'undefined') return false;

  try {
    const response = await apiFetch('/auth/me', { redirectOnUnauthorized: false });
    if (!response.ok) {
      window.location.href = '/auth/login';
      return false;
    }
    const data = await response.json();
    const role = data.role;
    const isAdmin = role === 'admin' || role === 'platform_admin';

    if (requiredRole === 'admin' && !isAdmin) {
      window.location.href = '/user_dash';
      return false;
    }
    return true;
  } catch {
    window.location.href = '/auth/login';
    return false;
  }
}

// Hook form, for callers that want the role/loading state instead of a
// fire-and-forget redirect. Uses next/navigation (App Router) -- the
// previous version imported useRouter from next/router (Pages Router),
// which has no router context to read in an App Router page.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export function useAuthChecker() {
  const router = useRouter();
  const [state, setState] = useState({ loading: true, userRole: null, isAdmin: false });

  useEffect(() => {
    let cancelled = false;
    apiFetch('/auth/me', { redirectOnUnauthorized: false })
      .then(async (response) => {
        if (!response.ok) {
          if (!cancelled) router.push('/auth/login');
          return;
        }
        const data = await response.json();
        if (!cancelled) setState({ loading: false, userRole: data.role, isAdmin: data.role === 'admin' || data.role === 'platform_admin' });
      })
      .catch(() => {
        if (!cancelled) router.push('/auth/login');
      });
    return () => { cancelled = true; };
  }, [router]);

  const requireAuth = (requiredRole) => {
    if (state.loading) return true;
    if (requiredRole === 'admin' && !state.isAdmin) {
      router.push('/user_dash');
      return false;
    }
    return true;
  };

  return { ...state, requireAuth };
}
