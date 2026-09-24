"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Award, Target, CheckCircle2, TrendingUp, Calendar, User, Star, Sparkles, Loader2, RefreshCw } from 'lucide-react';
import { useLocale } from '@/context/Localecontext';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
export default function EmployeeDashboard() {
  const { session } = useSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [username, setUsername] = useState('');
  const [isStarEmployee, setIsStarEmployee] = useState(false);
  const { t } = useLocale();
  const fetchEmployeeData = async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      setError(null);

      // SA-01 fix: was localStorage.getItem('org_code'/'username'/'token'),
      // always null now that login no longer writes to localStorage.
      // Session lives in the httpOnly cookie; useSession() reads it via
      // /auth/me, and apiFetch() sends the cookie automatically -- no
      // manual Authorization header needed.
      const orgCode = session?.organization_code;
      const storedUsername = session?.username;

      if (!orgCode) {
        throw new Error('Organization code not found. Please log in again.');
      }

      if (!storedUsername) {
        throw new Error('Username not found. Please log in again.');
      }

      setUsername(storedUsername);

      const response = await apiFetch(`/overview/employee/${orgCode}/${storedUsername}`, {
        cache: 'no-cache',
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch employee data: ${response.status}`);
      }

      const result = await response.json();
      setData(result);

      // Check if current user is the star employee
      // You can customize this logic based on your requirements
      // Here I'm checking if the star employee's username matches the current user
      // You might need to adjust this based on your data structure
      if (result.star_employee && result.star_employee.username === storedUsername) {
        setIsStarEmployee(true);
      } else {
        setIsStarEmployee(false);
      }

    } catch (err) {
      setError(err.message);
      console.error('Error fetching employee dashboard data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchEmployeeData(false);
  };

  useEffect(() => {
    // session resolves asynchronously via useSession()'s /auth/me call --
    // wait for it so fetchEmployeeData uses the real org code/username
    // instead of throwing "not found" before the session is ready.
    if (!session) return;
    fetchEmployeeData();
  }, [session]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'Claimed': return 'bg-green-500 hover:bg-green-600';
      case 'Issued': return 'bg-blue-500 hover:bg-blue-600';
      case 'Revoked': return 'bg-red-500 hover:bg-red-600';
      case 'Expired': return 'bg-yellow-500 hover:bg-yellow-600';
      default: return 'bg-gray-500 hover:bg-gray-600';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Date not available';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return 'Invalid date';
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">{t('loading_employee_dashboard')}</p>
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
            <h3 className="text-lg font-semibold text-red-800 mb-2">{t('error_loading_dashboard')}</h3>
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
          <p className="text-gray-600">{t('no_employee_data_available')}</p>
          <p className="text-sm text-gray-500 mt-1">{t('logged_in_as')}: {username}</p>
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

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header Section with refresh button */}
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-2">
              <h1 className="text-4xl font-bold text-gray-900">{data.message}</h1>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? t('refreshing') : t('refresh')}
              </button>
            </div>
            <p className="text-gray-600 text-lg">{data.call}</p>
            <p className="text-sm text-gray-500 mt-1">{t('logged_in_as')}: {username}</p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="hover:shadow-lg transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                {t('credentials_issued')}
              </CardTitle>
              <Award className="h-5 w-5 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-gray-900">{data.credentials_issued}</div>
              <p className="text-xs text-gray-500 mt-1">{t('total_issued')}</p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                {t('credentials_claimed')}
              </CardTitle>
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-gray-900">{data.credentials_claimed}</div>
              <p className="text-xs text-gray-500 mt-1">
                {data.credentials_issued > 0
                  ? `${Math.round((data.credentials_claimed / data.credentials_issued) * 100)}% ${t('claim_rate')}`
                  : t('no_credentials_issued_yet')
                }
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                {t('active_goals')}
              </CardTitle>
              <Target className="h-5 w-5 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-gray-900">{data.active_goals}</div>
              <p className="text-xs text-gray-500 mt-1">{t('in_progress')}</p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                {t('completed_goals')}
              </CardTitle>
              <TrendingUp className="h-5 w-5 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-gray-900">{data.completed_goals}</div>
              <p className="text-xs text-gray-500 mt-1">{t('this_period')}</p>
            </CardContent>
          </Card>
        </div>

        {/* Star Employee Card - Conditionally rendered */}
        {isStarEmployee ? (
          <Card className="shadow-md bg-gradient-to-r from-yellow-50 to-orange-50 border-yellow-200">
            <CardHeader>
              <CardTitle className="text-2xl text-gray-900 flex items-center gap-2">
                <Star className="h-6 w-6 text-yellow-500 fill-yellow-500" />
                {t('star_employee_of_the_month')}
              </CardTitle>
              <CardDescription className="text-gray-700">
                {t('star_employee_congrats')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-6 p-4 rounded-xl bg-white border border-yellow-200">
                <img
                  src={data.star_employee?.profile_picture}
                  alt={data.star_employee?.name || t('star_employee')}
                  className="w-24 h-24 rounded-full border-4 border-yellow-400 shadow-lg object-cover"
                  onError={(e) => {
                    e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(data.star_employee?.name || 'Star Employee')}&background=random`;
                  }}
                />
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">{data.star_employee?.name || t('star_employee')}</h3>
                  <p className="text-lg text-gray-600 mt-1">{data.star_employee?.designation || t('designation')}</p>
                  <div className="flex gap-2 mt-3">
                    <Badge className="bg-yellow-500 hover:bg-yellow-600 text-white">
                      {t('top_performer')}
                    </Badge>
                    <Badge className="bg-purple-500 hover:bg-purple-600 text-white">
                      {t('team_leader')}
                    </Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-md bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
            <CardHeader>
              <CardTitle className="text-2xl text-gray-900 flex items-center gap-2">
                <Sparkles className="h-6 w-6 text-blue-500" />
                {t('keep_going')}
              </CardTitle>
              <CardDescription className="text-gray-700">
                {t('keep_going_description')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center gap-6 p-6 rounded-xl bg-white border border-blue-200">
                <div className="text-center">
                  <div className="w-20 h-20 rounded-full border-4 border-blue-300 flex items-center justify-center mx-auto mb-4">
                    <TrendingUp className="h-10 w-10 text-blue-500" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900">{t('making_progress')}</h3>
                  <p className="text-gray-600 mt-2">{t('making_progress_description')}</p>
                  <div className="flex gap-2 mt-4 justify-center">
                    <Badge className="bg-blue-500 hover:bg-blue-600 text-white">
                      {t('on_track')}
                    </Badge>
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      {t('motivated')}
                    </Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bottom Two Boxes Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Achievements */}
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="text-2xl text-gray-900 flex items-center gap-2">
                <Award className="h-6 w-6 text-purple-500" />
                {t('recent_achievements')}
              </CardTitle>
              <CardDescription className="text-gray-600">
                {t('recent_achievements_description')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {data.recent_achievements && data.recent_achievements.length > 0 ? (
                  data.recent_achievements.map((achievement) => (
                    <div
                      key={achievement._id}
                      className="flex items-center justify-between p-4 rounded-xl bg-gray-50 hover:bg-gray-100 transition-all duration-300 border border-gray-200"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                          <Award className="h-6 w-6 text-purple-600" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-gray-900 font-semibold text-base">
                            {achievement.credential_title || t('untitled_credential')}
                          </h3>
                          <div className="flex items-center gap-2 text-gray-600 text-sm mt-1">
                            <Calendar className="h-4 w-4" />
                            <span>{formatDate(achievement.credential_issue_date)}</span>
                          </div>
                        </div>
                      </div>
                      <Badge className={`${getStatusColor(achievement.credential_status)} text-white px-3 py-1 text-xs flex-shrink-0 ml-2`}>
                        {t(achievement.credential_status?.toLowerCase()) || achievement.credential_status || t('unknown')}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8">
                    <Award className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">{t('no_recent_achievements')}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}