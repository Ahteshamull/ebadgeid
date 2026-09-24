"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { useTranslation } from '../../hooks/useTranslation';
import { useLocalization } from '../../context/LocalizationContext';
import { helpdeskTranslations, languages as availableLanguages } from '../../locales';
import { ChevronDown, Globe } from "lucide-react";
import { apiFetch } from '@/lib/api';
import { ORGANIZATION_CODE } from '@/lib/config';

// Redesigned LanguageSelector component with enhanced aesthetics
const LanguageSelector = ({ currentLanguage, onLanguageChange }) => {
  const [isOpen, setIsOpen] = useState(false);

  const selectedLang = availableLanguages.find(l => l.code === currentLanguage) || availableLanguages[0];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-gray-200 hover:border-emerald-300 hover:shadow-sm transition-all duration-200"
      >
        <Globe className="w-4 h-4 text-gray-600" />
        <span className="text-sm font-semibold text-gray-800">{selectedLang.flag} {selectedLang.name}</span>
        <ChevronDown className={`w-4 h-4 text-gray-600 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      
      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-50 animate-fadeIn">
          {availableLanguages.map((lang, index) => (
            <button
              key={lang.code}
              onClick={() => {
                onLanguageChange(lang.code);
                setIsOpen(false);
              }}
              className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors duration-150 ${
                currentLanguage === lang.code ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-gray-50'
              } ${index !== availableLanguages.length - 1 ? 'border-b border-gray-100' : ''}`}
            >
              <span className="text-2xl">{lang.flag}</span>
              <span className="text-sm font-medium">{lang.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};



export default function TrackPage() {
  const { language, changeLanguage } = useLocalization();
  const [email, setEmail] = useState("");
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpSuccess, setOtpSuccess] = useState(false);
  const router = useRouter();
const t = helpdeskTranslations[language] || helpdeskTranslations.en;

  const fetchTickets = async (targetEmail) => {
    const response = await apiFetch(`/tickets/email/${encodeURIComponent(targetEmail)}`);
    if (!response.ok) throw new Error('Failed to fetch tickets');
    const data = await response.json();
    setTickets(data);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verifiedEmail = params.get('verified_email');
    if (!verifiedEmail) return;
    setEmail(verifiedEmail);
    setLoading(true);
    fetchTickets(verifiedEmail)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSearch = async () => {
    if (!email) {
      setError("Please enter an email address");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await apiFetch('/otp/request-otp', {
        method: 'POST',
        body: JSON.stringify({ emailOrUsername: email, organization_code: ORGANIZATION_CODE }),
      });
      if (!response.ok) throw new Error('Failed to send OTP');
      router.push(`/tracking/verify?email=${encodeURIComponent(email)}`);
    } catch (err) {
      setError(err.message);
      setTickets([]);
    } finally {
      setLoading(false);
    }
  };

  const handleViewTicket = async (ticketCode, ticketEmail) => {
    setOtpLoading(true);
    setError(null);
    setOtpSuccess(false);

    try {
      const response = await apiFetch('/otp/request-otp', {
        method: "POST",
        body: JSON.stringify({
          emailOrUsername: ticketEmail || email,
          organization_code: ORGANIZATION_CODE,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to send OTP");
      }

      const data = await response.json();
      setOtpSuccess(true);
      
      // Add a small delay to show the success message
      setTimeout(() => {
        router.push(`/tracking/verify?ticket=${ticketCode}&email=${encodeURIComponent(ticketEmail || email)}`);
      }, 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setOtpLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'open':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'pending':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'resolved':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'closed':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority?.toLowerCase()) {
      case 'high':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low':
        return 'bg-green-100 text-green-800 border-green-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-emerald-100">
      {/* Header */}
<header className="bg-white shadow-sm border-b border-gray-200">
  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div className="flex items-center justify-between h-20 sm:h-24 relative">

      {/* Back Button */}
      <button
        onClick={() => window.history.back()}
        className="p-2 sm:p-3 rounded-full bg-gray-100 hover:bg-gray-200 shadow transition-all duration-200"
        title={t.header.backButton}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 sm:h-6 sm:w-6 text-gray-700"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Centered Logo */}
      <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center justify-center">
        <img
          src="/bg-logo.png"
          alt="eBadgeId Logo"
          className="w-20 h-20 sm:w-28 sm:h-28 object-contain"
        />
      </div>

      {/* Language Selector */}
      <div className="flex-shrink-0">
        <LanguageSelector currentLanguage={language} onLanguageChange={changeLanguage} />
      </div>
    </div>
  </div>
</header>
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-gradient-to-r from-blue-400/20 to-green-400/20 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-gradient-to-r from-green-400/20 to-emerald-400/20 rounded-full blur-3xl animate-pulse delay-1000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-gradient-to-r from-cyan-400/20 to-blue-400/20 rounded-full blur-3xl animate-pulse delay-500"></div>
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-6 py-16">
        {/* Header Section */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-600 to-green-600 rounded-2xl mb-6 shadow-lg">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 className="text-5xl font-bold bg-gradient-to-r from-gray-900 via-blue-900 to-green-900 bg-clip-text text-transparent mb-4">
            {t.track_ticket_text || "Track your ticket"}
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
            {t.track_ticket_subtext}
          </p>
        </div>

        {/* Search Section */}
        <div className="max-w-2xl mx-auto mb-12">
          <Card className="backdrop-blur-sm bg-white/80 shadow-2xl border-0 rounded-3xl overflow-hidden">
            <CardContent className="p-8">
              <div className="space-y-6">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                    </svg>
                  </div>
                  <Input
                    placeholder={t.track_enter_email}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyPress={handleKeyPress}
                    type="email"
                    className="pl-12 pr-4 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:border-blue-500 focus:ring-0 transition-all duration-300 bg-white"
                  />
                </div>
                
                <Button 
                  onClick={handleSearch} 
                  disabled={loading || !email.trim()}
                  className="w-full py-4 text-lg font-semibold rounded-2xl bg-gradient-to-r from-blue-600 to-green-600 hover:from-blue-700 hover:to-green-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                >
                  {loading ? (
                    <div className="flex items-center justify-center space-x-2">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                      <span>{t.searching}</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center space-x-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <span>{t.track_search_button}</span>
                    </div>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Success Message */}
        {otpSuccess && (
          <div className="max-w-2xl mx-auto mb-8">
            <div className="bg-green-50 border-l-4 border-green-400 p-4 rounded-xl">
              <div className="flex items-center">
                <svg className="w-5 h-5 text-green-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-green-700 font-medium">{t.otp_send}</p>
              </div>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="max-w-2xl mx-auto mb-8">
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

        {/* Results Section */}
        {tickets.length > 0 ? (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                {t.found} {tickets.length} ticket{tickets.length !== 1 ? 's' : ''}
              </h2>
              <p className="text-gray-600">{t.ticket_detail}</p>
            </div>
            
            <div className="grid gap-6">
              {tickets.map((ticket, index) => (
                <Card 
                  key={ticket.ticket_code} 
                  className="backdrop-blur-sm bg-white/80 shadow-xl border-0 rounded-3xl overflow-hidden hover:shadow-2xl transition-all duration-300 hover:scale-[1.02] cursor-pointer group"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <CardContent className="p-8">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
                      <div className="flex-1 space-y-3">
                        <div className="flex items-start space-x-3">
                          <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-r from-blue-500 to-green-500 rounded-xl flex items-center justify-center">
                            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                            </svg>
                          </div>
                          <div className="flex-1">
                            <h3 className="text-xl font-semibold text-gray-900 mb-1">
                              {ticket.ticket_title}
                            </h3>
                            <p className="text-gray-600 font-mono text-sm bg-gray-100 px-3 py-1 rounded-full inline-block">
                              #{ticket.ticket_code}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex flex-wrap gap-3">
                          <span className={`px-3 py-1 text-xs font-semibold rounded-full border ${getStatusColor(ticket.status)}`}>
                            {ticket.status}
                          </span>
                          <span className={`px-3 py-1 text-xs font-semibold rounded-full border ${getPriorityColor(ticket.priority)}`}>
                            {ticket.priority} {t.priority}
                          </span>
                        </div>
                      </div>
                      
                      <div className="flex-shrink-0">
                        <Button
                          onClick={() => handleViewTicket(ticket.ticket_code, ticket.email)}
                          disabled={otpLoading}
                          className="px-8 py-3 bg-gradient-to-r from-blue-600 to-green-600 hover:from-blue-700 hover:to-green-700 text-white font-semibold rounded-2xl transition-all duration-300 shadow-lg hover:shadow-xl transform group-hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                        >
                          <div className="flex items-center space-x-2">
                            {otpLoading ? (
                              <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                <span>{t.sending_otp}</span>
                              </>
                            ) : (
                              <>
                                <span>{t.view_details}</span>
                                <svg className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </>
                            )}
                          </div>
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          !loading && !error && email && (
            <div className="text-center py-16">
              <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">{t.failed_tickets}</h3>
              <p className="text-gray-600 max-w-md mx-auto">
                {t.no_tickets}
              </p>
            </div>
          )
        )}

        {/* Empty State */}
        {!loading && !error && !email && (
          <div className="text-center py-16">
            <div className="w-24 h-24 bg-gradient-to-r from-blue-100 to-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-12 h-12 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <h3 className="text-2xl font-semibold text-gray-900 mb-2">{t.ready_text}</h3>
            <p className="text-gray-600 max-w-md mx-auto">
              {t.ready_subtext}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
