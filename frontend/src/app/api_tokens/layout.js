'use client';

import { DashboardShell } from '@/components/dashboard/dashboard-shell';

// API keys are privileged credentials, so this view stays restricted to
// administrative roles. The backend's requireAdmin gate already permits
// both admin and platform_admin, while intentionally keeping teachers out.
export default function DashboardLayout({ children }) {
  return <DashboardShell requiredRole={["admin", "platform_admin"]}>{children}</DashboardShell>;
}
