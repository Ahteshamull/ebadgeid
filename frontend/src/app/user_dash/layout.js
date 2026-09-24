'use client';

import { DashboardShell } from '@/components/dashboard/dashboard-shell';

export default function DashboardLayout({ children }) {
  return <DashboardShell requiredRole="user">{children}</DashboardShell>;
}
