"use client"

import { Card, CardContent } from "@/components/ui/card"

export function UserWelcome() {
  // Get the current hour to customize the greeting
  const currentHour = new Date().getHours()
  
  let greeting
  if (currentHour < 12) {
    greeting = "Good morning"
  } else if (currentHour < 18) {
    greeting = "Good afternoon"
  } else {
    greeting = "Good evening"
  }

  return (
    <Card style={{ backgroundColor: "#8dd9cc" }}>
      <CardContent className="p-6">
        <div className="flex flex-col space-y-2">
          <h2 className="text-3xl font-bold text-gray-900">{greeting}, Jaffery</h2>
          <p className="text-gray-800">
            Here&apos;s what&apos;s happening with your business today.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}