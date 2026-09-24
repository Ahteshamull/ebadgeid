// app/(dashboard)/layout.js
import React from "react"
import { Sidebar } from "@/components/dashboard/sidebar"
import { Header } from "@/components/layout/header"
import { Footer } from "@/components/layout/footer"

export default function DashboardLayout({ children }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="flex flex-1">
        {/* Sidebar container - with exact width to match sidebar.
            Was w-70 (Tailwind v4 generates real CSS for it, just at
            17.5rem/280px -- 40px narrower than the sidebar's actual w-80/
            320px), so the fixed sidebar overlapped the leftmost 40px of
            every page's content under this layout. */}
        <div className="w-80 flex-shrink-0">
          <Sidebar />
        </div>
        {/* Main content - removed the left margin */}
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
      <Footer />
    </div>
  )
}