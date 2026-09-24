// components/layout/header.js
"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import {
  Bell, Globe, ChevronDown, HelpCircle,
  Check, CheckCheck, MoreVertical, User, Settings, LogOut,
  ShieldAlert, Cog, MessageSquare, Award,
} from "lucide-react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLocale } from "../../context/Localecontext.js"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { apiFetch } from "@/lib/api"
import { useSession } from "@/hooks/use-session"

export function Header() {
  const { t, locale, changeLocale, currentLanguage, LANGUAGE_OPTIONS } = useLocale()
  const { session, loading, error: sessionError } = useSession()

  // SA-01 fix: this used to read localStorage.getItem('username') and do
  // its own unauthenticated fetch straight to a hardcoded URL -- once
  // login stopped writing tokens/usernames to localStorage, `username`
  // was always null here, which is the real cause of the sidebar/header
  // showing "Failed to load user data". `session.profile` (from the one
  // shared /auth/me call) already has everything this component needs.
  const user = session?.profile || null
  const error = sessionError?.message || null
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)

  // ─── Data fetching ───────────────────────────────────────────────────────────

  const fetchNotifications = async () => {
    if (!session?.username) return
    try {
      const res = await apiFetch(`/notifications/${session.username}`, { redirectOnUnauthorized: false })
      if (!res.ok) throw new Error("Failed to fetch notifications")
      const data = await res.json()
      const notes = data.notifications || []
      setNotifications(notes)
      setUnreadCount(notes.filter((n) => !n.read).length)
    } catch (err) {
      console.error("Error fetching notifications:", err)
    }
  }

  useEffect(() => {
    if (session?.username) fetchNotifications()
  }, [session?.username])

  // ─── Notification helpers ────────────────────────────────────────────────────

  const markAsRead = (id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    )
    setUnreadCount((prev) => Math.max(0, prev - 1))
  }

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnreadCount(0)
  }

  const deleteNotification = (id) => {
    const note = notifications.find((n) => n.id === id)
    if (note && !note.read) setUnreadCount((prev) => Math.max(0, prev - 1))
    setNotifications((prev) => prev.filter((n) => n.id !== id))
  }

  // ─── User display helpers ────────────────────────────────────────────────────

  const getUserInitials = (name) => {
    if (!name) return "U"
    const parts = name.split(" ")
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    return name.substring(0, 2).toUpperCase()
  }

  const getProfilePictureUrl = () =>
    user?.avatar || user?.profile_picture_url || user?.image || user?.photo || user?.avatarUrl || null

  const getDisplayName = () => {
    if (user?.first_name && user?.last_name) return `${user.first_name} ${user.last_name}`
    return "User"
  }

  const getUserEmail = () => user?.email || user?.emailAddress || "user@example.com"

  // ─── Notification type helpers ───────────────────────────────────────────────

  const getTypeIcon = (type) => {
    switch (type) {
      case "security": return ShieldAlert
      case "system": return Cog
      case "message": return MessageSquare
      case "badge": return Award
      default: return Bell
    }
  }

  const getTypeColor = (type) => {
    switch (type) {
      case "security": return "text-red-600"
      case "system": return "text-blue-600"
      case "message": return "text-green-600"
      case "badge": return "text-purple-600"
      default: return "text-gray-600"
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b bg-white px-4 md:px-6 shadow-sm">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-3 group">
        <div className="flex items-center justify-center w-8 h-8 bg-gradient-to-br from-gray-900 to-gray-700 rounded-lg shadow-md group-hover:shadow-lg transition-all duration-200">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="currentColor">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
        </div>
        <div className="flex flex-col">
          <span className="font-bold text-lg leading-5 text-gray-900">eBadge ID</span>
          <span className="text-xs text-gray-500 hidden sm:block">{t('digital_identity')}</span>
        </div>
      </Link>

      {/* Right controls */}
      <div className="flex items-center gap-2">

        {/* ── Notifications ── */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative h-9 w-9 rounded-full hover:bg-gray-100 transition-colors"
            >
              <Bell className="h-4 w-4 text-gray-700" />
              {unreadCount > 0 && (
                <div className="absolute -top-2 -right-2 flex items-center justify-center min-w-[22px] h-5 px-1 bg-red-500 text-white text-xs font-bold rounded-full shadow-md border-2 border-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </div>
              )}
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            className="w-80 rounded-lg shadow-lg border border-gray-200 p-0 overflow-hidden bg-white"
          >
            {/* Header */}
            <div className="p-3 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-gray-600" />
                <span className="font-semibold text-gray-900 text-sm">{t("notifications")}</span>
                {notifications.length > 0 && (
                  <Badge variant="secondary" className="text-xs bg-gray-100 text-gray-700">
                    {notifications.length}
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 p-0 ml-2 text-gray-500 hover:text-blue-600"
                  title={t("refresh_notifications")}
                  onClick={fetchNotifications}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={markAllAsRead}
                  className="h-6 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                >
                  <CheckCheck className="h-3 w-3 mr-1" />
                  {t("mark_read")}
                </Button>
              )}
            </div>

            {/* List */}
            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 px-4 text-center text-gray-500">
                  <Bell className="h-8 w-8 text-gray-300 mb-2" />
                  <p className="text-sm">{t("no_notifications")}</p>
                </div>
              ) : (
                notifications.map((notification) => {
                  const Icon = getTypeIcon(notification.type)
                  return (
                    <div
                      key={notification.id}
                      className={`p-3 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors cursor-pointer group flex gap-3 ${!notification.read ? "bg-blue-50" : "bg-white"
                        }`}
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        <Icon className={`h-4 w-4 ${getTypeColor(notification.type)}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900 leading-4">
                              {notification.title}
                            </p>
                            <p className="text-xs text-gray-600 leading-4 mt-0.5">
                              {notification.message}
                            </p>
                            <p className="text-xs text-gray-400 mt-1">
                              {notification.timestamp}
                            </p>
                          </div>
                          <div className="flex-shrink-0 flex items-start gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {!notification.read && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  markAsRead(notification.id)
                                }}
                                className="h-5 w-5 p-0 text-gray-400 hover:text-gray-600"
                                title={t("mark_as_read")}
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                deleteNotification(notification.id)
                              }}
                              className="h-5 w-5 p-0 text-gray-400 hover:text-red-600"
                              title={t("delete")}
                            >
                              <MoreVertical className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="p-2 border-t border-gray-100 bg-gray-50 flex items-center justify-between text-xs">
                <span className="text-gray-600">
                  {unreadCount} {t("unread")}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setNotifications([])}
                    className="h-5 px-1.5 text-xs text-gray-600 hover:text-red-600 hover:bg-red-50"
                  >
                    {t("clear")}
                  </Button>
          {/* The "All" link pointed at /notifications, a route that does not
              exist in this app -- clicking it 404'd. The dropdown above is
              the whole notification surface today, so the link is removed
              rather than pointed somewhere arbitrary. */}
                </div>
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* ── Language selector ── */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 h-9 px-3 rounded-full hover:bg-gray-100 transition-colors text-gray-700"
            >
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-100">
                  <Globe className="h-3 w-3 text-gray-600" />
                </div>
                <span className="hidden sm:inline text-sm font-medium">
                  {currentLanguage.flag} {currentLanguage.name}
                </span>
                <span className="sm:hidden text-sm font-medium">
                  {currentLanguage.flag}
                </span>
              </div>
              <ChevronDown className="h-3 w-3 text-gray-500" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            className="w-56 rounded-xl shadow-lg border border-gray-200"
          >
            <DropdownMenuLabel className="flex items-center gap-2 text-xs font-semibold text-gray-500">
              <Globe className="h-3.5 w-3.5" />
              {t("select_language")}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="max-h-64 overflow-y-auto py-1">
              {LANGUAGE_OPTIONS.map((language) => (
                <DropdownMenuItem
                  key={language.code}
                  onClick={() => changeLocale(language.code)}
                  className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors rounded-lg mx-2 my-0.5 ${locale === language.code
                      ? "bg-gray-100 text-gray-900 font-medium"
                      : "hover:bg-gray-50 text-gray-700"
                    }`}
                >
                  <span className="text-base">{language.flag}</span>
                  <span className="flex-1">{language.name}</span>
                  {locale === language.code && (
                    <div className="w-2 h-2 bg-gray-600 rounded-full" />
                  )}
                </DropdownMenuItem>
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* ── User menu ── */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="relative h-9 flex items-center gap-2 pl-1 pr-3 rounded-full hover:bg-gray-100 transition-colors group"
            >
              <div className="relative">
                <Avatar className="h-8 w-8 border-2 border-gray-100 group-hover:border-gray-200 transition-colors shadow-sm">
                  {getProfilePictureUrl() && (
                    <AvatarImage
                      src={getProfilePictureUrl()}
                      alt={getDisplayName()}
                      className="object-cover"
                    />
                  )}
                  <AvatarFallback className="bg-gradient-to-br from-gray-100 to-gray-200 text-gray-600 font-medium text-sm">
                    {loading ? (
                      <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
                    ) : (
                      getUserInitials(getDisplayName())
                    )}
                  </AvatarFallback>
                </Avatar>
                {!loading && !error && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
                )}
              </div>

              <div className="hidden sm:flex flex-col items-start">
                {loading ? (
                  <>
                    <Skeleton className="h-3 w-20 mb-1 bg-gray-200" />
                    <Skeleton className="h-2 w-16 bg-gray-200" />
                  </>
                ) : error ? (
                  <>
                    <span className="text-sm font-medium text-gray-900">User</span>
                    <span className="text-xs text-gray-500">user@example.com</span>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-medium leading-4 text-gray-900">
                      {getDisplayName()}
                    </span>
                    <span className="text-xs text-gray-500 leading-3">
                      {user?.designation}
                    </span>
                  </>
                )}
              </div>

              <ChevronDown className="h-3 w-3 text-gray-500 group-hover:text-gray-700 transition-colors" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            className="w-64 rounded-xl shadow-lg border border-gray-200 p-2"
          >
            {/* User info card */}
            <div className="flex flex-col space-y-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10 border-2 border-gray-100">
                  {getProfilePictureUrl() && (
                    <AvatarImage
                      src={getProfilePictureUrl()}
                      alt={getDisplayName()}
                      className="object-cover"
                    />
                  )}
                  <AvatarFallback className="bg-gray-100 text-gray-600 font-medium">
                    {getUserInitials(getDisplayName())}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {loading ? t("loading") : error ? "User" : getDisplayName()}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {loading ? t("loading") : error ? "user@example.com" : getUserEmail()}
                  </p>
                </div>
              </div>
              {error && (
                <Badge variant="destructive" className="w-fit text-xs">
                  {t("failed_load_user")}
                </Badge>
              )}
            </div>

            <DropdownMenuSeparator className="my-2" />

            <div className="space-y-1">
              <Link href="/settings">
                <DropdownMenuItem className="flex items-center gap-3 px-3 py-2.5 cursor-pointer rounded-lg hover:bg-gray-100 transition-colors text-gray-700">
                  <User className="h-4 w-4" />
                  <span>{t("profile")}</span>
                </DropdownMenuItem>
              </Link>

              <Link href="/settings">
                <DropdownMenuItem className="flex items-center gap-3 px-3 py-2.5 cursor-pointer rounded-lg hover:bg-gray-100 transition-colors text-gray-700">
                  <Settings className="h-4 w-4" />
                  <span>{t("settings")}</span>
                </DropdownMenuItem>
              </Link>

              <Link href="https://documentation.ebadgeid.com/">
                <DropdownMenuItem className="flex items-center gap-3 px-3 py-2.5 cursor-pointer rounded-lg hover:bg-gray-100 transition-colors text-gray-700">
                  <HelpCircle className="h-4 w-4" />
                  <span>{t("help_center")}</span>
                </DropdownMenuItem>
              </Link>
            </div>

            <DropdownMenuSeparator className="my-2" />

            <DropdownMenuItem
              className="flex items-center gap-3 px-3 py-2.5 cursor-pointer rounded-lg text-red-600 hover:bg-red-50 transition-colors"
              onClick={() => {
                // SA-01 fix: the session lives in an httpOnly cookie now, not
                // localStorage -- it can only be cleared by the server.
                apiFetch('/auth/logout', { method: 'POST', redirectOnUnauthorized: false }).catch(() => {})
                window.location.href = "/auth/login"
              }}
            >
              <LogOut className="h-4 w-4" />
              <span className="font-medium">{t("logout")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

      </div>
    </header>
  )
}