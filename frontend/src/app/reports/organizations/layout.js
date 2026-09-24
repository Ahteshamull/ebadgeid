'use client';

import { DashboardShell } from '@/components/dashboard/dashboard-shell';

// sidebar.js grants the "Dashboard" link to both admin and teacher — see
// the same fix and rationale in api_tokens/layout.js.
export default function DashboardLayout({ children }) {
  return <DashboardShell requiredRole={["admin", "teacher", "platform_admin"]}>{children}</DashboardShell>;
}
