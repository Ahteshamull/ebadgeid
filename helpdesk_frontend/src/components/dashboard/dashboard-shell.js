'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/dashboard/sidebar';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { useSession } from '@/hooks/use-session';

export function DashboardShell({ children }) {
  const { user, loading } = useSession();
  const router = useRouter();
  useEffect(() => { if (!loading && !user) router.replace('/auth/login'); }, [loading, router, user]);
  if (loading) return <div className="min-h-screen grid place-items-center" role="status">Checking authentication...</div>;
  if (!user) return null;
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="flex flex-1">
        <div className="w-70 flex-shrink-0"><Sidebar /></div>
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
      <Footer />
    </div>
  );
}
