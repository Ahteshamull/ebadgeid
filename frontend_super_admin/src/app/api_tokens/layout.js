'use client';

// SA-01/SA-06 fix: replaces a per-file localStorage-token + manual
// /auth/me fetch (broken now that login no longer writes localStorage,
// and duplicated near-identically across every route in this app) with
// the one shared, tested DashboardShell -- see its own comment for why.
import { DashboardShell } from '@/components/dashboard/dashboard-shell';

export default function DashboardLayout({ children }) {
  return <DashboardShell requiredRole={'admin'}>{children}</DashboardShell>;
}
