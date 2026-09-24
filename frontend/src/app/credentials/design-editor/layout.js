'use client';

import { DashboardShell } from '@/components/dashboard/dashboard-shell';

// Narrows this one route back to admin-only, on top of the parent
// credentials/layout.js (which now allows admin+teacher for the rest of
// /credentials — see that file). `chromeless` skips re-rendering
// Header/Sidebar/Footer, since the parent layout already renders those
// around this one; without it, a teacher session hitting this page would
// briefly see the shell chrome twice before being redirected out.
export default function DesignEditorLayout({ children }) {
  return <DashboardShell requiredRole={["admin", "platform_admin"]} chromeless>{children}</DashboardShell>;
}
