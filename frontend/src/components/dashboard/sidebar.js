"use client"

import Link from "next/link"
import { apiFetch } from "@/lib/api"
import { useSession } from '@/hooks/use-session'
import { usePathname } from "next/navigation"
import { 
  LayoutDashboard, 
  Settings, 
  HelpCircle,
  Users,
  Target,
  Fingerprint,
  Verified,
  Aperture,
  Thermometer,
  ChevronDown,
  ChevronRight,
  Crown,
  GraduationCap,
  UserCircle,
  Shield,
  Key,
  BookOpen,
  Newspaper,
  LayoutTemplate,
  CreditCard,
  Mail,
  ExternalLink,
  Award,
  FileCheck,
  X as XIcon
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useState, useEffect } from "react"

const sidebarItems = [
  {
    id: "dashboard",
    href: "/reports/organizations",
    title: "Dashboard",
    icon: <LayoutDashboard className="h-4 w-4" />,
    roles: ['admin', 'teacher', 'platform_admin'],
    description: "Overview & Analytics"
  },
  {
    id: "my_dashboard",
    href: "/user_dash",
    title: "Dashboard",
    icon: <LayoutDashboard className="h-4 w-4" />,
    roles: ['user'],
    description: "Personal Overview"
  },
  {
    id: "employees",
    href: '/users',
    title: "Manage Users",
    icon: <Users className="h-4 w-4" />,
    // The API keeps this list organization-scoped for every role. Including
    // platform_admin here matches its existing backend authorization and the
    // users page guard; it does not grant cross-organization access.
    roles: ["admin", "teacher", "platform_admin"],
    description: "User Management"
  },
  {
    id: "my_creds",
    href: "/creds",
    title: "My Credentials",
    icon: <Fingerprint className="h-4 w-4" />,
    roles: ['user'],
    description: "Digital Certificates"
  },
  {
    id: "manage_contracts",
    href: "/manage_contracts",
    title: "Manage Contracts",
    icon: <Newspaper className="h-4 w-4" />,
    roles: ['admin', 'platform_admin'],
    description: "Manage Contracts"
  },
  {
    id: "my_goals",
    href: "/my_goals",
    title: "My Goals",
    icon: <Target className="h-4 w-4" />,
    roles: ['user'],
    description: "Track Objectives"
  },
  {
    id: "issue_credential",
    href: '/credentials',
    title: "Manage Credentials",
    icon: <Verified className="h-4 w-4" />,
    roles: ["teacher", "admin", "platform_admin"],
    description: "Issue & Track Credentials"
  },
  {
    id: "certificates",
    href: '/credentials/certificates',
    title: "Certificates",
    icon: <FileCheck className="h-4 w-4" />,
    roles: ["admin", "platform_admin"],
    description: "Institutional Certificates"
  },
  {
    id: "badges",
    href: '/credentials/badges',
    title: "Digital Badges",
    icon: <Award className="h-4 w-4" />,
    roles: ["admin", "platform_admin"],
    description: "Visual Achievement Badges"
  },
  {
    id: "manage_goals",
    href: '/goals',
    title: "Manage Goals",
    icon: <Thermometer className="h-4 w-4" />,
    roles: ["teacher", "admin"],
    description: "Goal System"
  },
  {
    id: "platform_payments",
    href: '/platform/payments',
    title: "Payment Approvals",
    icon: <CreditCard className="h-4 w-4" />,
    roles: ["platform_admin", "admin"],
    description: "Review and approve paid self-signups"
  },
  {
    id: "settings",
    href: '/settings',
    title: "Settings",
    icon: <Settings className="h-4 w-4" />,
    roles: ["teacher", "admin", "user", "platform_admin"],
    description: "Account & Preferences"
  },
]

// On a mobile-width viewport this used to render as a permanently visible,
// fixed 320px-wide panel with no way to collapse it -- confirmed for real
// on a 375px viewport: it covered the entire screen and shoved the page's
// actual content off past the right edge, unreachable. `open`/`onClose`
// make it an off-canvas drawer below the `md` breakpoint (toggled by the
// hamburger button in Header) while leaving desktop behavior (always
// visible, no drawer/backdrop) completely unchanged via the md:translate-x-0
// override below.
export function Sidebar({ open = false, onClose }) {
  const { session, loading: sessionLoading } = useSession();
  const [supportOpen, setSupportOpen] = useState(false)
  const pathname = usePathname();
  const [expandedItems, setExpandedItems] = useState({});
  const [role, setRole] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const username = session?.username;
        setRole(session?.role);

        if (!username) {
          // useSession()'s own /auth/me call is still in flight on first
          // mount, so `session` is briefly null before it resolves — that's
          // not a real error, this effect reruns once session lands. Only
          // treat a missing username as a genuine failure once useSession
          // itself has finished loading and still has no session; either
          // way, clear any stale error from a previous run so a successful
          // fetch below doesn't stay masked by it.
          setError(sessionLoading ? null : 'No authenticated user');
          setLoading(sessionLoading);
          return;
        }

        const response = await apiFetch(`/users/username/${username}`);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const userData = await response.json();
        setUser(userData);
        setError(null);
      } catch (err) {
        console.error('Error fetching user data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, [session, sessionLoading]);

  const getUserInitials = (name) => {
    if (!name) return 'U';
    const names = name.split(' ');
    if (names.length >= 2) {
      return `${names[0][0]}${names[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const getProfilePictureUrl = () => {
    return user?.avatar || user?.profile_picture_url || user?.image || user?.photo || user?.avatarUrl || null;
  };

  const getDisplayName = () => {
    if (user?.first_name) return `${user.first_name} ${user.last_name}`;
    if (user?.firstName && user?.lastName) return `${user.firstName} ${user.lastName}`;
    if (user?.name) return user.name;
    if (user?.username) return user.username;
    return 'User';
  };

  const getRoleDisplayName = () => {
    if (loading) return 'Loading...';
    if (error || !role) return 'User';
    
    switch (role.toLowerCase()) {
      case 'admin':
        return 'Administrator';
      case 'teacher':
        return 'Teacher';
      case 'user':
        return 'Student';
      default:
        return role.charAt(0).toUpperCase() + role.slice(1);
    }
  };

  const getRoleIcon = () => {
    switch (role?.toLowerCase()) {
      case 'admin':
        return <Crown className="h-3 w-3" />;
      case 'teacher':
        return <GraduationCap className="h-3 w-3" />;
      case 'user':
        return <UserCircle className="h-3 w-3" />;
      default:
        return <Shield className="h-3 w-3" />;
    }
  };

  const toggleNested = (title) => {
    setExpandedItems((prev) => ({
      ...prev,
      [title]: !prev[title],
    }));
  };

  const filterSidebarItems = (items, role) => {
    return items.filter(item => {
      if (item.roles && !item.roles.includes(role)) {
        return false;
      }
      if (item.nested) {
        item.nested = filterSidebarItems(item.nested, role);
        if (item.nested.length === 0) {
          return false;
        }
      }
      return true;
    });
  };

  if (!role) {
    return (
      <div
        className={cn(
          "fixed top-0 left-0 h-screen w-80 flex flex-col bg-white border-r border-gray-100 z-30 transition-transform duration-200 md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="p-6 flex items-center justify-center">
          <div className="animate-pulse text-gray-500">Loading...</div>
        </div>
      </div>
    );
  }

  const filteredSidebarItems = filterSidebarItems(sidebarItems, role);

  return (
    <>
      {/* Backdrop -- mobile-only (drawer mode), dismisses on click/tap.
          Desktop never renders this since the drawer state doesn't apply
          there (md:translate-x-0 below always shows the sidebar). */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-20 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        aria-label="Main navigation"
        className={cn(
          "fixed top-0 left-0 h-screen w-80 flex flex-col bg-card border-r border-border z-30 transition-transform duration-200 md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Was a plain <div> -- the profile card above the nav, and the
            "Contact Support" box below it, both sat outside the inner <nav>
            and outside any landmark, a real, verified a11y violation (content
            not contained by any landmark) on every authenticated page. This
            IS the app's sidebar, so <aside> is the correct landmark for the
            whole thing, nav included. */}
        {/* Close button -- mobile-only, the drawer's only keyboard/screen-
            reader-operable way to dismiss it (the backdrop above is a
            click/tap-only affordance). */}
        <button
          onClick={onClose}
          aria-label="Close navigation menu"
          className="md:hidden absolute top-4 right-4 p-2 rounded-full hover:bg-muted text-muted-foreground"
        >
          <XIcon className="h-5 w-5" />
        </button>
        {/* User Profile Section */}
      <div className="p-2 mt-20 border-b border-border">
        <Card className="bg-muted/40 border border-border/50 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12 border-2 border-border shadow-sm">
                {getProfilePictureUrl() ? (
                  <AvatarImage 
                    src={getProfilePictureUrl()} 
                    alt={getDisplayName()}
                    className="object-cover"
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary font-medium text-sm">
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  ) : (
                    getUserInitials(getDisplayName())
                  )}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-semibold text-foreground truncate">
                    {loading ? 'Loading...' : (error ? 'User' : getDisplayName())}
                  </h3>
                  <div className="flex items-center gap-1 px-2 py-1 bg-muted rounded-full">
                    {getRoleIcon()}
                    <span className="text-xs font-medium text-muted-foreground">
                      {getRoleDisplayName()}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {loading ? 'Loading...' : (error ? 'user@example.com' : user?.designation || 'user@example.com')}
                </p>
                {error && (
                  <p className="text-xs text-destructive truncate mt-1">
                    Failed to load user data
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Navigation Section */}
      <div className="flex-1 overflow-y-auto">
        <nav className="p-4">
          <div className="mb-4">
          
            <div className="space-y-1">
              {filteredSidebarItems.map((item) => {
                const isActive = pathname === item.href;
                
                return (
                  <div key={item.id} className="group">
                    <Link href={item.href}>
                      <div className={cn(
                        "w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 cursor-pointer",
                        isActive 
                          ? "bg-primary text-primary-foreground shadow-sm" 
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}>
                        <div className={cn(
                          "flex items-center justify-center w-8 h-8 rounded-lg transition-colors",
                          isActive 
                            ? "bg-primary-foreground/20 text-primary-foreground" 
                            : "bg-muted text-muted-foreground group-hover:bg-muted/80 group-hover:text-foreground"
                        )}>
                          {item.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className={cn(
                              "text-sm font-medium transition-colors",
                              isActive ? "text-primary-foreground font-semibold" : "text-foreground group-hover:text-foreground"
                            )}>
                              {item.title}
                            </span>
                            {item.nested && (
                              <ChevronRight className={cn(
                                "h-4 w-4 transition-transform duration-200",
                                expandedItems[item.title] ? "rotate-90" : "",
                                isActive ? "text-primary-foreground/70" : "text-muted-foreground"
                              )} />
                            )}
                          </div>
                          {item.description && (
                            <p className={cn(
                              "text-xs transition-colors truncate",
                              isActive ? "text-primary-foreground/70" : "text-muted-foreground group-hover:text-foreground"
                            )}>
                              {item.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </Link>
                    
                    {item.nested && expandedItems[item.title] && (
                      <div className="ml-4 pl-8 mt-1 space-y-1 border-l border-border">
                        {item.nested.map((nestedItem) => {
                          const isNestedActive = pathname === nestedItem.href;
                          
                          return (
                            <Link key={nestedItem.id} href={nestedItem.href}>
                              <div className={cn(
                                "w-full flex items-center gap-3 p-2 rounded-lg transition-all duration-200 cursor-pointer",
                                isNestedActive 
                                  ? "bg-primary/90 text-primary-foreground" 
                                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
                              )}>
                                <div className={cn(
                                  "w-2 h-2 rounded-full transition-colors",
                                  isNestedActive ? "bg-primary-foreground" : "bg-muted-foreground group-hover:bg-foreground"
                                )} />
                                <span className={cn(
                                  "text-sm font-medium",
                                  isNestedActive ? "text-primary-foreground font-semibold" : "text-muted-foreground group-hover:text-foreground"
                                )}>
                                  {nestedItem.title}
                                </span>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </nav>
      </div>
      
      {/* Help Section */}
      <div className="p-6 border-t border-border mt-auto">
        <Card className="bg-primary/5 border border-primary/20 shadow-sm">
          <CardContent className="p-4">
            <div className="flex flex-col space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                  <HelpCircle className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-foreground">
                    Need help?
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Get support from our team
                  </p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => setSupportOpen(true)}
                className="w-full h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Contact Support
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
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
      </aside>
    </>
  )
}
