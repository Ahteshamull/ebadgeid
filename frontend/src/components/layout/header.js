// components/layout/header.js
"use client"

import { useState, useEffect } from "react"
import { apiFetch } from "@/lib/api"
import { useSession } from '@/hooks/use-session'
import Link from "next/link"
import { Bell, Globe, ChevronDown, Check, CheckCheck, MoreVertical, LogOut, ShieldAlert, Cog, MessageSquare, Award, Menu, Mail, ExternalLink } from "lucide-react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GoogleTranslateWidget } from "@/components/layout/googleTranslateWidget"
import { changeLanguage, getCurrentLanguage, LANGUAGE_OPTIONS } from "../../lib/googleTranslate"
import { ThemeToggle } from "@/components/layout/theme-toggle"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function Header({ onMenuClick } = {}) {
  const { session, loading: sessionLoading } = useSession()
  const username = session?.username
    // Notification refresh function
    const refreshNotifications = async () => {
      if (!username) return;
      try {
        const res = await apiFetch(`/notifications/${username}`);
        if (!res.ok) throw new Error('Failed to fetch notifications');
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount((data.notifications || []).filter(n => !n.read).length);
      } catch (err) {
        console.error('Error refreshing notifications:', err);
      }
    };
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedLanguage, setSelectedLanguage] = useState('en')
  const [isTranslateReady, setIsTranslateReady] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [supportOpen, setSupportOpen] = useState(false)


  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const username = session?.username
        if (!username) {
          // Same fix as components/dashboard/sidebar.js: useSession()'s own
          // /auth/me call is still in flight on first mount (session is
          // briefly null), which isn't a real error — only treat it as one
          // once useSession has actually finished loading with no session.
          setError(sessionLoading ? null : 'No authenticated user')
          setLoading(sessionLoading)
          return
        }

        const response = await apiFetch(`/users/username/${username}`)

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        const userData = await response.json()
        setUser(userData)
        setError(null)
      } catch (err) {
        console.error('Error fetching user data:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }


    fetchUserData()
    // Fetch notifications from API once
    const fetchNotifications = async () => {
      if (!username) return;
      try {
        const res = await apiFetch(`/notifications/${username}`);
        if (!res.ok) throw new Error('Failed to fetch notifications');
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount((data.notifications || []).filter(n => !n.read).length);
      } catch (err) {
        console.error('Error fetching notifications:', err);
      }
    };
    fetchNotifications();
    
    const checkInitialLanguage = () => {
      const hash = window.location.hash;
      const savedLang = localStorage.getItem('preferred-language');
      
      if (hash && hash.includes('googtrans')) {
        const match = hash.match(/googtrans\(en\|([^)]+)\)/);
        if (match) {
          setSelectedLanguage(match[1]);
        }
      } else if (savedLang && savedLang !== 'en') {
        setSelectedLanguage(savedLang);
        setTimeout(() => {
          window.location.hash = `#googtrans(en|${savedLang})`;
          window.location.reload();
        }, 1000);
      }
    };
    
    checkInitialLanguage();
  }, [session, sessionLoading])

  useEffect(() => {
    const checkTranslateReady = () => {
      const translateCombo = document.querySelector('.goog-te-combo');
      if (translateCombo) {
        setIsTranslateReady(true);
        const currentLang = getCurrentLanguage();
        setSelectedLanguage(currentLang || 'en');
        
        translateCombo.addEventListener('change', () => {
          const newLang = getCurrentLanguage();
          setSelectedLanguage(newLang || 'en');
        });
      } else {
        setTimeout(checkTranslateReady, 500);
      }
    };

    const timer = setTimeout(checkTranslateReady, 2000);
    return () => clearTimeout(timer);
  }, []);

  // Notification functions
  //
  // These used to only mutate local React state — no call to the backend
  // at all. The action appeared to work (the bell count changed, the item
  // looked read) but a page refresh brought every notification back to
  // "unread", because nothing was ever persisted. The backend already had
  // real endpoints for this (routes/notificationRoutes.js:
  // PATCH /notifications/read/:id and DELETE /notifications/clear/:username)
  // — they just weren't wired up here.
  const markAsRead = (notificationId) => {
    setNotifications(prev =>
      prev.map(notification =>
        notification.id === notificationId
          ? { ...notification, read: true }
          : notification
      )
    )
    setUnreadCount(prev => Math.max(0, prev - 1))
    apiFetch(`/notifications/read/${notificationId}`, { method: 'PATCH' }).catch(err => {
      console.error('Failed to persist notification read state:', err)
    })
  }

  // No backend endpoint exists to mark a notification unread again (only
  // "read" and "clear all" are implemented) — this stays local-only, same
  // as before.
  const markAsUnread = (notificationId) => {
    setNotifications(prev =>
      prev.map(notification =>
        notification.id === notificationId
          ? { ...notification, read: false }
          : notification
      )
    )
    setUnreadCount(prev => prev + 1)
  }

  const markAllAsRead = () => {
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id)
    setNotifications(prev =>
      prev.map(notification => ({ ...notification, read: true }))
    )
    setUnreadCount(0)
    unreadIds.forEach(id => {
      apiFetch(`/notifications/read/${id}`, { method: 'PATCH' }).catch(err => {
        console.error('Failed to persist notification read state:', err)
      })
    })
  }

  const markAllAsUnread = () => {
    setNotifications(prev =>
      prev.map(notification => ({ ...notification, read: false }))
    )
    // Was `prev.length` — prev here is the old unreadCount *number*, not
    // the notifications array, so `.length` on it was always undefined.
    setUnreadCount(notifications.length)
  }

  // Single-notification delete endpoint persists deletion to MongoDB
  const deleteNotification = (notificationId) => {
    const notification = notifications.find(n => n.id === notificationId)
    if (notification && !notification.read) {
      setUnreadCount(prev => Math.max(0, prev - 1))
    }
    setNotifications(prev => prev.filter(n => n.id !== notificationId))
    apiFetch(`/notifications/delete-notification/${notificationId}`, { method: 'DELETE' }).catch(err => {
      console.error('Failed to persist notification deletion:', err)
    })
  }

  const clearAllNotifications = () => {
    setNotifications([])
    setUnreadCount(0)
    if (!username) return
    apiFetch(`/notifications/clear/${username}`, { method: 'DELETE' }).catch(err => {
      console.error('Failed to clear notifications:', err)
    })
  }

  const handleLanguageChange = (languageCode) => {
    console.log('Changing language to:', languageCode);
    
    localStorage.setItem('preferred-language', languageCode || 'en');
    setSelectedLanguage(languageCode || 'en');
    
    setTimeout(() => {
      changeLanguage(languageCode);
    }, 100);
    
    if (languageCode && languageCode !== 'en') {
      window.location.hash = `#googtrans(en|${languageCode})`;
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } else if (languageCode === '' || languageCode === 'en') {
      window.location.hash = '';
      setTimeout(() => {
        window.location.reload();
      }, 500);
    }
  };

  const getCurrentLanguageInfo = () => {
    const langCode = selectedLanguage === 'en' ? '' : selectedLanguage;
    return LANGUAGE_OPTIONS.find(lang => lang.code === langCode) || LANGUAGE_OPTIONS[0];
  };

  const getUserInitials = (name) => {
    if (!name) return 'U'
    const names = name.split(' ')
    if (names.length >= 2) {
      return `${names[0][0]}${names[1][0]}`.toUpperCase()
    }
    return name.substring(0, 2).toUpperCase()
  }

  const getProfilePictureUrl = () => {
    return user?.avatar || user?.profile_picture_url || user?.image || user?.photo || user?.avatarUrl || null
  }

  const getDisplayName = () => {
  
    if (user?.first_name && user?.last_name) return `${user.first_name} ${user.last_name}`

    return 'User'
  }

  const getUserEmail = () => {
    return user?.email || user?.emailAddress || 'user@example.com'
  }

  const getTypeIcon = (type) => {
    switch (type) {
      case 'security':
        return ShieldAlert
      case 'system':
        return Cog
      case 'message':
        return MessageSquare
      case 'badge':
        return Award
      default:
        return Bell
    }
  }

  const getTypeColor = (type) => {
    switch (type) {
      case 'security':
        return 'text-red-600'
      case 'system':
        return 'text-blue-600'
      case 'message':
        return 'text-green-600'
      case 'badge':
        return 'text-purple-600'
      default:
        return 'text-gray-600'
    }
  }

  const getTypeBorder = (type) => {
    switch (type) {
      case 'security':
        return 'border-l-4 border-l-red-500'
      case 'system':
        return 'border-l-4 border-l-blue-500'
      case 'message':
        return 'border-l-4 border-l-green-500'
      case 'badge':
        return 'border-l-4 border-l-purple-500'
      default:
        return 'border-l-4 border-l-gray-500'
    }
  }

  const currentLangInfo = getCurrentLanguageInfo();

  return (
    <>
      <GoogleTranslateWidget />
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-border bg-card/95 backdrop-blur-md px-4 md:px-6 shadow-sm">
        {/* Left Section - Menu toggle (mobile only, opens the sidebar as a
            drawer -- see components/dashboard/sidebar.js) + Logo */}
        <div className="flex items-center gap-2">
          {onMenuClick && (
            <button
              onClick={onMenuClick}
              aria-label="Open navigation menu"
              className="md:hidden p-2 -ml-2 rounded-full hover:bg-muted text-foreground"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="flex items-center justify-center w-8 h-8 bg-gradient-to-br from-gray-900 to-gray-700 dark:from-primary dark:to-primary/80 rounded-lg shadow-md group-hover:shadow-lg transition-all duration-200">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="currentColor">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-lg leading-5 text-foreground">
              eBadge ID
            </span>
            <span className="text-xs text-muted-foreground hidden sm:block">
              Digital Identity
            </span>
          </div>
        </Link>
        </div>

        {/* Right Section - Controls & User Menu */}
        <div className="flex items-center gap-2">
          {/* Notification Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative h-9 w-9 rounded-full hover:bg-muted transition-colors"
                aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
              >
                <Bell className="h-4 w-4 text-foreground" />
                {unreadCount > 0 && (
                  <div className="absolute -top-2 -right-2 flex items-center justify-center min-w-[22px] h-5 px-1 bg-red-500 text-white text-xs font-bold rounded-full shadow-md border-2 border-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </div>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent 
              align="end" 
              className="w-80 rounded-lg shadow-lg border border-border p-0 overflow-hidden bg-popover text-popover-foreground"
            >
              {/* Simple Header */}
              <div className="p-3 border-b border-border/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold text-foreground text-sm">Notifications</span>
                  {notifications.length > 0 && (
                    <Badge variant="secondary" className="text-xs bg-muted text-muted-foreground">
                      {notifications.length}
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 p-0 ml-2 text-muted-foreground hover:text-primary"
                    title="Refresh notifications"
                    onClick={refreshNotifications}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
                {unreadCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={markAllAsRead}
                    className="h-6 px-2 text-xs text-primary hover:bg-primary/10"
                  >
                    <CheckCheck className="h-3 w-3 mr-1" />
                    Mark read
                  </Button>
                )}
              </div>

              {/* Notifications List */}
              <div className="max-h-96 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 px-4 text-center text-muted-foreground">
                    <Bell className="h-8 w-8 text-muted-foreground/40 mb-2" />
                    <p className="text-sm">No notifications</p>
                  </div>
                ) : (
                  notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`p-3 border-b border-border/40 last:border-b-0 hover:bg-muted/50 transition-colors cursor-pointer group flex gap-3 ${
                        !notification.read ? 'bg-primary/5' : 'bg-transparent'
                      }`}
                    >
                      {/* Icon */}
                      <div className="flex-shrink-0 mt-0.5">
                        {getTypeIcon(notification.type) && 
                          (() => {
                            const Icon = getTypeIcon(notification.type)
                            return <Icon className={`h-4 w-4 ${getTypeColor(notification.type)}`} />
                          })()
                        }
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-foreground leading-4">
                              {notification.title}
                            </p>
                            <p className="text-xs text-muted-foreground leading-4 mt-0.5">
                              {notification.message}
                            </p>
                            <p className="text-xs text-muted-foreground/70 mt-1">
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
                                className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                                title="Mark as read"
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
                              className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                              title="Delete"
                            >
                              <MoreVertical className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Footer */}
              {notifications.length > 0 && (
                <div className="p-2 border-t border-border/50 bg-muted/30 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {unreadCount} {unreadCount === 1 ? 'unread' : 'unread'}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearAllNotifications}
                      className="h-5 px-1.5 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                      Clear
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

          {/* Language Selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                size="sm" 
                className="gap-2 h-9 px-3 rounded-full hover:bg-muted transition-colors text-foreground"
              >
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 flex items-center justify-center rounded-full bg-muted">
                    <Globe className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <span className="hidden sm:inline text-sm font-medium">
                    {currentLangInfo.flag} {currentLangInfo.name}
                  </span>
                  <span className="sm:hidden text-sm font-medium">
                    {currentLangInfo.flag}
                  </span>
                </div>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent 
              align="end" 
              className="w-56 rounded-xl shadow-lg border border-border bg-popover text-popover-foreground"
            >
              <DropdownMenuLabel className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <Globe className="h-3.5 w-3.5" />
                Select Language
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="max-h-64 overflow-y-auto py-1">
                {LANGUAGE_OPTIONS.map((language) => (
                  <DropdownMenuItem
                    key={language.code}
                    onClick={() => handleLanguageChange(language.code)}
                    className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors rounded-lg mx-2 my-0.5 ${
                      (selectedLanguage === 'en' && language.code === '') ||
                      (selectedLanguage === language.code)
                        ? 'bg-muted text-foreground font-medium'
                        : 'hover:bg-muted/60 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span className="text-base">{language.flag}</span>
                    <span className="flex-1">{language.name}</span>
                    {((selectedLanguage === 'en' && language.code === '') ||
                      (selectedLanguage === language.code)) && (
                      <div className="w-2 h-2 bg-primary rounded-full" />
                    )}
                  </DropdownMenuItem>
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Theme Switcher */}
          <ThemeToggle />

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                className="relative h-9 flex items-center gap-2 pl-1 pr-3 rounded-full hover:bg-muted transition-colors group"
              >
                <div className="relative">
                  <Avatar className="h-8 w-8 border-2 border-border group-hover:border-primary/40 transition-colors shadow-sm">
                    {getProfilePictureUrl() ? (
                      <AvatarImage 
                        src={getProfilePictureUrl()} 
                        alt={getDisplayName()}
                        className="object-cover"
                      />
                    ) : null}
                    <AvatarFallback className="bg-gradient-to-br from-primary/10 to-primary/20 text-primary font-medium text-sm">
                      {loading ? (
                        <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                      ) : (
                        getUserInitials(getDisplayName())
                      )}
                    </AvatarFallback>
                  </Avatar>
                  {!loading && !error && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-card" />
                  )}
                </div>
                
                <div className="hidden sm:flex flex-col items-start">
                  {loading ? (
                    <>
                      <Skeleton className="h-3 w-20 mb-1 bg-muted" />
                      <Skeleton className="h-2 w-16 bg-muted" />
                    </>
                  ) : error ? (
                    <>
                      <span className="text-sm font-medium text-foreground">User</span>
                      <span className="text-xs text-muted-foreground">user@example.com</span>
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-medium leading-4 text-foreground">
                        {getDisplayName()}
                      </span>
                      <span className="text-xs text-muted-foreground leading-3">
                       {user?.designation}
                      </span>
                    </>
                  )}
                </div>
                
                <ChevronDown className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent 
              align="end" 
              className="w-64 rounded-xl shadow-lg border border-border bg-popover text-popover-foreground p-2"
            >
              {/* User Info Section */}
              <div className="flex flex-col space-y-3 p-3 bg-muted/40 rounded-lg border border-border/50">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10 border-2 border-border">
                    {getProfilePictureUrl() ? (
                      <AvatarImage 
                        src={getProfilePictureUrl()} 
                        alt={getDisplayName()}
                        className="object-cover"
                      />
                    ) : null}
                    <AvatarFallback className="bg-muted text-foreground font-medium">
                      {getUserInitials(getDisplayName())}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {loading ? 'Loading...' : (error ? 'User' : getDisplayName())}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {loading ? 'Loading...' : (error ? 'user@example.com' : getUserEmail())}
                    </p>
                  </div>
                </div>
                {error && (
                  <Badge variant="destructive" className="w-fit text-xs">
                    Failed to load user data
                  </Badge>
                )}
              </div>

              <DropdownMenuSeparator className="my-2" />

              {/* Menu Items */}
              <div className="space-y-1">
                <DropdownMenuItem
                  className="flex items-center gap-3 px-3 py-2.5 cursor-pointer rounded-lg hover:bg-muted transition-colors text-foreground"
                  onSelect={() => {
                    setSupportOpen(true)
                  }}
                >
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span>Contact Support</span>
                </DropdownMenuItem>
              </div>

              <DropdownMenuSeparator className="my-2" />

              {/* Logout */}
              <DropdownMenuItem 
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer rounded-lg text-destructive hover:bg-destructive/10 transition-colors group"
                onClick={() => {
                  // The httpOnly cookie set at login can't be cleared from
                  // JS — it has to be cleared server-side. Fire-and-forget:
                  // the local session clears regardless of whether this call
                  // succeeds.
                  apiFetch('/auth/logout', { method: 'POST', redirectOnUnauthorized: false }).catch(() => {});
                  window.location.href = '/auth/login'
                }}
              >
                <LogOut className="h-4 w-4" />
                <span className="font-medium">Logout</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog open={supportOpen} onOpenChange={setSupportOpen}>
            <DialogContent className="w-[calc(100%-2rem)] max-w-md bg-card border border-border text-card-foreground">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-foreground">
                  <Mail className="h-5 w-5 text-primary" />
                  Contact Support
                </DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  Choose how you would like to email the eBadgeID support team.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 pt-2">
                <a
                  href="https://mail.google.com/mail/?view=cm&fs=1&to=support%40ebadgeid.com&su=eBadgeID%20Support%20Request"
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-11 items-center justify-between rounded-lg border border-border px-4 py-3 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-muted/60"
                >
                  <span>Open Gmail</span>
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </a>
                <a
                  href="https://outlook.office.com/mail/deeplink/compose?to=support%40ebadgeid.com&subject=eBadgeID%20Support%20Request"
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-11 items-center justify-between rounded-lg border border-border px-4 py-3 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-muted/60"
                >
                  <span>Open Outlook</span>
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </a>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </header>
    </>
  )
}
