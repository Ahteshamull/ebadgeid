"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Eye, EyeOff, Fingerprint, Loader2, ShieldCheck } from "lucide-react"
import { API_BASE_URL, ensureCsrfToken, setCsrfToken } from "@/lib/api"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function LoginPage() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  useEffect(() => {
    // Prime the cross-subdomain synchronizer token before a user submits a
    // form. A stale session cookie otherwise caused the login request in the
    // screenshot to fail with "CSRF token required".
    ensureCsrfToken().catch(() => {})
  }, [])

  async function submit(event) {
    event.preventDefault()
    setLoading(true)
    setError("")
    try {
      const csrfToken = await ensureCsrfToken()
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
      })
      const result = await response.json().catch(() => ({}))
      if (response.status === 403 && /csrf/i.test(result.message || "")) {
        setCsrfToken(null)
        throw new Error("Your security session expired. Please try signing in again.")
      }
      if (!response.ok) throw new Error(result.message || "Invalid credentials")
      // Login rotates the CSRF cookie together with the session cookie. Keep
      // the matching returned synchronizer token for the next API mutation.
      setCsrfToken(result.csrfToken)
      window.location.assign(result.role === "user" ? "/user_dash" : "/reports/organizations")
    } catch (requestError) {
      setError(requestError.message || "Unable to sign in")
    } finally {
      setLoading(false)
    }
  }

  async function resendActivation() {
    setError("")
    setNotice("")
    try {
      const csrfToken = await ensureCsrfToken()
      const response = await fetch(`${API_BASE_URL}/auth/resend-activation`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ username: username.trim().toLowerCase() }),
      })
      const result = await response.json().catch(() => ({}))
      setNotice(result.message || "If this account is awaiting activation, a new link will be sent.")
    } catch {
      setError("Unable to request a new activation link")
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 p-4">
      <Card className="w-full max-w-md border-white/10 shadow-2xl">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white">
            <Fingerprint className="h-8 w-8" />
          </div>
          <div>
            <CardTitle as="h1" className="text-2xl">Sign in to eBadge ID</CardTitle>
            <CardDescription>Secure access to credentials, goals and contracts</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
            <div className="space-y-2">
              <Label htmlFor="username">Username or email</Label>
              <Input id="username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link className="text-sm font-medium text-indigo-600 hover:underline" href="/auth/forgot-password">Forgot password?</Link>
              </div>
              <div className="relative">
                <Input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required />
                <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading || !username || !password}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Sign in
            </Button>
            <Button type="button" variant="link" className="w-full" disabled={!username} onClick={resendActivation}>
              Resend administrator activation link
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Have an invitation? <Link className="font-medium text-indigo-600 hover:underline" href="/auth/self_signup">Create your account</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
