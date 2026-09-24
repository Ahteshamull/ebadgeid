'use client';

import { DashboardShell } from '@/components/dashboard/dashboard-shell';

// sidebar.js lists "Manage Credentials" (this route) as visible to both
// admin and teacher, same as api_tokens/goals/users/reports — matched here
// now. The nested /credentials/design-editor route needs to stay admin-only
// (sidebar.js reserves it for admin), which is why that route has its own
// design-editor/layout.js applying a stricter, chromeless DashboardShell on
// top of this one instead of this layout gating the whole subtree to admin.
export default function DashboardLayout({ children }) {
  return <DashboardShell requiredRole={["admin", "teacher", "platform_admin"]}>{children}</DashboardShell>;
}
