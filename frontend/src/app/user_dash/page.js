"use client"
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Award, Target, CheckCircle2, TrendingUp, Calendar } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/hooks/use-session';

// This page used to render a single hardcoded object — "Good Evening, Lisa
// Thompson" for every single user regardless of who was actually logged
// in, a fake "Star Employee of the Month" card with a randomuser.me photo,
// and a promotional card for a made-up "Alora Academy" partner with a
// dead "Enroll Now" button. None of it reflected the logged-in user or any
// real integration. It now fetches GET /api/performance/:username (a real
// endpoint that was already implemented) and only renders what that
// endpoint actually computes.
const getStatusColor = (status) => {
  switch (status) {
    case 'Claimed': return 'bg-green-500 hover:bg-green-600';
    case 'Issued': return 'bg-blue-500 hover:bg-blue-600';
    case 'Revoked': return 'bg-red-500 hover:bg-red-600';
    default: return 'bg-gray-500 hover:bg-gray-600';
  }
};

const formatDate = (dateString) => {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function EmployeeDashboard() {
  const { session, loading: sessionLoading } = useSession();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const username = session?.username;
    if (sessionLoading || !username) return;

    const fetchPerformance = async () => {
      try {
        setIsLoading(true);
        const response = await apiFetch(`/performance/${username}`);
        if (!response.ok) {
          throw new Error(`Error fetching your dashboard: ${response.status}`);
        }
        setData(await response.json());
      } catch (err) {
        console.error('Failed to fetch performance data:', err);
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPerformance();
  }, [session, sessionLoading]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-lg font-medium text-muted-foreground">Loading your dashboard…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md">
          <p className="text-lg font-medium text-destructive mb-2">Couldn't load your dashboard</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  const achievements = data.achievements || [];
  const recentAchievements = achievements.slice(0, 5);

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div>
          <h1 className="text-4xl font-bold text-foreground mb-2">Welcome back, {data.user?.name || data.user?.username}</h1>
          <p className="text-muted-foreground text-lg">{data.user?.organization}</p>
        </div>

        {/* Stats Grid — real metrics from GET /api/performance/:username */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="bg-card border-border hover:shadow-lg transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Credentials This Month</CardTitle>
              <Award className="h-5 w-5 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-foreground">{data.metrics?.credentials_this_month ?? 0}</div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:shadow-lg transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Success Ratio</CardTitle>
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-foreground">{data.metrics?.success_ratio ?? 0}%</div>
              <p className="text-xs text-muted-foreground mt-1">Credentials earned vs. goals available</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:shadow-lg transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Organization Ranking</CardTitle>
              <Target className="h-5 w-5 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-foreground">#{data.metrics?.my_ranking ?? '—'}</div>
              <p className="text-xs text-muted-foreground mt-1">By cumulative score</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:shadow-lg transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Credentials</CardTitle>
              <TrendingUp className="h-5 w-5 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-foreground">{achievements.length}</div>
              <p className="text-xs text-muted-foreground mt-1">All time</p>
            </CardContent>
          </Card>
        </div>

        {/* Recent Achievements — real credential records */}
        <Card className="bg-card border-border shadow-md">
          <CardHeader>
            <CardTitle className="text-2xl text-foreground flex items-center gap-2">
              <Award className="h-6 w-6 text-purple-500" />
              Recent Achievements
            </CardTitle>
            <CardDescription className="text-muted-foreground">Your latest credentials and certifications</CardDescription>
          </CardHeader>
          <CardContent>
            {recentAchievements.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No credentials issued yet.</p>
            ) : (
              <div className="space-y-4">
                {recentAchievements.map((achievement) => (
                  <div
                    key={achievement._id}
                    className="flex items-center justify-between p-4 rounded-xl bg-muted/40 hover:bg-muted/70 transition-all duration-300 border border-border"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                        <Award className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-foreground font-semibold text-base">{achievement.credential_title || 'Credential'}</h3>
                        <div className="flex items-center gap-2 text-muted-foreground text-sm mt-1">
                          <Calendar className="h-4 w-4" />
                          <span>{formatDate(achievement.credential_issue_date)}</span>
                        </div>
                      </div>
                    </div>
                    <Badge className={`${getStatusColor(achievement.credential_status)} text-white px-3 py-1 text-xs flex-shrink-0 ml-2`}>
                      {achievement.credential_status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
