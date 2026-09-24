// components/dashboard/main-chart.js
"use client"

import { useState } from "react"
import { Line, LineChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

const data = [
  {
    name: "Jan",
    revenue: 6500,
    expenses: 4800,
  },
  {
    name: "Feb",
    revenue: 7800,
    expenses: 5200,
  },
  {
    name: "Mar",
    revenue: 8900,
    expenses: 5800,
  },
  {
    name: "Apr",
    revenue: 7600,
    expenses: 5100,
  },
  {
    name: "May",
    revenue: 10200,
    expenses: 6400,
  },
  {
    name: "Jun",
    revenue: 11800,
    expenses: 7200,
  },
]

export function MainChart() {
  const [timeRange, setTimeRange] = useState("6M")

  // Even softer pastel colors
  const chartColors = {
    revenue: "#a3c4f3", // Very soft blue
    expenses: "#ffcfd2"  // Very soft pink
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button 
          variant={timeRange === "6M" ? "default" : "outline"}
          size="sm"
          onClick={() => setTimeRange("6M")}
        >
          6M
        </Button>
        <Button 
          variant={timeRange === "YTD" ? "default" : "outline"}
          size="sm"
          onClick={() => setTimeRange("YTD")}
        >
          YTD
        </Button>
        <Button 
          variant={timeRange === "1Y" ? "default" : "outline"}
          size="sm"
          onClick={() => setTimeRange("1Y")}
        >
          1Y
        </Button>
        <Button 
          variant={timeRange === "ALL" ? "default" : "outline"}
          size="sm"
          onClick={() => setTimeRange("ALL")}
        >
          ALL
        </Button>
      </div>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f5" />
            <XAxis 
              dataKey="name" 
              axisLine={false} 
              tickLine={false} 
              dy={10}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              dx={-10}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: 'white', 
                borderRadius: '8px', 
                borderColor: '#f0f0f0',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
                padding: '10px'
              }}
              labelStyle={{
                fontWeight: 'bold',
                marginBottom: '5px'
              }}
            />
            <Legend 
              iconType="circle" 
              wrapperStyle={{
                paddingTop: '15px'
              }}
            />
            <Line 
              type="monotone" 
              dataKey="revenue" 
              stroke={chartColors.revenue}
              strokeWidth={3}
              dot={{ stroke: chartColors.revenue, strokeWidth: 2, r: 4, fill: 'white' }}
              activeDot={{ r: 6, stroke: chartColors.revenue, strokeWidth: 2, fill: 'white' }}
              name="Revenue" 
              animationDuration={1500}
            />
            <Line 
              type="monotone" 
              dataKey="expenses" 
              stroke={chartColors.expenses}
              strokeWidth={3}
              dot={{ stroke: chartColors.expenses, strokeWidth: 2, r: 4, fill: 'white' }}
              activeDot={{ r: 6, stroke: chartColors.expenses, strokeWidth: 2, fill: 'white' }}
              name="Expenses" 
              animationDuration={1500}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}