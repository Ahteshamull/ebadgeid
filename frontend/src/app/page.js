"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from '@/lib/api';

function destinationForRole(role) {
  if (role === 'admin' || role === 'teacher' || role === 'platform_admin') {
    return '/reports/organizations';
  }
  if (role === 'user') return '/user_dash';
  return '/settings';
}

export default function AuthCheck() {
  const router = useRouter();
  const [status, setStatus] = useState('checking');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;

    const checkAuth = async () => {
      setStatus('checking');
      setMessage('');
      try {
        const response = await apiFetch('/auth/me', { redirectOnUnauthorized: false });
        if (!active) return;

        if (response.status === 401) {
          router.replace('/auth/login');
          return;
        }

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          setStatus('error');
          setMessage(body.message || `The homepage could not reach the API (HTTP ${response.status}).`);
          return;
        }

        const data = await response.json();
        if (!data.authenticated) {
          router.replace('/auth/login');
          return;
        }
        router.replace(destinationForRole(data.role));
      } catch (error) {
        if (!active) return;
        setStatus('error');
        setMessage(error.message || 'The homepage could not reach the API.');
      }
    };

    checkAuth();
    return () => { active = false; };
  }, [router]);

  if (status === 'error') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-semibold text-foreground">Homepage could not load</h1>
          <p className="text-sm text-muted-foreground">{message}</p>
          <button
            type="button"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background" role="status">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
        <p className="mt-4 text-sm font-medium text-muted-foreground">Loading eBadge ID…</p>
      </div>
    </main>
  );
}
