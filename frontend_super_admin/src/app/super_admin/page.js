"use client"
import React, { useState, useEffect } from 'react';
import { 
  Building2, Building, AlertCircle, DollarSign, 
  TrendingUp, TrendingDown, Clock 
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { apiFetch } from '@/lib/api';
import PlanUsageCard from '@/components/PlanUsageCard';

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // SA-01/SA-03 fix: this used to read a bearer token from localStorage
    // (always null after the login fix) and call a hardcoded URL that
    // never existed on the backend (GET /api/summary/overview) -- the
    // dashboard could never do anything but show its own error state,
    // never an infinite loader (this page always resolves loading in its
    // finally block either way, so it was never the source of an
    // infinite spinner -- the DashboardShell wrapping it was, before the
    // SA-01/SA-06 auth-shell fix). apiFetch now carries the real session
    // cookie, and the endpoint is real (see backend controllers/
    // organizationController.js's getPlatformOverview).
    const fetchOverview = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await apiFetch('/organizations/summary/overview', { redirectOnUnauthorized: false });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || `Failed (${res.status})`);
        }

        const result = await res.json();
        setData(result);
      } catch (err) {
        console.error('Dashboard fetch error:', err);
        setError(err.message || 'Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    };

    fetchOverview();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-50 border border-red-200 text-red-800 p-6 rounded-xl flex items-start gap-4">
            <AlertCircle className="h-6 w-6 mt-1 flex-shrink-0" />
            <div>
              <h3 className="font-semibold">Error loading dashboard</h3>
              <p className="mt-1">{error}</p>
              <button 
                onClick={() => window.location.reload()} 
                className="mt-4 text-sm underline hover:text-red-900"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const overview = data || {};
  const chartData = overview.financial_summary?.[0]?.details || [];

  // Recharts works well with the same data structure
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-4 rounded-lg shadow-lg border border-gray-200">
          <p className="font-medium text-gray-900 mb-2">{label}</p>
          {payload.map((entry, index) => (
            <p key={`item-${index}`} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: <span className="font-medium">${entry.value.toLocaleString()}</span>
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="min-h-screen p-6 pb-12">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Dashboard</h1>
          <p className="text-gray-600 mt-1">Overview of companies, revenue & transactions</p>
        </div>

        {/* Plan & consumption for the platform's own organization, using
            the same component and the same endpoint the Admin dashboard
            uses -- integrated into the existing Dashboard rather than
            added as a separate tab. Drill-down into any tenant's plan is
            available from Organization Management. */}
        <PlanUsageCard title="Platform Plan & Usage" />

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            icon={<Building2 />}
            title="Total Companies"
            value={overview.total_companies || 0}
            color="from-blue-500 to-blue-600"
          />
          <StatCard
            icon={<Building />}
            title="Active Companies"
            value={overview.active_companies || 0}
            color="from-green-500 to-green-600"
          />
          <StatCard
            icon={<Clock />}
            title="On Trial"
            value={overview.companies_on_trial || 0}
            color="from-amber-500 to-amber-600"
          />
          <StatCard
            icon={<AlertCircle />}
            title="Past Due"
            value={overview.companies_past_due || 0}
            color="from-red-500 to-red-600"
          />
        </div>

        {/* Revenue Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Line Chart - Recharts */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Monthly Revenue Trend</CardTitle>
            </CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 10, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis 
                    dataKey="month" 
                    stroke="#6b7280"
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis 
                    stroke="#6b7280"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => `$${value.toLocaleString()}`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />

                  <Line
                    type="monotone"
                    dataKey="subscription_payment"
                    name="Subscription Payments"
                    stroke="#6366f1"           // indigo-600
                    strokeWidth={2}
                    dot={{ r: 4, strokeWidth: 2 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="payments_due"
                    name="Payments Due"
                    stroke="#f59e0b"            // amber-600
                    strokeWidth={2}
                    dot={{ r: 4, strokeWidth: 2 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Revenue Cards */}
          <div className="space-y-6">
            <RevenueCard
              title="Revenue This Month"
              value={overview.revenue_this_month || 0}
              previous={overview.revenue_last_month || 0}
              isPositive={overview.revenue_this_month >= (overview.revenue_last_month || 0)}
            />

            <RevenueCard
              title="Revenue Last Month"
              value={overview.revenue_last_month || 0}
              previous={overview.revenue_this_month || 0}
              isPositive={false}
              showComparison={false}
            />
          </div>
        </div>

        {/* Recent Transactions */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            {overview.transactions?.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px]">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Code</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Date</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Amount</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.transactions.map((tx, i) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="py-4 px-4 font-mono text-sm">{tx.transaction_code}</td>
                        <td className="py-4 px-4 text-gray-600">{tx.date}</td>
                        <td className="py-4 px-4 font-medium text-indigo-700">
                          ${tx.amount?.toLocaleString() || '0'}
                        </td>
                        <td className="py-4 px-4">
                          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                            tx.status?.toLowerCase() === 'completed' 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-gray-100 text-gray-800'
                          }`}>
                            {tx.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500">
                No recent transactions
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Stat Card (same as before)
function StatCard({ icon, title, value, color }) {
  return (
    <Card className={`bg-gradient-to-br ${color} text-white shadow-lg`}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium opacity-90">{title}</p>
            <p className="text-3xl font-bold mt-2">{value}</p>
          </div>
          <div className="opacity-80">
            {React.cloneElement(icon, { size: 32 })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Revenue Card (same as before)
function RevenueCard({ title, value, previous, isPositive, showComparison = true }) {
  const change = value - (previous || 0);
  const percent = previous ? Math.round((change / previous) * 100) : 0;

  return (
    <Card>
      <CardContent className="p-6">
        <p className="text-sm font-medium text-gray-600">{title}</p>
        <p className="text-3xl font-bold mt-2 text-gray-900">
          ${value.toLocaleString()}
        </p>
        
        {showComparison && (
          <div className="mt-4 flex items-center gap-2">
            {isPositive ? (
              <TrendingUp className="h-5 w-5 text-green-600" />
            ) : (
              <TrendingDown className="h-5 w-5 text-red-600" />
            )}
            <span className={`text-sm font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
              {isPositive ? '+' : ''}{percent}% from last month
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}