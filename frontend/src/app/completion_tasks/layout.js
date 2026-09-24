'use client';

import { DashboardShell } from '@/components/dashboard/dashboard-shell';

export default function DashboardLayout({ children }) {
  return <DashboardShell requiredRole={["admin", "platform_admin"]}>{children}</DashboardShell>;
}
