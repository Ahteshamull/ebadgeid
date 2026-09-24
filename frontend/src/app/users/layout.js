'use client';

import { DashboardShell } from '@/components/dashboard/dashboard-shell';

// Platform administrators are allowed by the API's admin gate, but remain
// limited to their own organization by requireOwnOrg on the list endpoint.
// Keep the page gate aligned with that server-side policy so the platform
// administrator account used to operate the platform can manage its own
// organization users instead of being redirected to Settings.
export default function DashboardLayout({ children }) {
  return <DashboardShell requiredRole={["admin", "teacher", "platform_admin"]}>{children}</DashboardShell>;
}
