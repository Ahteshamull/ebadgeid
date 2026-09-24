"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { 
  LayoutDashboard, 
  Settings, 
  HelpCircle,
  MessageSquare,
  Cat,
  BookCheck,
  Disc2,
  GraduationCap,
  SquareSlash,
  ForkKnife,
  PersonStanding,
  DollarSign,
  Receipt,
  ChevronDown,
  ChevronUp,
  TimerIcon,
  HousePlugIcon,
  Beaker,
  School,
  PenBox,
  HandCoins,
  Badge,
  CakeIcon,
  PartyPopper,
  Users,
  UserCog,
  ChefHat,
  Fingerprint,
  PenLine,
  BusIcon,
  Mic2,
  Paperclip,
  FileDigit,
  File,
  BlendIcon,
  ListCheckIcon,
  Inbox,
  TriangleDashed,
  MoveUp,
  TypeIcon,
  TrendingUp,
  TrendingDown,
  BadgeDollarSign,
  LoaderPinwheelIcon,
  History,
  ReceiptPoundSterling,
  SquareScissors,
  Drumstick,
  HousePlug,
  SquareBottomDashedScissors,
  Calendar,
  BusFront,
  BookAudio,
  LayoutDashboardIcon,
  Users2,
  WalletCards,
  Verified,
  ThermometerSnowflakeIcon,
  LucideFingerprint,
  Target,
  Settings2Icon,
  ApertureIcon
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { useState } from "react"
import { useSession } from "@/hooks/use-session"

const sidebarItems = [
  
  {
    id: "dashboard",
    href: "/reports/organizations",
    title: "Dashboard",
    icon: <LayoutDashboardIcon />,
    roles: ['admin', 'agent']
  },
 
  {
    id: "employees",
    href: '/users',
    title: "Manage Users",
    icon: <Users2 className="h-4 w-4" />,
    roles: ["admin"]
  },
  {
    id: "support_tickets",
    href: "/tickets",
    title: "Support Tickets",
    icon: <Target />,
    roles: ['admin', 'agent']
  },
   {
    id: "articles",
    href: "/article_management",
    title: "Articles",
    icon: <Target />,
    roles: ['admin', 'agent']
  },
    {
    id: "faq",
    href: "/faqs",
    title: "FAQs",
    icon: <Target />,
    roles: ['admin', 'agent']
  },
  {
    id: "settings",
    href: '/settings',
    title: "Settings",
    icon: <Settings2Icon className="h-4 w-4" />,
    roles: ["admin", "agent", "user"]
  },
]

export function Sidebar({}) {
  const pathname = usePathname();
  const [expandedItems, setExpandedItems] = useState({});
  const { user, loading, error } = useSession();
  const role = user?.user_type || user?.role || null;

  // Function to get user initials (fallback only)
  const getUserInitials = (name) => {
    if (!name) return 'U';
    const names = name.split(' ');
    if (names.length >= 2) {
      return `${names[0][0]}${names[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  // Function to get profile picture URL
  const getProfilePictureUrl = () => {
    return user?.avatar || user?.profile_picture_url || user?.image || user?.photo || user?.avatarUrl || null;
  };

  // Function to get display name
  const getDisplayName = () => {
    if (user?.first_name) return `${user.first_name} ${user.last_name}`;
    if (user?.firstName && user?.lastName) return `${user.firstName} ${user.lastName}`;
    if (user?.name) return user.name;
    if (user?.username) return user.username;
    return 'User';
  };

  // Function to get role display name
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
      <div className="fixed top-2 bottom-2 left-0 h-screen w-70 flex flex-col bg-background border-r z-30">
        <div className="p-4 mt-5 pt-16 flex items-center justify-center">
          <div className="animate-pulse">Loading...</div>
        </div>
      </div>
    );
  }

  const filteredSidebarItems = filterSidebarItems(sidebarItems, role);

  return (
    <div className="fixed top-2 bottom-2 left-0 h-screen w-70 flex flex-col bg-background border-r z-30">
      {/* Top section with user profile */}
      <div className="p-4 mt-5 pt-16"> {/* Added pt-16 to account for header height */}
        <Card className="overflow-hidden">
          <CardHeader className="p-3 bg-gradient-to-r from-primary/10 to-primary/5">
            <div className="flex items-center gap-3">
              <Avatar className="h-9 w-9 border-2 border-background">
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
              <div className="min-w-0 flex-1">
                <CardTitle className="text-sm font-medium truncate">
                  {loading ? 'Loading...' : (error ? 'User' : getDisplayName())}
                </CardTitle>
                <p className="text-xs text-muted-foreground truncate">
                  {getRoleDisplayName()}
                </p>
                {error && (
                  <p className="text-xs text-red-500 truncate">
                    Failed to load
                  </p>
                )}
              </div>
            </div>
          </CardHeader>
        </Card>
      </div>
      
      {/* Navigation section with proper overflow handling */}
      <div className="flex-1 overflow-y-auto">
        <nav className="px-2 mb-2">
          <p className="text-xs font-medium text-muted-foreground ml-3 mb-2">NAVIGATION</p>
          <div className="space-y-1">
            {filteredSidebarItems.map((item) => (
              <div key={item.id}>
                {item.href ? (
                  <Link href={item.href}>
                    <Button
                      variant={pathname === item.href ? "secondary" : "ghost"}
                      className={cn(
                        "w-full justify-between text-sm h-9",
                        pathname === item.href && "font-medium"
                      )}
                      onClick={item.nested ? () => toggleNested(item.title) : undefined}
                    >
                      <div className="flex items-center">
                        {item.icon}
                        <span className="ml-2">{item.title}</span>
                      </div>
                      {item.nested && (
                        <span>
                          {expandedItems[item.title] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </span>
                      )}
                    </Button>
                  </Link>
                ) : (
                  <Button
                    variant="ghost"
                    className="w-full justify-between text-sm h-9"
                    onClick={() => toggleNested(item.title)}
                  >
                    <div className="flex items-center">
                      {item.icon}
                      <span className="ml-2">{item.title}</span>
                    </div>
                    {item.nested && (
                      <span>
                        {expandedItems[item.title] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </span>
                    )}
                  </Button>
                )}
                
                {item.nested && expandedItems[item.title] && (
                  <div className="pl-6 space-y-1">
                    {item.nested.map((nestedItem) => (
                      <Link key={nestedItem.id} href={nestedItem.href}>
                        <Button
                          variant={pathname === nestedItem.href ? "secondary" : "ghost"}
                          className={cn(
                            "w-full justify-start text-sm h-9",
                            pathname === nestedItem.href && "font-medium"
                          )}
                        >
                          {nestedItem.icon}
                          <span className="ml-2">{nestedItem.title}</span>
                        </Button>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </nav>
      </div>
      
      {/* Help card section with proper positioning */}
      <div className="p-4 mb-15 border-t mt-auto">
       
      </div>
    </div>
  )
}
