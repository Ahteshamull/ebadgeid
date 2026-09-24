// app/layout.js
import { Inter } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { LocaleProvider } from "../context/Localecontext.js"
import { SessionProvider } from "@/hooks/use-session"

const inter = Inter({ subsets: ["latin"] })

export const metadata = {
  title: "eBadge ID | Digital Credentials",
  description: "A modern dashboard application built with Next.js and shadcn/ui",
  other: {
    "next-dev-indicator": false,
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {/* LocaleProvider must be a Client Component wrapper — it lives here
              so every page and component in the tree can call useLocale() */}
          <LocaleProvider>
            <SessionProvider>
              {children}
            </SessionProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
