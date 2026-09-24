"use client"

import React, { useEffect, useState, useCallback } from 'react';
import {
  ResponsiveContainer,
  Tooltip,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Area,
  AreaChart
} from 'recharts';
import {
  Users,
  Award,
  CheckCircle2,
  TrendingUp,
  RotateCw,
  BarChart3,
  PieChart as PieIcon,
  Crown,
  AlertTriangle,
  Sparkles,
  ShieldCheck,
  Building2
} from 'lucide-react';
import { motion } from 'framer-motion';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/hooks/use-session';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toMonthlyChartData(trend = []) {
  if (!Array.isArray(trend)) return [];
  return [...trend]
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .map(({ date, count }) => {
      const parts = (date || '').split('-');
      const monthIdx = parseInt(parts[1], 10) - 1;
      return {
        month: MONTH_LABELS[monthIdx] || date,
        count: typeof count === 'number' ? count : 0,
      };
    });
}

// Custom Glassmorphic Tooltip for Recharts
const CustomChartTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-popover/95 backdrop-blur-md border border-border p-3 rounded-xl shadow-xl text-xs">
        <p className="font-semibold text-foreground mb-1">{label}</p>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-primary inline-block" />
          <span className="text-muted-foreground">Issued Credentials:</span>
          <span className="font-bold text-foreground">{payload[0].value}</span>
        </div>
      </div>
    );
  }
  return null;
};

// Stat Card Component
const StatCard = ({ title, value, subtitle, icon: Icon, badgeColor, iconColor, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4, delay }}
    className="group relative overflow-hidden rounded-2xl bg-card border border-border/70 p-6 shadow-sm hover:shadow-md hover:border-primary/30 transition-all duration-300"
  >
    <div className="flex items-start justify-between">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
        <h3 className="text-3xl font-extrabold tracking-tight text-foreground">{value}</h3>
        {subtitle && (
          <p className="text-xs text-muted-foreground flex items-center gap-1 pt-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {subtitle}
          </p>
        )}
      </div>
      <div className={`p-3 rounded-xl ${badgeColor} border flex items-center justify-center transition-transform group-hover:scale-105 duration-300`}>
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </div>
    </div>
  </motion.div>
);

export default function OrganizationReportPage() {
  const { session, loading: sessionLoading } = useSession();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const fetchAnalytics = useCallback(async (showRefreshing = false) => {
    const organizationCode = session?.organization_code;
    if (!organizationCode) return;

    try {
      if (showRefreshing) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);

      const response = await apiFetch(`/organization_performance/${organizationCode}`);
      if (!response.ok) {
        throw new Error(`Failed to load analytics (HTTP ${response.status})`);
      }
      const result = await response.json();
      setData(result);
    } catch (err) {
      console.error('Failed to fetch organization report:', err);
      setError(err.message || 'Unable to retrieve analytics data');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [session?.organization_code]);

  useEffect(() => {
    if (sessionLoading) return;
    if (session?.organization_code) {
      fetchAnalytics();
    } else {
      setIsLoading(false);
    }
  }, [session, sessionLoading, fetchAnalytics]);

  if (isLoading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center space-y-4">
        <div className="relative">
          <div className="w-12 h-12 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
          <Building2 className="w-5 h-5 text-primary absolute inset-0 m-auto" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">Loading Organization Intelligence...</p>
          <p className="text-xs text-muted-foreground mt-1">Aggregating credentials, scores, and real-time records</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center bg-card border border-destructive/20 rounded-2xl p-8 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-foreground mb-1">Failed to Load Report</h2>
          <p className="text-xs text-muted-foreground mb-6">{error}</p>
          <button
            onClick={() => fetchAnalytics(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
          >
            <RotateCw className="w-3.5 h-3.5" />
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const credentialStatusData = [
    { name: 'Active', value: data?.active_credentials || 0, color: '#10b981' },
    { name: 'Revoked', value: data?.revoked_credentials || 0, color: '#f43f5e' },
  ];
  const hasCredentialStatus = (data?.active_credentials || 0) + (data?.revoked_credentials || 0) > 0;
  const trendChartData = toMonthlyChartData(data?.credential_issuance_trend);

  return (
    <div className="w-full space-y-8 pb-12">
      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/40 pb-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              Organization Report
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live Sync
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Real-time credentials analytics, issuance performance, and member activity for{' '}
            <span className="font-semibold text-foreground">{session?.organization_code}</span>.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchAnalytics(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-secondary/80 text-secondary-foreground hover:bg-secondary border border-border/60 transition-all shadow-sm active:scale-95 disabled:opacity-50"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Syncing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard
          title="Total Employees"
          value={data?.total_employees ?? 0}
          subtitle="Registered members"
          icon={Users}
          badgeColor="bg-sky-500/10 border-sky-500/20"
          iconColor="text-sky-500 dark:text-sky-400"
          delay={0.05}
        />
        <StatCard
          title="Credentials Issued"
          value={data?.total_credentials_issued ?? 0}
          subtitle="All-time verified"
          icon={Award}
          badgeColor="bg-amber-500/10 border-amber-500/20"
          iconColor="text-amber-500 dark:text-amber-400"
          delay={0.1}
        />
        <StatCard
          title="Claim Rate"
          value={data?.verification_rate || '0.0%'}
          subtitle="Claimed & accepted"
          icon={CheckCircle2}
          badgeColor="bg-emerald-500/10 border-emerald-500/20"
          iconColor="text-emerald-500 dark:text-emerald-400"
          delay={0.15}
        />
        <StatCard
          title="Avg. Employee Score"
          value={
            typeof data?.avg_productivity === 'number'
              ? `${data.avg_productivity.toFixed(1)}%`
              : data?.avg_productivity || '0.0%'
          }
          subtitle="Task productivity"
          icon={TrendingUp}
          badgeColor="bg-indigo-500/10 border-indigo-500/20"
          iconColor="text-indigo-500 dark:text-indigo-400"
          delay={0.2}
        />
      </div>

      {/* Main Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Credential Issuance Trend (2 Cols) */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.25 }}
          className="lg:col-span-2 rounded-2xl bg-card border border-border/70 p-6 shadow-sm flex flex-col justify-between"
        >
          <div className="flex items-center justify-between pb-6 border-b border-border/40">
            <div>
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                Credential Issuance Trend
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">Monthly distribution of issued digital credentials</p>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-xs font-medium text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-lg border border-border/40">
              <span className="w-2 h-2 rounded-full bg-primary" />
              Monthly Volume
            </div>
          </div>

          <div className="pt-6">
            {trendChartData.length === 0 ? (
              <div className="min-h-[280px] flex flex-col items-center justify-center border border-dashed border-border/60 rounded-xl p-8 text-center bg-muted/20">
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-3">
                  <BarChart3 className="w-5 h-5" />
                </div>
                <p className="text-sm font-medium text-foreground">No issuance history yet</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  As digital badges and certificates are issued to members, this monthly trend chart will fill automatically.
                </p>
              </div>
            ) : (
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border/40" />
                    <XAxis
                      dataKey="month"
                      stroke="currentColor"
                      className="text-muted-foreground text-xs"
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="currentColor"
                      className="text-muted-foreground text-xs"
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip content={<CustomChartTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="var(--primary)"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#trendGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </motion.div>

        {/* Credential Status Distribution (1 Col) */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.3 }}
          className="rounded-2xl bg-card border border-border/70 p-6 shadow-sm flex flex-col justify-between"
        >
          <div className="flex items-center justify-between pb-6 border-b border-border/40">
            <div>
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <PieIcon className="w-4 h-4 text-emerald-500" />
                Credential Status
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">Active vs. revoked state</p>
            </div>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-muted text-foreground border border-border/40">
              {data?.total_credentials_issued ?? 0} Total
            </span>
          </div>

          <div className="pt-6 flex-1 flex flex-col justify-center">
            {!hasCredentialStatus ? (
              <div className="min-h-[220px] flex flex-col items-center justify-center border border-dashed border-border/60 rounded-xl p-6 text-center bg-muted/20">
                <ShieldCheck className="w-8 h-8 text-muted-foreground mb-2" />
                <p className="text-sm font-medium text-foreground">No active credentials</p>
                <p className="text-xs text-muted-foreground mt-1">Status breakdown will display once credentials are created.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="h-[180px] w-full relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={credentialStatusData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={78}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {credentialStatusData.map((entry, index) => (
                          <Cell key={`status-cell-${index}`} fill={entry.color} stroke="none" />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--popover)',
                          borderColor: 'var(--border)',
                          borderRadius: '0.75rem',
                          color: 'var(--popover-foreground)',
                          fontSize: '12px',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Center Metric */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-2xl font-black text-foreground">{data?.active_credentials || 0}</span>
                    <span className="text-[10px] uppercase font-semibold text-muted-foreground">Active</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/40">
                  <div className="p-2.5 rounded-xl bg-muted/40 border border-border/40 text-center">
                    <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground mb-0.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      Active
                    </div>
                    <p className="text-sm font-bold text-foreground">{data?.active_credentials || 0}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-muted/40 border border-border/40 text-center">
                    <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground mb-0.5">
                      <span className="w-2 h-2 rounded-full bg-rose-500" />
                      Revoked
                    </div>
                    <p className="text-sm font-bold text-foreground">{data?.revoked_credentials || 0}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Performance Highlights Row */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.35 }}
        className="rounded-2xl bg-card border border-border/70 p-6 shadow-sm"
      >
        <div className="flex items-center justify-between pb-6 border-b border-border/40">
          <div>
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              Performance Highlights
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">Member rankings computed by cumulative accomplishment scores</p>
          </div>
        </div>

        <div className="pt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Top Performer Card */}
          <div className="relative overflow-hidden p-5 rounded-xl bg-gradient-to-br from-emerald-500/[0.04] to-transparent border border-emerald-500/20">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center">
                  <Crown className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-600 dark:text-emerald-400">
                    Top Performer
                  </span>
                  <p className="text-base font-bold text-foreground">
                    {data?.top_performing_employee?.username || 'No record yet'}
                  </p>
                </div>
              </div>

              {data?.top_performing_employee ? (
                <div className="text-right">
                  <span className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
                    {data.top_performing_employee.score}
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    {data.top_performing_employee.issued_credentials || 0} credentials
                  </p>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">N/A</span>
              )}
            </div>
          </div>

          {/* Needs Attention Card */}
          <div className="relative overflow-hidden p-5 rounded-xl bg-gradient-to-br from-amber-500/[0.04] to-transparent border border-amber-500/20">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/20 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-amber-600 dark:text-amber-400">
                    Needs Attention
                  </span>
                  <p className="text-base font-bold text-foreground">
                    {data?.least_performing_employee?.username || 'No record yet'}
                  </p>
                </div>
              </div>

              {data?.least_performing_employee ? (
                <div className="text-right">
                  <span className="text-2xl font-extrabold text-amber-600 dark:text-amber-400">
                    {data.least_performing_employee.score}
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    {data.least_performing_employee.issued_credentials || 0} credentials
                  </p>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">N/A</span>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
