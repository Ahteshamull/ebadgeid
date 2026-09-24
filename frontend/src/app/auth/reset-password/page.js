"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { KeyRound, Loader2 } from "lucide-react"
import { API_BASE_URL, ensureCsrfToken } from "@/lib/api"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function ResetPasswordPage() {
  const [credentials, setCredentials] = useState({ username: "", token: "" })
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""))
    setCredentials({ username: params.get("username") || "", token: params.get("token") || "" })
    window.history.replaceState({}, "", window.location.pathname)
  }, [])

  async function resetPassword(event) {
    event.preventDefault()
    setError("")
    if (password.length < 12 || password !== confirmPassword) {
      setError(password.length < 12 ? "Use at least 12 characters." : "Passwords do not match.")
      return
    }
    setLoading(true)
    try {
      const csrfToken = await ensureCsrfToken()
      const response = await fetch(`${API_BASE_URL}/auth/reset-password`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ ...credentials, password, confirmPassword }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || "Unable to reset password")
      setMessage(result.message)
      setPassword("")
      setConfirmPassword("")
    } catch (requestError) {
      setError(requestError.message || "Unable to reset password")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <KeyRound className="mx-auto mb-3 h-10 w-10 text-indigo-600" />
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>Choose a new password. This link works only once.</CardDescription>
        </CardHeader>
        <CardContent>
          {message ? (
            <div className="space-y-4 text-center"><Alert><AlertDescription>{message}</AlertDescription></Alert><Button asChild><Link href="/auth/login">Continue to sign in</Link></Button></div>
          ) : (
            <form onSubmit={resetPassword} className="space-y-4">
              {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
              {!credentials.token && <Alert variant="destructive"><AlertDescription>The reset link is incomplete. Request a new one.</AlertDescription></Alert>}
              <div className="space-y-2"><Label>Account</Label><Input value={credentials.username} disabled /></div>
              <div className="space-y-2"><Label htmlFor="password">New password</Label><Input id="password" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} required /></div>
              <div className="space-y-2"><Label htmlFor="confirm">Confirm password</Label><Input id="confirm" type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required /></div>
              <Button type="submit" className="w-full" disabled={loading || !credentials.token}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Reset password</Button>
              <p className="text-center text-sm text-muted-foreground">
                <Link className="font-medium text-indigo-600 hover:underline" href="/auth/forgot-password">Request a new link</Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
