// components/dashboard/recent-activities.js
import { BarChart3, ShoppingCart, UserPlus, AlertCircle } from "lucide-react"

export function RecentActivities() {
  const activities = [
    {
      id: 1,
      title: "New customer signed up",
      time: "5 minutes ago",
      icon: <UserPlus className="h-5 w-5 text-green-500" />,
      description: "John Smith created a new account"
    },
    {
      id: 2,
      title: "New order placed",
      time: "15 minutes ago",
      icon: <ShoppingCart className="h-5 w-5 text-blue-500" />,
      description: "Order #38293 for $729.99"
    },
    {
      id: 3,
      title: "Sales report generated",
      time: "1 hour ago",
      icon: <BarChart3 className="h-5 w-5 text-purple-500" />,
      description: "Weekly sales report was generated"
    },
    {
      id: 4,
      title: "System alert",
      time: "2 hours ago",
      icon: <AlertCircle className="h-5 w-5 text-amber-500" />,
      description: "High CPU usage detected - Server 3"
    }
  ]
  
  return (
    <div className="space-y-4">
      {activities.map((activity) => (
        <div key={activity.id} className="flex items-start space-x-4 pb-4 border-b last:border-0">
          <div className="bg-muted p-2 rounded-full">{activity.icon}</div>
          <div className="space-y-1">
            <p className="font-medium">{activity.title}</p>
            <p className="text-sm text-muted-foreground">{activity.description}</p>
            <p className="text-xs text-muted-foreground">{activity.time}</p>
          </div>
        </div>
      ))}
    </div>
  )
}