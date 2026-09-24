"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from '../../../hooks/useTranslation';
import { useLocalization } from '../../../context/LocalizationContext';
import { helpdeskTranslations, languages as availableLanguages } from '../../../locales';
import { apiFetch } from '@/lib/api';
import { ORGANIZATION_CODE } from '@/lib/config';

// Separate component that uses useSearchParams
function VerifyOTPContent() {
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [timeLeft, setTimeLeft] = useState(300); // 5 minutes countdown
  const router = useRouter();
  const searchParams = useSearchParams();
  const ticketCode = searchParams.get('ticket');
  const email = searchParams.get('email');
  const inputRefs = useRef([]);
  const { language, changeLanguage } = useLocalization();
  const t = helpdeskTranslations[language] || helpdeskTranslations.en;
  
  // Countdown timer
  useEffect(() => {
    if (timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [timeLeft]);

  // Format countdown time
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Handle OTP input change
  const handleOtpChange = (index, value) => {
    if (value.length > 1) return; // Prevent multiple characters
    
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    setError(null);

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  // Handle backspace
  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  // Handle paste
  const handlePaste = (e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, ''); // Remove non-digits
    if (pastedData.length === 6) {
      const newOtp = pastedData.split('');
      setOtp(newOtp);
      inputRefs.current[5]?.focus();
    }
  };

  // Verify OTP
  const handleVerifyOtp = async () => {
    const otpString = otp.join('');
    
    if (otpString.length !== 6) {
      setError("Please enter the complete 6-digit OTP");
      return;
    }

    if (!email) {
      setError("Email not found. Please go back and try again.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await apiFetch("/otp/verify-otp", {
        method: "POST",
        body: JSON.stringify({
          emailOrUsername: email,
          otp: otpString,
          organization_code: ORGANIZATION_CODE,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Invalid OTP. Please try again.");
      }

      await response.json();
      
      setSuccess(true);
      
      // Redirect to ticket page after showing success message
      setTimeout(() => {
        if (ticketCode) {
          router.push(`/ticket_details/${ticketCode}`);
        } else {
          router.push(`/tracking?verified_email=${encodeURIComponent(email)}`);
        }
      }, 1500);
      
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Resend OTP
  const handleResendOtp = async () => {
    if (!email) {
      setError("Email not found. Please go back and try again.");
      return;
    }

    setResendLoading(true);
    setError(null);
    setResendSuccess(false);

    try {
      const response = await apiFetch("/otp/request-otp", {
        method: "POST",
        body: JSON.stringify({
          emailOrUsername: email,
          organization_code: ORGANIZATION_CODE,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to resend OTP");
      }

      setResendSuccess(true);
      setTimeLeft(300); // Reset countdown
      setOtp(["", "", "", "", "", ""]); // Clear current OTP
      inputRefs.current[0]?.focus(); // Focus first input
      
      // Clear success message after 3 seconds
      setTimeout(() => setResendSuccess(false), 3000);
      
    } catch (err) {
      setError(err.message);
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-emerald-50 to-teal-100">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-gradient-to-r from-emerald-400/20 to-teal-400/20 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-gradient-to-r from-teal-400/20 to-green-400/20 rounded-full blur-3xl animate-pulse delay-1000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-gradient-to-r from-cyan-400/20 to-emerald-400/20 rounded-full blur-3xl animate-pulse delay-500"></div>
      </div>

      <div className="relative z-10 max-w-md mx-auto px-6 py-16">
        {/* Header Section */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl mb-6 shadow-lg">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.414-5.414l-.707.707M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-gray-900 via-emerald-900 to-teal-900 bg-clip-text text-transparent mb-4">
            {t.verify_email}
          </h1>
          <p className="text-gray-600 leading-relaxed">
            {t.otp_send}
          </p>
          <p className="text-emerald-600 font-semibold mt-1">
            {email || "your email"}
          </p>
        </div>

        {/* OTP Input Section */}
        <Card className="backdrop-blur-sm bg-white/80 shadow-2xl border-0 rounded-3xl overflow-hidden mb-6">
          <CardContent className="p-8">
            <div className="space-y-6">
              {/* OTP Input Fields */}
              <div className="flex justify-center space-x-3">
                {otp.map((digit, index) => (
                  <Input
                    key={index}
                    ref={(el) => (inputRefs.current[index] = el)}
                    value={digit}
                    onChange={(e) => handleOtpChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    onPaste={handlePaste}
                    maxLength={1}
                    className="w-12 h-12 text-center text-xl font-semibold border-2 border-gray-200 rounded-xl focus:border-emerald-500 focus:ring-0 transition-all duration-300"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                  />
                ))}
              </div>

              {/* Timer */}
              <div className="text-center">
                <p className="text-sm text-gray-500">
                 {t.otp_expires}{" "}
                  <span className="font-semibold text-emerald-600">
                    {formatTime(timeLeft)}
                  </span>
                </p>
              </div>

              {/* Verify Button */}
              <Button
                onClick={handleVerifyOtp}
                disabled={loading || otp.join('').length !== 6}
                className="w-full py-4 text-lg font-semibold rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                {loading ? (
                  <div className="flex items-center justify-center space-x-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>{t.verifying}</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center space-x-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>{t.code}</span>
                  </div>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Success Message */}
        {success && (
          <div className="mb-6">
            <div className="bg-green-50 border-l-4 border-green-400 p-4 rounded-xl">
              <div className="flex items-center">
                <svg className="w-5 h-5 text-green-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-green-700 font-medium">{t.success}</p>
              </div>
            </div>
          </div>
        )}

        {/* Resend Success Message */}
        {resendSuccess && (
          <div className="mb-6">
            <div className="bg-emerald-50 border-l-4 border-emerald-400 p-4 rounded-xl">
              <div className="flex items-center">
                <svg className="w-5 h-5 text-emerald-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <p className="text-emerald-700 font-medium">{t.new_sent}</p>
              </div>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-6">
            <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-xl">
              <div className="flex items-center">
                <svg className="w-5 h-5 text-red-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-red-700 font-medium">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Resend Section */}
        <div className="text-center space-y-4">
          <p className="text-gray-600">{t.not_received}</p>
          <Button
            onClick={handleResendOtp}
            disabled={resendLoading || timeLeft > 240} // Allow resend after 1 minute
            variant="outline"
            className="bg-white/50 border-2 border-gray-200 hover:border-emerald-500 hover:bg-emerald-50 rounded-2xl px-6 py-2 transition-all duration-300"
          >
            {resendLoading ? (
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-emerald-600"></div>
                <span>{t.sending}</span>
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>{t.verify_resend_otp}</span>
              </div>
            )}
          </Button>
          
          {timeLeft > 240 && (
            <p className="text-sm text-gray-500">
              {t.resend} {formatTime(timeLeft - 240)}
            </p>
          )}
        </div>

        {/* Back Link */}
        <div className="text-center mt-8">
          <Button
            onClick={() => router.back()}
            variant="ghost"
            className="text-gray-600 hover:text-emerald-600 transition-colors duration-300"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            {t.back_search}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Loading fallback component
function LoadingFallback() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-emerald-50 to-teal-100 flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600"></div>
    </div>
  );
}

// Main component with Suspense wrapper
export default function VerifyOTPPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <VerifyOTPContent />
    </Suspense>
  );
}
