'use client';

import { useState, useEffect, createContext, useContext } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from '@/hooks/use-session';
import { Header } from '@/components/layout/header';
import { Sidebar } from '@/components/dashboard/sidebar';
import { Footer } from '@/components/layout/footer';

export const AppShellContext = createContext({ inShell: false });

const PUBLIC_PATH_PREFIXES = [
  '/auth',
  '/portal',
  '/templates/preview',
  '/verifications',
];

const ROUTE_PERMISSIONS = [
  { prefix: '/credentials/design-editor', roles: ['admin', 'platform_admin'], chromeless: true },
  { prefix: '/api_tokens', roles: ['admin', 'platform_admin'] },
  { prefix: '/completion_tasks', roles: ['admin', 'platform_admin'] },
  { prefix: '/manage_contracts', roles: ['admin', 'platform_admin'] },
  { prefix: '/platform', roles: ['admin', 'platform_admin'] },
  { prefix: '/reports', roles: ['admin', 'teacher', 'platform_admin'] },
  { prefix: '/users', roles: ['admin', 'teacher', 'platform_admin'] },
  { prefix: '/credentials', roles: ['admin', 'teacher', 'platform_admin'] },
  { prefix: '/goals', roles: ['admin', 'teacher'] },
  { prefix: '/user_dash', roles: ['user'] },
  { prefix: '/my_goals', roles: ['user'] },
  { prefix: '/creds', roles: ['user'] },
  { prefix: '/settings', roles: ['admin', 'teacher', 'user', 'platform_admin'] },
];

export function AppShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { session, loading, error } = useSession();

  const isRoot = pathname === '/';
  const isPublicRoute = PUBLIC_PATH_PREFIXES.some((prefix) => pathname?.startsWith(prefix));

  // Close mobile drawer on navigation
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Handle redirects inside useEffect to avoid updating router during render
  useEffect(() => {
    if (isRoot || isPublicRoute) return;

    if (!loading && !session) {
      router.replace('/auth/login');
      return;
    }

    if (session?.role) {
      const matched = ROUTE_PERMISSIONS.find((rule) => pathname?.startsWith(rule.prefix));
      if (matched && !matched.roles.includes(session.role)) {
        if (session.role === 'admin' || session.role === 'platform_admin') {
          router.replace('/reports/organizations');
        } else if (session.role === 'teacher') {
          router.replace('/credentials');
        } else if (session.role === 'user') {
          router.replace('/user_dash');
        } else {
          router.replace('/settings');
        }
      }
    }
  }, [loading, session, pathname, router, isRoot, isPublicRoute]);

  // 1. Root page & Public / standalone routes bypass dashboard shell
  if (isRoot || isPublicRoute) {
    return <AppShellContext.Provider value={{ inShell: false }}>{children}</AppShellContext.Provider>;
  }

  // 2. Authentication check for dashboard routes
  if (loading && !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" role="status">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
          <p className="mt-4 text-sm font-medium text-muted-foreground">Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (!loading && !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" role="status">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
          <p className="mt-4 text-sm font-medium text-muted-foreground">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  // 3. Role authorization check
  const matchedRule = ROUTE_PERMISSIONS.find((rule) => pathname?.startsWith(rule.prefix));
  if (matchedRule && session?.role && !matchedRule.roles.includes(session.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" role="status">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
          <p className="mt-4 text-sm font-medium text-muted-foreground">Redirecting...</p>
        </div>
      </div>
    );
  }

  const isChromeless = matchedRule?.chromeless || pathname?.startsWith('/credentials/design-editor');

  if (isChromeless) {
    return (
      <AppShellContext.Provider value={{ inShell: true }}>
        {children}
      </AppShellContext.Provider>
    );
  }

  // 4. Persistent Dashboard Layout: Header and Sidebar remain mounted across all route transitions
  return (
    <AppShellContext.Provider value={{ inShell: true }}>
      <div className="min-h-screen flex flex-col bg-background text-foreground">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <div className="flex min-w-0 flex-1">
          <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          <div className="hidden md:block w-80 flex-shrink-0" aria-hidden="true" />
          <main className="min-w-0 flex-1 overflow-x-hidden p-4 sm:p-6 lg:p-8" tabIndex={0}>
            {children}
          </main>
        </div>
        <Footer />
      </div>
    </AppShellContext.Provider>
  );
}
