'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/hooks/use-session';
import { Sidebar } from '@/components/dashboard/sidebar';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';

// SA-01/SA-06 fix: replaces ~14 duplicated layout.js implementations that
// each rolled their own auth check -- most read a bearer token from
// localStorage and called /auth/me with an Authorization header (broken
// now that login no longer writes localStorage); the 5 "unguarded" layouts
// (super_admin/layout.js among them) had no auth check at all. This is one
// shared, tested implementation, modeled on the equivalent component in
// the sibling `frontend` app (which already fixed the exact "sidebar
// overlaps content" class of bug this app's unguarded layouts still have --
// see the w-80 comment below).
export function DashboardShell({ children, requiredRole }) {
  const { session, loading } = useSession();
  const [authorized, setAuthorized] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    if (!session) {
      router.replace('/auth/login');
      return;
    }

    const allowedRoles = Array.isArray(requiredRole) ? requiredRole : requiredRole ? [requiredRole] : null;
    if (allowedRoles && !allowedRoles.includes(session.role)) {
      // '/settings' has no role gate and is reachable by every
      // authenticated role, so it's a safe landing spot for a role this
      // particular page doesn't recognize.
      if (session.role === 'super_admin' || session.role === 'platform_admin') router.replace('/super_admin');
      else if (session.role === 'admin' || session.role === 'teacher') router.replace('/reports/organizations');
      else if (session.role === 'user') router.replace('/user_dash');
      else router.replace('/settings');
      return;
    }

    setAuthorized(true);
  }, [session, loading, requiredRole, router]);

  if (loading || !authorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50" role="status">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Checking authentication...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <div className="flex flex-1 min-w-0">
        {/* Sidebar itself is `fixed` (out of normal flow, see sidebar.js's
            `w-80`) -- rendered here as a sibling of the spacer right after
            it, which reserves the same 320px so content isn't drawn
            underneath the fixed rail. Must match sidebar.js's actual width
            exactly (this is the same class of bug already found and fixed
            once today in the sibling `frontend` app's own
            dashboard-shell.js: a spacer narrower than the real sidebar
            leaves a strip of content visually clipped behind it). A first
            version of this file imported Sidebar but never actually
            rendered it -- confirmed live: the rail was completely missing
            from the page, not just misaligned. */}
        <Sidebar />
        <div className="hidden md:block w-80 flex-shrink-0" aria-hidden="true" />
        <main className="min-w-0 flex-1 overflow-x-hidden p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
      <Footer />
    </div>
  );
}
