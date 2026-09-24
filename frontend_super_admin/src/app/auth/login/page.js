"use client"
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2, ShieldCheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLocale } from "@/context/Localecontext";
import { AuthLanguageSwitcher } from "@/components/auth/AuthLanguageSwitcher";
import { API_BASE_URL, ensureCsrfToken, setCsrfToken } from "@/lib/api";

// This backend's highest-privilege role is `platform_admin` (there is no
// separate `super_admin` value in its role enum) -- accept both so this
// gate works whether the deployment uses one or the other.
const ALLOWED_ROLES = ['super_admin', 'platform_admin'];

// Zod schema – validation messages are intentionally English-only (not translated)
const loginSchema = z.object({
  username: z.string().min(3, { message: "Username must be at least 3 characters" }),
  password: z.string().min(4, { message: "Password must be at least 4 characters" }),
});

// Helper function to determine redirect URL based on role
const getRedirectUrl = (role) => {
  // String(role || '') because a missing role must not throw here. Roles live
  // in the auths collection; the users collection carries a null user_role,
  // so any caller reading the role from the wrong document would have crashed
  // login on .toLowerCase() rather than simply landing somewhere sensible.
  switch (String(role || '').toLowerCase()) {
    case 'admin':
      return "/reports/organizations";
    case 'user':
      return "/user_dash";
    case 'super_admin':
    case 'platform_admin':
      return "/super_admin";
    default:
      // The least-privileged real page, never an admin view. This fallback
      // used to point at /reports/sessions, which fetched a domain that no
      // longer resolves -- so every role the switch did not name landed on a
      // permanently broken screen. Authorization is enforced server-side
      // against the stored role, so this choice only decides where an
      // unrecognized role lands, never what it may do.
      return "/user_dash";
  }
};

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [loginError, setLoginError] = useState("");
  const { t } = useLocale();

  const form = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  useEffect(() => {
    // Prime the CSRF synchronizer token before the user submits -- without
    // this the very first login attempt on a fresh session always fails
    // with "CSRF token required" (confirmed for real against the backend's
    // csrfProtection middleware), matching the already-proven pattern in
    // the sibling `frontend` app's own login page.
    ensureCsrfToken().catch(() => {});
  }, []);

  async function onSubmit(values) {
    // The button is disabled while a sign-in is in flight, but Enter
    // submits the form directly and never touches the button -- without
    // this guard, holding Enter would fire several concurrent logins.
    if (isLoading) return;
    setIsLoading(true);
    setLoginError("");

    try {
      // SA-01 fix: no more manual token storage. The backend already sets
      // a real httpOnly session cookie on a successful login (see
      // `backend (updated)/controllers/authController.js`'s
      // `res.cookie(...)`) -- `credentials: 'include'` is what actually
      // establishes the session from here on, not anything read from this
      // response body.
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({
          username: values.username,
          password: values.password,
        }),
      });

      const data = await response.json();
      if (response.status === 403 && /csrf/i.test(data.message || "")) {
        setCsrfToken(null);
        setLoginError("Your security session expired. Please try signing in again.");
        return;
      }
      // Login rotates the CSRF cookie together with the session cookie --
      // keep the matching returned token for the next mutation.
      if (response.ok) setCsrfToken(data.csrfToken);

      if (response.ok) {
        // Restrict access to the platform's highest-privilege role(s) only
        if (!ALLOWED_ROLES.includes(data.role?.toLowerCase())) {
          setLoginError(t('access_denied') || 'Access denied. Only Super Admins are allowed to log in.');
          return;
        }

        setLoginSuccess(true);

        const redirectUrl = getRedirectUrl(data.role);

        setTimeout(() => {
          window.location.href = redirectUrl;
        }, 1500);
      } else {
        setLoginError(data.message || t('connection_error'));
      }
    } catch (error) {
      console.error("Error during login:", error);
      setLoginError(t('connection_error'));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-800 p-12 flex-col justify-between relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500 rounded-full opacity-10 blur-3xl"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-slate-500 rounded-full opacity-10 blur-3xl"></div>

        <div className="relative z-10">
          {/* Logo */}
          <div className="flex items-center space-x-4 mb-8">
            <div className="w-16 h-16 bg-white rounded-xl flex items-center justify-center shadow-lg p-2">
              <img src="/logo.webp" alt="EBADGE ID Logo" className="w-full h-full object-contain" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">eBadge ID</h1>
              <p className="text-blue-200 text-sm">Tara Solutions</p>
            </div>
          </div>
        </div>

        {/* Center Content */}
        <div className="relative z-10 flex-1 flex flex-col justify-center">
          <h2 className="text-5xl font-bold text-white mb-6 leading-tight">
            {t('auth_feature_1') && (
              <>
                {t('digital_credential')}<br />
                {t('management_system')}
              </>
            )}
          </h2>
          <p className="text-xl text-blue-100 mb-8 max-w-md">
            {t('auth_tagline')}
          </p>
          <div className="space-y-4 text-blue-100">
            <div className="flex items-start space-x-3">
              <div className="w-2 h-2 bg-blue-400 rounded-full mt-2"></div>
              <p className="text-lg">{t('auth_feature_1')}</p>
            </div>
            <div className="flex items-start space-x-3">
              <div className="w-2 h-2 bg-blue-400 rounded-full mt-2"></div>
              <p className="text-lg">{t('auth_feature_2')}</p>
            </div>
            <div className="flex items-start space-x-3">
              <div className="w-2 h-2 bg-blue-400 rounded-full mt-2"></div>
              <p className="text-lg">{t('auth_feature_3')}</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10">
          <p className="text-slate-400 text-sm">
            © {new Date().getFullYear()} eBadge ID | {t('powered_by')} Tara Solutions
          </p>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-gray-50 relative">
        {/* Language Switcher - top right of form panel */}
        <div className="absolute top-5 right-5 z-10">
          <AuthLanguageSwitcher />
        </div>

        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center justify-center mb-8">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg">
              <ShieldCheckIcon className="w-8 h-8 text-white" />
            </div>
            <div className="ml-3">
              <h1 className="text-2xl font-bold text-gray-900">eBadge ID</h1>
              <p className="text-gray-600 text-sm">{t('digital_credentials_label')}</p>
            </div>
          </div>

          <Card className="shadow-lg border-0">
            <CardContent className="p-8">
              <div className="mb-8">
                <h2 className="text-3xl font-bold text-gray-900 mb-2">{t('welcome_back')}</h2>
                <p className="text-gray-600">{t('sign_in_to_access_account')}</p>
              </div>

              {loginSuccess && (
                <Alert className="bg-green-50 border-green-200 mb-6">
                  <AlertDescription className="text-green-800 text-sm">
                    {t('login_successful_redirecting')}
                  </AlertDescription>
                </Alert>
              )}

              {loginError && (
                <Alert className="bg-red-50 border-red-200 mb-6">
                  <AlertDescription className="text-red-800 text-sm">
                    {loginError}
                  </AlertDescription>
                </Alert>
              )}

              {/* Real <form> instead of a bare <div>. The submit button
                  carried an onClick handler but nothing wrapped the inputs,
                  so pressing Enter in either field did nothing at all --
                  the browser had no form to submit. Wrapping them here
                  makes Enter and the button take the identical path
                  (form.handleSubmit -> onSubmit); the button keeps
                  type="submit" and no longer needs its own onClick, so
                  there is exactly one submit path, not two. */}
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <div>
                  <Label htmlFor="username" className="text-sm font-semibold text-gray-700 mb-2 block">
                    {t('username')}
                  </Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder={t('enter_your_username')}
                    {...form.register("username")}
                    className="h-12 border-gray-300 focus:border-blue-500 focus:ring-blue-500 text-base"
                    disabled={isLoading}
                  />
                  {form.formState.errors.username && (
                    <p className="text-xs text-red-600 mt-2">{form.formState.errors.username.message}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="password" className="text-sm font-semibold text-gray-700 mb-2 block">
                    {t('password')}
                  </Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder={t('enter_your_password')}
                      {...form.register("password")}
                      className="h-12 pr-12 border-gray-300 focus:border-blue-500 focus:ring-blue-500 text-base"
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {showPassword ? (
                        <EyeOff className="h-5 w-5" />
                      ) : (
                        <Eye className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                  {form.formState.errors.password && (
                    <p className="text-xs text-red-600 mt-2">{form.formState.errors.password.message}</p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold shadow-lg hover:shadow-xl transition-all"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      {t('signing_in')}
                    </>
                  ) : (
                    t('sign_in')
                  )}
                </Button>
              </form>

              <div className="mt-6 text-center">
                <a href="/auth/reset-password" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                  {t('forgot_your_password')}
                </a>
              </div>
            </CardContent>
          </Card>

          <p className="text-center text-sm text-gray-500 mt-8 lg:hidden">
            © {new Date().getFullYear()}-2026 eBadge ID | Powered by Tara Solutions
          </p>
        </div>
      </div>
    </div>
  );
}
