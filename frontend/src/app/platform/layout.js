'use client';

import { DashboardShell } from '@/components/dashboard/dashboard-shell';

export default function PlatformLayout({ children }) {
  return <DashboardShell requiredRole={["platform_admin", "admin"]}>{children}</DashboardShell>;
}
