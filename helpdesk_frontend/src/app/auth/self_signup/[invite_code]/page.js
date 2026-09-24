'use client';

import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function RetiredHelpdeskSelfSignupPage() {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <Card className="w-full max-w-lg border-slate-200 shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
            <ShieldCheck className="h-7 w-7 text-emerald-700" aria-hidden="true" />
          </div>
          <CardTitle>Secure account activation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 text-center text-slate-600">
          <p>
            This legacy self-registration link is no longer accepted. Helpdesk accounts are now
            provisioned by an organization administrator to prevent unauthorized tenant access.
          </p>
          <p className="text-sm">
            Ask your administrator to create your account from User Management, then sign in with
            the credentials delivered through your organization&apos;s approved channel.
          </p>
          <Button asChild className="w-full">
            <Link href="/auth/login">Go to secure sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
