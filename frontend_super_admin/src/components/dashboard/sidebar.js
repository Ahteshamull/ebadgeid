"use client"

import Link from "next/link"
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
  Building
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { useState, useMemo } from "react"
import { useLocale } from '../../context/Localecontext'
import { useSession } from "@/hooks/use-session"

export function Sidebar({ }) {
  const pathname = usePathname();
  const [expandedItems, setExpandedItems] = useState({});
  const { t } = useLocale();
  // SA-01 fix: this used to read localStorage.getItem('role'/'username')
  // and fetch straight to a hardcoded, unauthenticated URL -- once login
  // stopped writing those keys, this was always null (the real cause of
  // "Failed to load user data" here and in Header). One shared /auth/me
  // call now backs both components.
  const { session, loading, error } = useSession();
  const role = session?.role || null;
  const user = session?.profile || null;

  const sidebarItems = useMemo(() => {
    return [
      {
        id: "dashboard",
        href: "/reports/organizations",
        title: t("dashboard"),
        icon: <LayoutDashboard className="h-4 w-4" />,
        roles: ['admin', 'teacher'],
        description: t("dashboard_description")
      },
      {
        id: "dashboard_super",
        href: "/super_admin",
        title: t("dashboard"),
        icon: <LayoutDashboard className="h-4 w-4" />,
        roles: ['super_admin', 'platform_admin'],
      },
      {
        id: "organization_management",
        href: "/super_admin/organizations",
        title: t("organization_management"),
        icon: <Building className="h-4 w-4" />,
        roles: ['super_admin', 'platform_admin'],
      },
      {
        id: "users_management",
        href: "/super_admin/users",
        title: t("user_management"),
        icon: <Users className="h-4 w-4" />,
        roles: ['super_admin', 'platform_admin'],
      },
      {
        id: "payment_proof",
        href: "/super_admin/payment_proofs",
        title: t("payment_proofs"),
        icon: <BookOpen className="h-4 w-4" />,
        roles: ['super_admin', 'platform_admin'],
      },
      {
        id: "transactions",
        href: "/super_admin/transactions",
        title: t("transactions"),
        icon: <Target className="h-4 w-4" />,
        roles: ['super_admin', 'platform_admin'],
      },
      {
        id: "my_dashboard",
        href: "/user_dash",
        title: t("dashboard"),
        icon: <LayoutDashboard className="h-4 w-4" />,
        roles: ['user'],
        description: t("my_dashboard_description")
      },
      {
        id: "employees",
        href: '/users',
        title: t("manage_users"),
        icon: <Users className="h-4 w-4" />,
        roles: ["admin", "teacher"],
        description: t("manage_users_description")
      },
      {
        id: "my_creds",
        href: "/creds",
        title: t("my_credentials"),
        icon: <Fingerprint className="h-4 w-4" />,
        roles: ['user'],
        description: t("my_credentials_description")
      },
      {
        id: "issue_credential",
        href: '/credentials',
        title: t("manage_credentials"),
        icon: <Verified className="h-4 w-4" />,
        roles: ["teacher", "admin"],
        description: t("manage_credentials_description")
      },
      {
        id: "manage_contracts",
        href: "/manage_contracts",
        title: t("manage_contracts"),
        icon: <Newspaper className="h-4 w-4" />,
        roles: ['admin'],
        description: t("manage_contracts_description")
      },
      {
        id: "api_tokens",
        href: '/api_tokens',
        title: t("api_keys"),
        icon: <Key className="h-4 w-4" />,
        roles: ["teacher", "admin"],
        description: t("api_keys_description")
      },
      {
        id: "settings",
        href: '/settings',
        title: t("settings"),
        icon: <Settings className="h-4 w-4" />,
        roles: ["teacher", "admin", "user", 'super_admin', 'platform_admin'],
        description: t("settings_description")
      },
    ];
  }, [t]);

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
      <div className="fixed top-0 left-0 h-screen w-80 flex flex-col bg-white border-r border-gray-100 z-30">
        <div className="p-6 flex items-center justify-center">
          <div className="animate-pulse text-gray-500">Loading...</div>
        </div>
      </div>
    );
  }

  const filteredSidebarItems = filterSidebarItems(sidebarItems, role);

  return (
    <div className="fixed top-0 left-0 h-screen w-80 flex flex-col bg-white border-r border-gray-100 z-30">


      {/* User Profile Section */}
      <div className="p-2 mt-20 border-b border-gray-100">
        <Card className="bg-gradient-to-br from-gray-50 to-gray-100/30 border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12 border-2 border-white shadow-sm">
                {getProfilePictureUrl() ? (
                  <AvatarImage
                    src={getProfilePictureUrl()}
                    alt={getDisplayName()}
                    className="object-cover"
                  />
                ) : null}
                <AvatarFallback className="bg-gradient-to-br from-gray-600 to-gray-400 text-white font-medium text-sm">
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    getUserInitials(getDisplayName())
                  )}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-semibold text-gray-900 truncate">
                    {loading ? 'Loading...' : (error ? 'User' : getDisplayName())}
                  </h3>
                  <div className="flex items-center gap-1 px-2 py-1 bg-gray-100 rounded-full">
                    {getRoleIcon()}
                    <span className="text-xs font-medium text-gray-700">
                      {getRoleDisplayName()}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-gray-500 truncate">
                  {loading ? 'Loading...' : (error ? 'user@example.com' : user?.designation || 'user@example.com')}
                </p>
                {error && (
                  <p className="text-xs text-red-500 truncate mt-1">
                    {t("error_loading_user_data")}
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
                          ? "bg-gray-900 text-white shadow-sm"
                          : "text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                      )}>
                        <div className={cn(
                          "flex items-center justify-center w-8 h-8 rounded-lg transition-colors",
                          isActive
                            ? "bg-white/20 text-white"
                            : "bg-gray-100 text-gray-600 group-hover:bg-gray-200 group-hover:text-gray-700"
                        )}>
                          {item.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className={cn(
                              "text-sm font-medium transition-colors",
                              isActive ? "text-white" : "text-gray-900 group-hover:text-gray-900"
                            )}>
                              {item.title}
                            </span>
                            {item.nested && (
                              <ChevronRight className={cn(
                                "h-4 w-4 transition-transform duration-200",
                                expandedItems[item.title] ? "rotate-90" : "",
                                isActive ? "text-white/70" : "text-gray-400"
                              )} />
                            )}
                          </div>
                          {item.description && (
                            <p className={cn(
                              "text-xs transition-colors truncate",
                              isActive ? "text-white/70" : "text-gray-500 group-hover:text-gray-600"
                            )}>
                              {item.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </Link>

                    {item.nested && expandedItems[item.title] && (
                      <div className="ml-4 pl-8 mt-1 space-y-1 border-l border-gray-200">
                        {item.nested.map((nestedItem) => {
                          const isNestedActive = pathname === nestedItem.href;

                          return (
                            <Link key={nestedItem.id} href={nestedItem.href}>
                              <div className={cn(
                                "w-full flex items-center gap-3 p-2 rounded-lg transition-all duration-200 cursor-pointer",
                                isNestedActive
                                  ? "bg-gray-800 text-white"
                                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-800"
                              )}>
                                <div className={cn(
                                  "w-2 h-2 rounded-full transition-colors",
                                  isNestedActive ? "bg-white" : "bg-gray-300 group-hover:bg-gray-400"
                                )} />
                                <span className={cn(
                                  "text-sm font-medium",
                                  isNestedActive ? "text-white" : "text-gray-700"
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
      <div className="p-6 border-t border-gray-100 mt-auto">
        <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex flex-col space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                  <HelpCircle className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-gray-900">
                    {t("help_title")}
                  </h4>
                  <p className="text-xs text-gray-600">
                    {t("help_description")}
                  </p>
                </div>
              </div>
              <div className="flex ">

                <Link href="https://help.ebadgeid.com" className="flex-1">
                  <Button
                    size="sm"
                    className="w-full h-8 text-xs bg-gray-900 text-white hover:bg-gray-800"
                  >
                    {t("contact_support")}
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}