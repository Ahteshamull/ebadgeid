"use client";

import React, { useState, useRef, useEffect } from "react";
import { ArrowLeft, Eye, EyeOff, Loader2, ShieldCheck, CheckCircle, AlertCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLocale } from "@/context/Localecontext";
import { AuthLanguageSwitcher } from "@/components/auth/AuthLanguageSwitcher";
import { API_BASE_URL } from "@/lib/api";

const Confetti = () => {
  return (
    <div className="fixed inset-0 pointer-events-none z-50">
      {[...Array(50)].map((_, i) => (
        <div
          key={i}
          className="absolute w-2 h-2 rounded-full animate-confetti"
          style={{
            left: `${Math.random() * 100}%`,
            top: '-10px',
            backgroundColor: ['#1e40af', '#3b82f6', '#60a5fa', '#93c5fd', '#e0f2fe'][Math.floor(Math.random() * 5)],
            animationDelay: `${Math.random() * 0.5}s`,
            animationDuration: `${2 + Math.random() * 1}s`,
          }}
        />
      ))}
    </div>
  );
};

export default function ForgotPasswordPage() {
  const [step, setStep] = useState(1); // 1: username/email, 2: OTP, 3: new password
  const [identifier, setIdentifier] = useState("");
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);
  const [resetToken, setResetToken] = useState("");
  const [resolvedUsername, setResolvedUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showConfetti, setShowConfetti] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const { t } = useLocale();

  const otpRefs = useRef([]);

  if (otpRefs.current.length !== 6) {
    otpRefs.current = Array(6).fill().map((_, i) => otpRefs.current[i] || React.createRef());
  }

  useEffect(() => {
    if (showConfetti) {
      const timer = setTimeout(() => setShowConfetti(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showConfetti]);

  const clearMessages = () => {
    setError("");
    setSuccess("");
  };

  const transitionToStep = (newStep) => {
    setIsTransitioning(true);
    setTimeout(() => {
      setStep(newStep);
      setIsTransitioning(false);
    }, 300);
  };

  // Step 1: Request OTP
  const handleRequestOTP = async (e) => {
    e.preventDefault();
    clearMessages();

    if (!identifier.trim()) {
      setError(t('enter_username_or_email_error'));
      return;
    }

    setIsLoading(true);

    try {
      // `app` tells the backend which origin this recovery started from,
      // so the emailed link returns the user HERE (onboarding) instead of
      // the main app. The backend allowlists this value against the
      // origins it already declares -- an unrecognized one falls back to
      // the main app rather than being trusted.
      const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usernameOrEmail: identifier,
          app: typeof window !== "undefined" ? window.location.origin : undefined,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(t('otp_sent_to_email'));
        setTimeout(() => {
          transitionToStep(2);
          setSuccess("");
        }, 1500);
      } else {
        setError(data.message || t('something_went_wrong'));
      }
    } catch (err) {
      setError(t('connection_error_later'));
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: Verify OTP
  const handleVerifyOTP = async (otpOverride) => {
    clearMessages();
    const otp = otpOverride || otpDigits.join("");

    if (otp.length < 6) {
      setError(t('enter_full_otp_error'));
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usernameOrEmail: identifier,
          otp,
        }),
      });

      const data = await response.json();

      if (response.ok && data.token) {
        setResetToken(data.token);
        // The reset step needs the canonical auth username, which may
        // differ from what was typed here (an institutional email
        // resolves to a different username).
        setResolvedUsername(data.username || identifier);
        setSuccess(t('otp_verified_successfully'));
        setTimeout(() => {
          transitionToStep(3);
          setSuccess("");
        }, 1000);
      } else {
        setError(data.message || t('invalid_or_expired_otp'));
        setOtpDigits(["", "", "", "", "", ""]);
        otpRefs.current[0].current?.focus();
      }
    } catch (err) {
      setError(t('connection_error_try_again'));
    } finally {
      setIsLoading(false);
    }
  };

  // Step 3: Reset Password
  const handleResetPassword = async (e) => {
    e.preventDefault();
    clearMessages();

    // Was `< 4`, while the backend has always required at least 12 (see
    // authController.resetPassword) -- so a 4-to-11 character password
    // passed this check and then failed server-side with a message the
    // user had no way to anticipate.
    if (newPassword.length < 12) {
      setError(t('password_min_length_error'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('passwords_do_not_match'));
      return;
    }

    setIsLoading(true);

    try {
      // Was POSTing to `/auth/reset-password/${resetToken}` with a
      // `{newPassword}` body -- neither the URL shape nor the field names
      // matched anything this backend exposes (the route is a plain
      // /auth/reset-password taking the token in the body), so this step
      // could never have succeeded.
      const response = await fetch(`${API_BASE_URL}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: resolvedUsername,
          token: resetToken,
          password: newPassword,
          confirmPassword,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(t('password_reset_successful'));
        setShowConfetti(true);
        setTimeout(() => {
          window.location.href = "/auth/login";
        }, 3000);
      } else {
        setError(data.message || t('failed_to_reset_password'));
      }
    } catch (err) {
      setError(t('connection_error_or_token_expired'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpChange = (index, value) => {
    if (value.length > 1 || isNaN(value)) return;
    const newDigits = [...otpDigits];
    newDigits[index] = value;
    setOtpDigits(newDigits);

    if (value && index < 5) {
      otpRefs.current[index + 1].current?.focus();
    }

    if (newDigits.every((d) => d !== "") && !isLoading) {
      setTimeout(() => handleVerifyOTP(newDigits.join("")), 400);
    }
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1].current?.focus();
    }
  };

  const handleOtpPaste = (e) => {
    e.preventDefault();
    const paste = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    const newDigits = paste.split("").concat(["", "", "", "", "", ""]).slice(0, 6);
    setOtpDigits(newDigits);
    const next = Math.min(paste.length, 5);
    setTimeout(() => otpRefs.current[next].current?.focus(), 50);

    if (paste.length === 6) {
      setTimeout(() => handleVerifyOTP(newDigits.join("")), 400);
    }
  };

  const stepLabel = step === 1
    ? t('step_label_account')
    : step === 2
      ? t('step_label_verify_otp')
      : t('step_label_new_password');

  const ProgressBar = () => (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-3">
        <span className="text-sm font-medium text-gray-600">{t('step_of_3')} {step} {t('of_3')}</span>
        <span className="text-xs text-gray-500">{stepLabel}</span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-900 to-blue-700 transition-all duration-500"
          style={{ width: `${(step / 3) * 100}%` }}
        />
      </div>
    </div>
  );

  return (
    <>
      <style>{`
        @keyframes confetti {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        .animate-confetti { animation: confetti linear forwards; }
      `}</style>

      {showConfetti && <Confetti />}

      <div className="min-h-screen flex">
        {/* Left Side - Branding */}
        <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-800 p-12 flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500 rounded-full opacity-10 blur-3xl"></div>
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-slate-500 rounded-full opacity-10 blur-3xl"></div>

          <div className="relative z-10">
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

          <div className="relative z-10 flex-1 flex flex-col justify-center">
            <h2 className="text-5xl font-bold text-white mb-6 leading-tight">
              Digital Credentials<br />
              Management System
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

          <div className="relative z-10">
            <p className="text-slate-400 text-sm">
              © {new Date().getFullYear()} Tara Solutions. All Rights Reserved
            </p>
          </div>
        </div>

        {/* Right Side - Form */}
        <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-gray-50 relative">
          {/* Language Switcher */}
          <div className="absolute top-5 right-5 z-10">
            <AuthLanguageSwitcher />
          </div>

          <div className="w-full max-w-md">
            {/* Mobile Logo */}
            <div className="lg:hidden flex items-center justify-center mb-8">
              <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                <ShieldCheck className="w-8 h-8 text-white" />
              </div>
              <div className="ml-3">
                <h1 className="text-2xl font-bold text-gray-900">EBADGE ID</h1>
                <p className="text-gray-600 text-sm">{t('digital_credentials_label')}</p>
              </div>
            </div>

            <Card className="shadow-lg border-0">
              <CardContent className="p-8">
                <div className="mb-8">
                  <h2 className="text-3xl font-bold text-gray-900 mb-2">{t('reset_password_heading')}</h2>
                  <p className="text-gray-600">{t('follow_steps_to_recover')}</p>
                </div>

                <ProgressBar />

                {success && (
                  <Alert className="bg-green-50 border-green-200 mb-6">
                    <CheckCircle className="h-4 w-4 text-green-800" />
                    <AlertDescription className="text-green-800 text-sm ml-2">
                      {success}
                    </AlertDescription>
                  </Alert>
                )}

                {error && (
                  <Alert className="bg-red-50 border-red-200 mb-6">
                    <AlertCircle className="h-4 w-4 text-red-800" />
                    <AlertDescription className="text-red-800 text-sm ml-2">
                      {error}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Step 1: Enter username/email */}
                {step === 1 && (
                  <form onSubmit={handleRequestOTP} className="space-y-6">
                    <div>
                      <Label htmlFor="identifier">{t('username_or_email')}</Label>
                      <Input
                        id="identifier"
                        type="text"
                        placeholder={t('enter_username_or_email')}
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        className="h-12 mt-2"
                        disabled={isLoading}
                      />
                    </div>

                    <Button
                      type="submit"
                      className="w-full h-12 bg-blue-600 hover:bg-blue-700"
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          {t('sending_otp')}
                        </>
                      ) : (
                        t('send_otp')
                      )}
                    </Button>
                  </form>
                )}

                {/* Step 2: OTP Verification */}
                {step === 2 && (
                  <div className="space-y-6">
                    <div>
                      <Label>{t('enter_6_digit_otp')}</Label>
                      <p className="text-sm text-gray-500 mt-1">{t('check_email_for_code')}</p>
                      <div className="flex justify-between gap-2 mt-4" onPaste={handleOtpPaste}>
                        {otpDigits.map((digit, i) => (
                          <Input
                            key={i}
                            type="text"
                            maxLength={1}
                            value={digit}
                            onChange={(e) => handleOtpChange(i, e.target.value)}
                            onKeyDown={(e) => handleOtpKeyDown(i, e)}
                            ref={otpRefs.current[i]}
                            className="w-12 h-14 text-center text-xl font-bold"
                            disabled={isLoading}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => transitionToStep(1)}
                        disabled={isLoading}
                      >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        {t('back')}
                      </Button>
                      <Button
                        className="flex-1 bg-blue-600 hover:bg-blue-700"
                        onClick={() => handleVerifyOTP()}
                        disabled={isLoading}
                      >
                        {isLoading ? (
                          <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            {t('verifying')}
                          </>
                        ) : (
                          t('verify_otp_btn')
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Step 3: Set New Password */}
                {step === 3 && (
                  <form onSubmit={handleResetPassword} className="space-y-6">
                    <div>
                      <Label htmlFor="newPassword">{t('new_password_label')}</Label>
                      <div className="relative mt-2">
                        <Input
                          id="newPassword"
                          type={showNewPassword ? "text" : "password"}
                          placeholder={t('enter_new_password')}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="h-12 pr-12"
                          disabled={isLoading}
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword(!showNewPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                        >
                          {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="confirmPassword">{t('confirm_password')}</Label>
                      <div className="relative mt-2">
                        <Input
                          id="confirmPassword"
                          type={showConfirmPassword ? "text" : "password"}
                          placeholder={t('confirm_new_password')}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="h-12 pr-12"
                          disabled={isLoading}
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                        >
                          {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                        </button>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => transitionToStep(2)}
                        disabled={isLoading}
                      >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        {t('back')}
                      </Button>
                      <Button
                        type="submit"
                        className="flex-1 bg-blue-600 hover:bg-blue-700"
                        disabled={isLoading}
                      >
                        {isLoading ? (
                          <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            {t('resetting')}
                          </>
                        ) : (
                          <>
                            {t('reset_password_btn')}
                            <Sparkles className="ml-2 h-5 w-5" />
                          </>
                        )}
                      </Button>
                    </div>
                  </form>
                )}

                <div className="mt-8 text-center">
                  <a
                    href="/auth/login"
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    {t('back_to_sign_in')}
                  </a>
                </div>
              </CardContent>
            </Card>

            <p className="text-center text-sm text-gray-500 mt-8 lg:hidden">
              © {new Date().getFullYear()} Tara Solutions. All Rights Reserved
            </p>
          </div>
        </div>
      </div>
    </>
  );
}