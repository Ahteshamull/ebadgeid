"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Activity, BookOpen, CheckCircle, Clock, RefreshCw, Ticket, Users } from "lucide-react"
import { apiClient } from "@/lib/api"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"

function Metric({ title, value, description, icon: Icon }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}

export default function SupportDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await apiClient.get("/system/dashboard")
      setData(response.data?.data)
    } catch (requestError) {
      setError(requestError.response?.data?.error || "Unable to load live support metrics.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  const priorities = useMemo(() => {
    const labels = ["critical", "urgent", "high", "medium", "low"]
    return labels.map(label => ({ label, count: data?.priorities?.[label] || 0 }))
  }, [data])

  if (loading && !data) {
    return <div className="p-6 text-sm text-muted-foreground">Loading verified metrics…</div>
  }

  return (
    <div className="min-h-screen space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Support Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Live, organization-scoped operational metrics.
          </p>
        </div>
        <Button variant="outline" onClick={loadDashboard} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      {data && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Metric title="Total Tickets" value={data.total_tickets} description="All tickets in your organization" icon={Ticket} />
            <Metric title="Open Tickets" value={data.open_tickets} description="Open, pending or in progress" icon={Clock} />
            <Metric title="Resolved Tickets" value={data.resolved_tickets} description="Resolved or closed" icon={CheckCircle} />
            <Metric title="Available Agents" value={`${data.agents.active}/${data.agents.total}`} description="Active in the last five minutes" icon={Users} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader><CardTitle>Resolution Rate</CardTitle></CardHeader>
              <CardContent>
                <div className="mb-2 text-3xl font-bold">{data.resolution_rate}%</div>
                <Progress value={data.resolution_rate} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><BookOpen className="h-4 w-4" />Knowledge Base</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span>Articles</span><strong>{data.knowledge_base.articles}</strong></div>
                <div className="flex justify-between"><span>FAQs</span><strong>{data.knowledge_base.faqs}</strong></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4" />Data Integrity</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Updated {new Date(data.generated_at).toLocaleString()}. No estimated or sample values are displayed.
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Tickets by Priority</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-5">
              {priorities.map(item => (
                <div key={item.label} className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-semibold">{item.count}</div>
                  <div className="text-xs capitalize text-muted-foreground">{item.label}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
