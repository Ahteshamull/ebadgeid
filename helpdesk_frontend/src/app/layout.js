// app/layout.js
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { LocalizationProvider } from "@/context/LocalizationContext"

export const metadata = {
  title: "Helpdesk | eBadgeId - How can we help you ?",
  description: "A modern dashboard application built with Next.js and shadcn/ui",
  other: {
    "next-dev-indicator": false
  }
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <LocalizationProvider>
      <body className="font-sans">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
      </LocalizationProvider>
    </html>
  )
}
