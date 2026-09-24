"use client"

import { useEffect, useState } from "react"
import { KeyRound, Loader2 } from "lucide-react"
import { API_BASE_URL, ensureCsrfToken } from "@/lib/api"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function ActivateAccountPage() {
  const [credentials, setCredentials] = useState({ username: "", token: "" })
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [requiresPasswordSetup, setRequiresPasswordSetup] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""))
    setCredentials({ username: params.get("username") || "", token: params.get("token") || "" })
    setRequiresPasswordSetup(params.get("setup_password") === "1")
    window.history.replaceState({}, "", window.location.pathname)
  }, [])

  async function activate(event) {
    event.preventDefault()
    setError("")
    if (requiresPasswordSetup && (password.length < 12 || password !== confirmPassword)) {
      setError(password.length < 12 ? "Use at least 12 characters." : "Passwords do not match.")
      return
    }
    setLoading(true)
    try {
      const csrfToken = await ensureCsrfToken()
      const response = await fetch(`${API_BASE_URL}/auth/activate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({
          ...credentials,
          ...(requiresPasswordSetup ? { password, confirmPassword } : {}),
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (response.status === 400 && result.requiresPasswordSetup) {
        setRequiresPasswordSetup(true)
        setError("Choose a password to finish activating this account.")
        return
      }
      if (!response.ok) throw new Error(result.message || "Activation failed")
      window.location.assign("/auth/login?activated=1")
    } catch (requestError) {
      setError(requestError.message || "Activation failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <KeyRound className="mx-auto mb-3 h-10 w-10 text-indigo-600" />
          <CardTitle>Activate administrator account</CardTitle>
          <CardDescription>{requiresPasswordSetup ? "Choose a strong password. This link works only once." : "Your account will be activated securely with this single-use link."}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={activate} className="space-y-4">
              {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
              {!credentials.token && <Alert variant="destructive"><AlertDescription>The activation link is incomplete.</AlertDescription></Alert>}
              <div className="space-y-2"><Label>Account</Label><Input value={credentials.username} disabled /></div>
              {requiresPasswordSetup && <><div className="space-y-2"><Label htmlFor="password">New password</Label><Input id="password" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} required /></div>
              <div className="space-y-2"><Label htmlFor="confirm">Confirm password</Label><Input id="confirm" type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required /></div></>}
              <Button type="submit" className="w-full" disabled={loading || !credentials.token}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Activate account</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
