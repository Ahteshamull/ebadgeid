'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Sidebar } from '@/components/dashboard/sidebar';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';

// `chromeless` skips the Header/Sidebar/Footer wrapper below, keeping only
// the auth/role check and redirect. For nested layouts that need a
// *stricter* requiredRole than their parent (e.g. credentials/layout.js
// allows admin+teacher, but credentials/design-editor/layout.js narrows
// that back to admin-only) — nesting two full DashboardShell instances
// would render the chrome twice, since Next.js layouts wrap their children
// rather than replace them.
export function DashboardShell({ children, requiredRole, chromeless = false }) {
  const [authorized, setAuthorized] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Closes the mobile drawer on every navigation -- without this, tapping a
  // sidebar link on mobile would land on the new page with the drawer still
  // covering it.
  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  useEffect(() => {
    let active = true;

    apiFetch('/auth/me', { redirectOnUnauthorized: false })
      .then(async (response) => {
        if (!response.ok) throw new Error('Session is not valid');
        const session = await response.json();
        // requiredRole can be a single role or a list — sidebar.js already
        // grants some pages (Dashboard, Manage Users, Manage Credentials,
        // API Keys, Manage Goals) to both 'admin' and 'teacher', but this
        // check used to compare against a single string. A 'teacher'
        // session hit every one of those pages, failed the check, and got
        // sent to the old binary fallback below — which only ever pointed
        // at '/credentials' (admin) or '/user_dash' (assumed everyone
        // else was 'user'). For 'teacher' that fallback is itself gated to
        // 'user' only, so it failed the same way and redirected back to
        // itself: a permanent "Checking authentication..." spinner, with
        // no way for a teacher to reach any of their own sidebar links.
        const allowedRoles = Array.isArray(requiredRole) ? requiredRole : requiredRole ? [requiredRole] : null;
        if (allowedRoles && !allowedRoles.includes(session.role)) {
          // '/settings' has no role gate (see settings/layout.js) and is
          // reachable by every authenticated role, so it's a safe landing
          // spot for any role this page doesn't recognize — instead of
          // guessing between two hardcoded destinations that don't cover
          // every real role in the system.
          if (session.role === 'admin') router.replace('/credentials');
          else if (session.role === 'user') router.replace('/user_dash');
          else router.replace('/settings');
          return;
        }
        if (active) setAuthorized(true);
      })
      .catch(() => router.replace('/auth/login'));

    return () => { active = false; };
  }, [requiredRole, router]);

  if (!authorized) {
    // A chromeless instance is always nested inside a full DashboardShell
    // (see the comment above) which already shows this same spinner while
    // it resolves the outer, looser check — showing it twice would just be
    // a visual double-flicker, not a second real state, so this one stays
    // silent and lets the outer shell's spinner carry the loading state.
    if (chromeless) return null;
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" role="status">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
          <p className="mt-4 text-sm font-medium text-muted-foreground">Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (chromeless) return children;

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Header onMenuClick={() => setSidebarOpen(true)} />
      {/* `min-w-0` is essential here: the content area lives beside a fixed
          navigation rail and may contain wide controls/tables. Without it a
          flex item keeps its intrinsic minimum width, so on intermediate
          desktop widths it can extend back underneath the fixed sidebar.
          The result is a visibly clipped first column/header even though the
          320px spacer is present. */}
      <div className="flex min-w-0 flex-1">
        {/* Sidebar itself is `fixed` (out of normal flow) and handles its
            own responsive visibility (always shown on desktop, an
            off-canvas drawer below md -- see sidebar.js), so it only needs
            to be rendered once, not once per breakpoint. */}
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        {/* Pure layout spacer reserving room for the fixed sidebar next to
            main content -- desktop only, since on mobile the sidebar is an
            off-canvas drawer and reserving 320px here would leave a
            permanent blank gutter for no reason. Must match sidebar.js's
            actual w-80 (320px) exactly -- this used to say w-70. Tailwind
            v4's arbitrary numeric spacing (width: calc(var(--spacing) * N))
            happily generates CSS for w-70 too, just the wrong width
            (17.5rem/280px, not 20rem/320px) -- a real class, silently 40px
            too narrow, not a typo that produced nothing. The real, fixed
            sidebar (320px, higher z-index) then visually overlapped the
            leftmost 40px of every page's content. Found live from a real
            screenshot. */}
        <div className="hidden md:block w-80 flex-shrink-0" aria-hidden="true" />
        {/* tabIndex=0 so this scrollable region is reachable by Tab and
            then scrollable with arrow keys -- on narrow viewports
            (confirmed with a real mobile-width scan) its content can
            overflow with nothing else focusable inside, leaving no way to
            scroll it without a mouse or touch. -1 would make it
            script-focusable only, not actually reachable by keyboard,
            which is the real gap here. */}
        {/* Keep the page inside the space after the desktop rail. Individual
            data tables provide their own horizontal scroll region, so the
            application shell must not create a second page-wide horizontal
            overflow that can place content behind the fixed navigation. */}
        <main className="min-w-0 flex-1 overflow-x-hidden p-4 sm:p-6 lg:p-8" tabIndex={0}>{children}</main>
      </div>
      <Footer />
    </div>
  );
}
