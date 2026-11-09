'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function MyGoalsRemovedPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/user_dash');
  }, [router]);

  return (
    <main className="min-h-[40vh] flex items-center justify-center" role="status">
      <p className="text-sm text-muted-foreground">Goal management is no longer available. Returning to your dashboard…</p>
    </main>
  );
}
