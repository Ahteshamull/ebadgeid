// components/layout/header.js
"use client"

import Link from "next/link"
import { Bell, MessageSquare, Globe, ChevronDown, HelpCircle, HouseIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Sidebar } from "@/components/dashboard/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useLocalization } from "../../context/LocalizationContext"
import { languages } from "../../locales"
import { useSession } from "@/hooks/use-session"
import { apiFetch } from "@/lib/api"

export function Header() {
  const { user, loading, error } = useSession()

  const { language, changeLanguage, currentLanguage, t } = useLocalization()

  // Handle language change
  const handleLanguageChange = (languageCode) => {
    changeLanguage(languageCode)
  }

  // Function to get user initials (fallback only)
  const getUserInitials = (name) => {
    if (!name) return 'U'
    const names = name.split(' ')
    if (names.length >= 2) {
      return `${names[0][0]}${names[1][0]}`.toUpperCase()
    }
    return name.substring(0, 2).toUpperCase()
  }

  // Function to get profile picture URL
  const getProfilePictureUrl = () => {
    return user?.avatar || user?.profile_picture_url || user?.image || user?.photo || user?.avatarUrl || null
  }

  // Function to get display name
  const getDisplayName = () => {
    if (user?.fullName) return user.fullName
    if (user?.firstName && user?.lastName) return `${user.firstName} ${user.lastName}`
    if (user?.name) return user.name
    if (user?.username) return user.username
    return 'User'
  }

  // Function to get user email
  const getUserEmail = () => {
    return user?.email || user?.emailAddress || 'user@example.com'
  }

  return (
    <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b bg-background/95 backdrop-blur px-4 md:px-6">
      <div className="flex items-center gap-2">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <line x1="4" x2="20" y1="12" y2="12" />
                <line x1="4" x2="20" y1="6" y2="6" />
                <line x1="4" x2="20" y1="18" y2="18" />
              </svg>
              <span className="sr-only">Toggle navigation menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0">
            <Sidebar />
          </SheetContent>
        </Sheet>
        <Link href="/" className="hidden md:block">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="h-6 w-6 text-primary" fill="currentColor">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
            </svg>
            <span className="font-bold text-xl tracking-tight">eBadgeId</span>
          </div>
        </Link>
        <Link href="/" className="md:hidden font-bold text-lg">
          eBadge ID
        </Link>
      </div>

      <div className="flex items-center gap-3">
        {/* Language Selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <Globe className="h-4 w-4" />
              <span className="hidden sm:inline text-sm">
                {currentLanguage.flag} {currentLanguage.name}
              </span>
              <span className="sm:hidden text-sm">
                {currentLanguage.flag}
              </span>
              <ChevronDown className="h-4 w-4 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 max-h-64 overflow-y-auto">
            <DropdownMenuLabel>{t('select_language') || 'Select Language'}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {languages.map((lang) => (
              <DropdownMenuItem
                key={lang.code}
                onClick={() => handleLanguageChange(lang.code)}
                className={`cursor-pointer ${language === lang.code ? 'bg-accent text-accent-foreground' : ''}`}
              >
                <span className="mr-2">{lang.flag}</span>
                {lang.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-8 flex items-center gap-2 pl-2 pr-3 rounded-full">
              <Avatar className="h-8 w-8 border-2 border-primary/10">
                {getProfilePictureUrl() ? (
                  <AvatarImage 
                    src={getProfilePictureUrl()} 
                    alt={getDisplayName()}
                    className="object-cover"
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary font-medium">
                  {loading ? '...' : getUserInitials(getDisplayName())}
                </AvatarFallback>
              </Avatar>
              <span className="hidden sm:inline text-sm font-medium">
                {loading ? 'Loading...' : (error ? 'User' : getDisplayName())}
              </span>
              <ChevronDown className="h-4 w-4 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="flex flex-col space-y-1 p-2">
              <p className="text-sm font-medium">
                {loading ? 'Loading...' : (error ? 'User' : getDisplayName())}
              </p>
              <p className="text-xs text-muted-foreground">
                {loading ? 'Loading...' : (error ? 'user@example.com' : getUserEmail())}
              </p>
              {error && (
                <p className="text-xs text-red-500">
                  Failed to load user data
                </p>
              )}
            </div>
            <DropdownMenuSeparator />
            <Link href="/settings">
              <DropdownMenuItem>
                <svg className="mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                {t('profile') || 'Profile'}
              </DropdownMenuItem>
            </Link>
            <Link href="https://documentation.ebadgeid.com/">
              <DropdownMenuItem>
                <HelpCircle className="mr-2 h-4 w-4" />
                {t('help_center') || 'Help Center'}
              </DropdownMenuItem>
            </Link>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              className="text-red-500 focus:text-red-500"
              onClick={async () => {
                await apiFetch('/auth/logout', { method: 'POST', redirectOnUnauthorized: false })
                window.location.href = '/auth/login'
              }}
            >
              <svg className="mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {t('logout') || 'Logout'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
