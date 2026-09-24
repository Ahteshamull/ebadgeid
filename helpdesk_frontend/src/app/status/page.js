'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function StatusRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/system/status');
  }, [router]);
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50" aria-live="polite">
      <div className="flex items-center gap-3 text-slate-600">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        Loading verified service status…
      </div>
    </main>
  );
}
