"use client";

import React, { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Users, FileText, Award, CheckCircle, Loader2, RefreshCw } from 'lucide-react';
import { useLocale } from '@/context/Localecontext';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
import PlanUsageCard from '@/components/PlanUsageCard';

const Dashboard = () => {
  const { session } = useSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const { t } = useLocale();

  const fetchDashboardData = async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      setError(null);

      // SA-01 fix: was localStorage.getItem('org_code'/'token'), always
      // null now that login no longer writes to localStorage. Session
      // lives in the httpOnly cookie; useSession() reads it via /auth/me,
      // and apiFetch() sends the cookie automatically -- no manual
      // Authorization header needed.
      const orgCode = session?.organization_code;

      if (!orgCode) {
        throw new Error('Organization code not found. Please log in again.');
      }

      const response = await apiFetch(`/overview/${orgCode}`, {
        cache: 'no-cache',
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch dashboard data: ${response.status}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err.message);
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchDashboardData(false);
  };

  useEffect(() => {
    // session resolves asynchronously via useSession()'s /auth/me call --
    // wait for it so fetchDashboardData uses the real org code instead of
    // throwing "not found" before the session is ready.
    if (!session) return;
    fetchDashboardData();
  }, [session]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">{t("loading_dashboard_data")}</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-red-800 mb-2">{t("error_loading_dashboard")}</h3>
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={handleRefresh}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2 mx-auto"
            >
              <RefreshCw className="w-4 h-4" />
              {t('try_again')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // No data state
  if (!data) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">{t("no_dashboard_data_available")}</p>
          <button
            onClick={handleRefresh}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {t('refresh_data')}
          </button>
        </div>
      </div>
    );
  }

  // Transform data for charts
  const credentialChartData = [
    {
      name: t('claimed'),
      value: data.charts[0].monthly_credential_charts.credentials_claimed_this_month,
      color: '#10b981'
    },
    {
      name: t('unclaimed') || 'Unclaimed',
      value: data.charts[0].monthly_credential_charts.credentials_unclaimed,
      color: '#f59e0b'
    },
    {
      name: t('revoked'),
      value: data.charts[0].monthly_credential_charts.credentials_revoked_this_month,
      color: '#ef4444'
    }
  ];

  const contractChartData = [
    {
      name: t('active'),
      value: data.charts[0].contract_summary.contracts_active,
      color: '#10b981'
    },
    {
      name: t('disputed'),
      value: data.charts[0].contract_summary.contracts_disputed,
      color: '#ef4444'
    },
    {
      name: t('in_discussion'),
      value: data.charts[0].contract_summary.contract_in_discussion,
      color: '#3b82f6'
    },
    {
      name: t('other'),
      value: data.charts[0].contract_summary.total_contracts -
        data.charts[0].contract_summary.contracts_active -
        data.charts[0].contract_summary.contracts_disputed -
        data.charts[0].contract_summary.contract_in_discussion,
      color: '#6b7280'
    }
  ];

  // Transform line chart data
  const monthlyData = data.charts[0].monthly_contract_chart;
  const lineChartData = [
    { month: 'Jan', issued: monthlyData.credentials_issued_jan, claimed: monthlyData.credentials_claimed_jan },
    { month: 'Feb', issued: monthlyData.credentials_issued_feb, claimed: monthlyData.credentials_claimed_feb },
    { month: 'Mar', issued: monthlyData.credentials_issued_mar, claimed: monthlyData.credentials_claimed_mar },
    { month: 'Apr', issued: monthlyData.credentials_issued_apr, claimed: monthlyData.credentials_claimed_apr },
    { month: 'May', issued: monthlyData.credentials_issued_may, claimed: monthlyData.credentials_claimed_may },
    { month: 'Jun', issued: monthlyData.credentials_issued_jun, claimed: monthlyData.credentials_claimed_jun },
    { month: 'Jul', issued: monthlyData.credentials_issued_jul, claimed: monthlyData.credentials_claimed_jul },
    { month: 'Aug', issued: monthlyData.credentials_issued_aug, claimed: monthlyData.credentials_claimed_aug },
    { month: 'Sep', issued: monthlyData.credentials_issued_sep, claimed: monthlyData.credentials_claimed_sep },
    { month: 'Oct', issued: monthlyData.credentials_issued_oct, claimed: monthlyData.credentials_claimed_oct },
    { month: 'Nov', issued: monthlyData.credentials_issued_nov, claimed: monthlyData.credentials_claimed_nov },
    { month: 'Dec', issued: monthlyData.credentials_issued_dec, claimed: monthlyData.credentials_claimed_dec }
  ];

  const StatCard = ({ title, value, subtitle, icon: Icon, bgColor }) => (
    <div className="rounded-lg border shadow-sm overflow-hidden" style={{ backgroundColor: bgColor }}>
      <div className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-600 mb-1">{title}</p>
            <h3 className="text-3xl font-bold text-gray-900">{value}</h3>
            {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
          </div>
          <div className="p-3 bg-white rounded-full shadow-sm">
            <Icon className="w-6 h-6 text-gray-700" />
          </div>
        </div>
      </div>
    </div>
  );

  const Card = ({ children, bgColor }) => (
    <div className="rounded-lg border shadow-sm" style={{ backgroundColor: bgColor }}>
      {children}
    </div>
  );

  const CardHeader = ({ children }) => (
    <div className="p-6 pb-4">
      {children}
    </div>
  );

  const CardTitle = ({ children, className = "" }) => (
    <h3 className={`font-semibold leading-none tracking-tight ${className}`}>
      {children}
    </h3>
  );

  const CardContent = ({ children }) => (
    <div className="p-6 pt-0">
      {children}
    </div>
  );

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header with refresh button */}
        <div className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">{t("dashboard_overview")}</h1>
            <p className="text-gray-600 flex items-center gap-2">
              {t("last_synced")}: {data.sync_on}
              {refreshing && <Loader2 className="w-4 h-4 animate-spin" />}
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh Data'}
          </button>
        </div>

        {/* Plan & consumption for THIS admin's own organization. Same
            component and same endpoint the Super Admin dashboard uses, so
            both roles read one source of truth and cannot disagree. The
            endpoint defaults to the caller's own organization and refuses
            any other, so nothing here can widen what this admin sees. */}
        <div className="mb-8">
          <PlanUsageCard title="Your Plan & Usage" />
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard
            title={`${t("total_employees")}`}
            value={data.total_employees}
            subtitle={`${data.active_employees} active`}
            icon={Users}
            bgColor="#e0f2fe"
          />
          <StatCard
            title={`${t("total_contracts")}`}
            value={data.total_contract}
            subtitle={`${data.active_contract} active`}
            icon={FileText}
            bgColor="#dbeafe"
          />
          <StatCard
            title={`${t("credentials_issued")}`}
            value={data.credentials_issued}
            subtitle="All time"
            icon={Award}
            bgColor="#fef3c7"
          />
          <StatCard
            title={`${t("credentials_claimed")}`}
            value={data.credential_claimed}
            subtitle={`${data.credentials_issued > 0 ? ((data.credential_claimed / data.credentials_issued) * 100).toFixed(1) : 0}% claim rate`}
            icon={CheckCircle}
            bgColor="#d1fae5"
          />
        </div>

        {/* Line Chart - Full Width */}
        <div className="mb-8">
          <Card bgColor="#fef3f3">
            <CardHeader>
              <CardTitle className="text-2xl">{t("yearly_credential_trends")}</CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                {t("year_cred_desc")}
              </p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={lineChartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="month"
                    stroke="#6b7280"
                    style={{ fontSize: '14px' }}
                  />
                  <YAxis
                    stroke="#6b7280"
                    style={{ fontSize: '14px' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'white',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      padding: '10px'
                    }}
                  />
                  <Legend
                    wrapperStyle={{ paddingTop: '20px' }}
                    iconType="line"
                  />
                  <Line
                    type="monotone"
                    dataKey="issued"
                    stroke="#3b82f6"
                    strokeWidth={3}
                    name={t('issued')}
                    dot={{ fill: '#3b82f6', r: 5 }}
                    activeDot={{ r: 7 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="claimed"
                    stroke="#10b981"
                    strokeWidth={3}
                    name={t('claimed')}
                    dot={{ fill: '#10b981', r: 5 }}
                    activeDot={{ r: 7 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Pie Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <Card bgColor="#fef9f3">
            <CardHeader>
              <CardTitle className="text-xl">{t('monthly_creds')}</CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                {data.charts[0].monthly_credential_charts.credential_issued_this_month} {t('issued_this_month')}
              </p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={credentialChartData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {credentialChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card bgColor="#f0f9ff">
            <CardHeader>
              <CardTitle className="text-xl">{t('contract_summary')}</CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                {data.charts[0].contract_summary.total_contracts} {t('total_contracts')}
              </p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={contractChartData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {contractChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Top Employees */}
        <Card bgColor="#faf5ff">
          <CardHeader>
            <CardTitle className="text-2xl">{t('top_employees')}: {data.employees_overview[0].top_five_employees.length}</CardTitle>
            <p className="text-sm text-gray-600 mt-1">{t('based_on_credentials_issued')}</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {data.employees_overview[0].top_five_employees.map((employee, index) => (
                <div
                  key={index}
                  className="flex items-center p-4 bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center gap-4 flex-1">
                    <div className="relative">
                      <img
                        src={employee.profile_pic}
                        alt={employee.name}
                        className="w-14 h-14 rounded-full object-cover ring-2 ring-purple-200"
                        onError={(e) => {
                          e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(employee.name)}&background=random`;
                        }}
                      />
                      <div className="absolute -top-1 -left-1 w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs font-bold">
                        {index + 1}
                      </div>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900">{employee.name}</h4>
                      <p className="text-sm text-gray-600">{employee.designation}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-6 text-center">
                    <div>
                      <p className="text-2xl font-bold text-gray-900">{employee.credentials_issued}</p>
                      <p className="text-xs text-gray-600">{t('issued')}</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-green-600">{employee.credentials_claimed}</p>
                      <p className="text-xs text-gray-600">{t('claimed')}</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-red-600">{employee.credentials_revoked}</p>
                      <p className="text-xs text-gray-600">{t('revoked')}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;