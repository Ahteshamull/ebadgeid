"use client"

import { useState } from "react"
import Link from "next/link"
import { KeyRound, Loader2 } from "lucide-react"
import { API_BASE_URL, ensureCsrfToken } from "@/lib/api"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function ForgotPasswordPage() {
  const [username, setUsername] = useState("")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")

  async function submit(event) {
    event.preventDefault()
    setLoading(true)
    try {
      const csrfToken = await ensureCsrfToken()
      const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        // Explicit rather than relying on the backend's default: the
        // emailed link must come back to THIS app, and stating the origin
        // keeps that true even if the default ever changes. The backend
        // allowlists this against the origins it already declares, so an
        // unrecognized value can never redirect the link off-platform.
        body: JSON.stringify({
          username: username.trim().toLowerCase(),
          app: typeof window !== "undefined" ? window.location.origin : undefined,
        }),
      })
      const result = await response.json().catch(() => ({}))
      setMessage(result.message || "If this account exists, a password reset link has been sent.")
    } catch {
      setMessage("If this account exists, a password reset link has been sent.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <KeyRound className="mx-auto mb-3 h-10 w-10 text-indigo-600" />
          <CardTitle>Forgot your password?</CardTitle>
          <CardDescription>Enter your username and we&apos;ll email you a reset link.</CardDescription>
        </CardHeader>
        <CardContent>
          {message ? (
            <div className="space-y-4 text-center">
              <Alert><AlertDescription>{message}</AlertDescription></Alert>
              <Button asChild variant="outline" className="w-full"><Link href="/auth/login">Back to sign in</Link></Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username or email</Label>
                <Input id="username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required />
              </div>
              <Button type="submit" className="w-full" disabled={loading || !username}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send reset link
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                <Link className="font-medium text-indigo-600 hover:underline" href="/auth/login">Back to sign in</Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
