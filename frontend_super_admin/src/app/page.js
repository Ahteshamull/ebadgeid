"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { apiFetch } from "@/lib/api";

// Real bug closed here: this always read localStorage.getItem('token'),
// which the real login flow (SA-01 fix) stopped writing entirely -- the
// session lives only in the httpOnly ebadge_token cookie. Every visit to
// "/" was unconditionally bouncing to /auth/login regardless of whether
// the visitor had a real, valid session, because `token` was always
// null. This checks the real session via the same cookie-authenticated
// GET /api/auth/me every other page already uses.
export default function AuthCheck() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    apiFetch('/auth/me', { redirectOnUnauthorized: false })
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          router.push('/auth/login');
          return;
        }
        const data = await response.json();
        if (!data.authenticated) {
          router.push('/auth/login');
          return;
        }
        if (data.role === 'admin' || data.role === 'platform_admin') {
          router.push('/reports/organizations');
        } else {
          router.push('/user_dash');
        }
      })
      .catch(() => {
        if (!cancelled) router.push('/auth/login');
      });

    return () => { cancelled = true; };
  }, [router]);

  // No need to render anything as we're just doing redirects
  return null;
}
