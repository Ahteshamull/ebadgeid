"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Building2, CheckCircle2, Eye, EyeOff, Fingerprint, Loader2, UserPlus } from "lucide-react"
import { apiFetch } from "@/lib/api"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initialForm = {
  first_name: "", last_name: "", email: "", designation: "", organization_name: "",
  phone: "", city: "", state: "", country: "", password: "", confirm_password: "",
}

export default function AdministratorSignupPage() {
  const [form, setForm] = useState(initialForm)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [complete, setComplete] = useState(false)
  const passwordProblem = useMemo(() => {
    if (!form.password) return ""
    if (form.password.length < 12) return "Use at least 12 characters."
    if (form.confirm_password && form.password !== form.confirm_password) return "Passwords do not match."
    return ""
  }, [form.password, form.confirm_password])

  const update = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }))

  async function submit(event) {
    event.preventDefault()
    setError("")
    if (form.password.length < 12 || form.password !== form.confirm_password) {
      setError(form.password.length < 12 ? "Use a password with at least 12 characters." : "Passwords do not match.")
      return
    }
    setLoading(true)
    try {
      const response = await apiFetch("/organizations/administrator-signup", {
        method: "POST",
        redirectOnUnauthorized: false,
        body: JSON.stringify({
          ...form,
          email: form.email.trim().toLowerCase(),
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          designation: form.designation.trim(),
          organization_name: form.organization_name.trim(),
          phone: form.phone.trim(), city: form.city.trim(), state: form.state.trim(), country: form.country.trim(),
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || "Unable to create your administrator account.")
      setForm(initialForm)
      setComplete(true)
    } catch (requestError) {
      setError(requestError.message || "Unable to create your administrator account.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-4 py-10">
      <Card className="mx-auto w-full max-w-3xl border-white/10 shadow-2xl">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white"><Fingerprint className="h-8 w-8" /></div>
          <div><CardTitle as="h1" className="text-2xl">Create your eBadge ID administrator account</CardTitle><CardDescription>Your organization and administrator account are created together. Activate it securely from your email.</CardDescription></div>
        </CardHeader>
        <CardContent>
          {complete ? (
            <div className="space-y-5 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" /><Alert><AlertDescription>Your administrator account was created. Check your corporate email and use the secure activation link within one hour.</AlertDescription></Alert><Button asChild><Link href="/auth/login">Back to sign in</Link></Button></div>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
              <section className="space-y-4"><div className="flex items-center gap-2 font-semibold"><UserPlus className="h-4 w-4" /> Administrator details</div><div className="grid gap-4 sm:grid-cols-2">
                <Field label="Administrator First Name" id="first_name" value={form.first_name} onChange={update("first_name")} autoComplete="given-name" />
                <Field label="Administrator Last Name" id="last_name" value={form.last_name} onChange={update("last_name")} autoComplete="family-name" />
                <Field label="Institutional / Corporate Email" id="email" type="email" value={form.email} onChange={update("email")} autoComplete="email" />
                <Field label="Designation" id="designation" value={form.designation} onChange={update("designation")} autoComplete="organization-title" />
              </div></section>
              <section className="space-y-4"><div className="flex items-center gap-2 font-semibold"><Building2 className="h-4 w-4" /> Organization details</div><div className="grid gap-4 sm:grid-cols-2">
                <Field label="Organization Name" id="organization_name" value={form.organization_name} onChange={update("organization_name")} className="sm:col-span-2" autoComplete="organization" />
                <Field label="Phone Number" id="phone" type="tel" value={form.phone} onChange={update("phone")} autoComplete="tel" />
                <Field label="City" id="city" value={form.city} onChange={update("city")} autoComplete="address-level2" />
                <Field label="State / Province" id="state" value={form.state} onChange={update("state")} autoComplete="address-level1" />
                <Field label="Country" id="country" value={form.country} onChange={update("country")} autoComplete="country-name" />
              </div></section>
              <section className="space-y-4"><div className="font-semibold">Secure password</div><div className="grid gap-4 sm:grid-cols-2"><PasswordField label="Password" id="password" value={form.password} onChange={update("password")} show={showPassword} toggle={() => setShowPassword((value) => !value)} /><PasswordField label="Confirm Password" id="confirm_password" value={form.confirm_password} onChange={update("confirm_password")} show={showPassword} toggle={() => setShowPassword((value) => !value)} /></div>{passwordProblem && <p className="text-sm text-destructive">{passwordProblem}</p>}<p className="text-xs text-muted-foreground">Use at least 12 characters. Your password is encrypted on the server and is never sent by email.</p></section>
              <Button type="submit" className="w-full" disabled={loading || Boolean(passwordProblem)}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}Create administrator account</Button>
              <p className="text-center text-sm text-muted-foreground">Already have an account? <Link className="font-medium text-indigo-600 hover:underline" href="/auth/login">Sign in</Link></p>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

function Field({ label, id, className = "", ...props }) {
  return <div className={`space-y-2 ${className}`}><Label htmlFor={id}>{label}</Label><Input id={id} required {...props} /></div>
}

function PasswordField({ label, id, show, toggle, ...props }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><div className="relative"><Input id={id} type={show ? "text" : "password"} required minLength={12} autoComplete="new-password" {...props} /><Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={toggle} aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button></div></div>
}
