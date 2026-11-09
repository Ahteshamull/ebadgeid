'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Goal management was removed from the product navigation. Existing goal
// records stay in the database; this route only sends people back to a
// page they are allowed to use.
export default function GoalsRemovedPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/reports/organizations');
  }, [router]);

  return (
    <main className="min-h-[40vh] flex items-center justify-center" role="status">
      <p className="text-sm text-muted-foreground">Goal management is no longer available. Returning to the dashboard…</p>
    </main>
  );
}
