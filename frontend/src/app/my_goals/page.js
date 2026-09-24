'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { 
  CheckCircle, 
  Calendar, 
  Target, 
  Trophy, 
  Clock, 
  Lock,
  TrendingUp,
  Award,
  AlertTriangle,
  Package
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function UserGoalPage() {
  const { session } = useSession();
  const [goals, setGoals] = useState([]);
  const [open, setOpen] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [submitStatus, setSubmitStatus] = useState(null);
  const [completionLocks, setCompletionLocks] = useState({});

  const getOrganizationCode = () => session?.organization_code;
  const getUsername = () => session?.username;

  const loadCompletionLocks = () => {
    try {
      const stored = localStorage.getItem('completion_locks');
      if (stored) {
        const locks = JSON.parse(stored);
        const now = Date.now();
        const cleanedLocks = {};
        Object.keys(locks).forEach(key => {
          if (locks[key] > now) {
            cleanedLocks[key] = locks[key];
          }
        });
        setCompletionLocks(cleanedLocks);
        localStorage.setItem('completion_locks', JSON.stringify(cleanedLocks));
      }
    } catch (error) {
      console.error('Failed to load completion locks:', error);
    }
  };

  const saveCompletionLock = (goalCode) => {
    try {
      const lockKey = `${getUsername()}_${goalCode}`;
      const lockUntil = Date.now() + (24 * 60 * 60 * 1000);
      
      const updatedLocks = {
        ...completionLocks,
        [lockKey]: lockUntil
      };
      
      setCompletionLocks(updatedLocks);
      localStorage.setItem('completion_locks', JSON.stringify(updatedLocks));
    } catch (error) {
      console.error('Failed to save completion lock:', error);
    }
  };

  const isTaskLocked = (goalCode) => {
    const lockKey = `${getUsername()}_${goalCode}`;
    const lockTime = completionLocks[lockKey];
    return lockTime && lockTime > Date.now();
  };

  const getRemainingLockTime = (goalCode) => {
    const lockKey = `${getUsername()}_${goalCode}`;
    const lockTime = completionLocks[lockKey];
    if (!lockTime || lockTime <= Date.now()) return null;
    
    const remaining = lockTime - Date.now();
    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
    
    return { hours, minutes };
  };

  const fetchGoals = async () => {
    setFetchLoading(true);
    try {
      const orgCode = getOrganizationCode();
      const response = await apiFetch(`/goals/organization/${orgCode}`);
      const data = await response.json();
      setGoals(data);
    } catch (error) {
      console.error('Failed to fetch goals:', error);
    } finally {
      setFetchLoading(false);
    }
  };

  useEffect(() => {
    if (session) fetchGoals();
    loadCompletionLocks();
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMarkTask = (goal) => {
    setSelectedGoal(goal);
    setMessage('');
    setSubmitStatus(null);
    setOpen(true);
  };

  const handleSubmitCompletion = async () => {
    if (!message.trim()) {
      setSubmitStatus({ type: 'error', message: 'Please enter a completion message' });
      return;
    }

    setLoading(true);
    try {
      const completionData = {
        username: getUsername(),
        message: message.trim(),
        organization_code: getOrganizationCode(),
        goal_code: selectedGoal.goal_code
      };

      const response = await apiFetch('/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(completionData)
      });

      if (!response.ok) {
        throw new Error('Failed to submit completion');
      }
      
      saveCompletionLock(selectedGoal.goal_code);
      
      setSubmitStatus({ 
        type: 'success', 
        message: 'Task completion submitted successfully! You can submit again in 24 hours.' 
      });
      
      setTimeout(() => {
        setOpen(false);
        setMessage('');
        setSubmitStatus(null);
      }, 2000);
      
    } catch (error) {
      console.error('Failed to submit task completion:', error);
      setSubmitStatus({ 
        type: 'error', 
        message: 'Failed to submit task completion. Please try again.' 
      });
    } finally {
      setLoading(false);
    }
  };

  const isGoalActive = (goal) => {
    const now = new Date();
    const startDate = new Date(goal.start_date);
    const endDate = new Date(goal.end_date);
    return now >= startDate && now <= endDate;
  };

  const getGoalStatus = (goal) => {
    const now = new Date();
    const startDate = new Date(goal.start_date);
    const endDate = new Date(goal.end_date);
    
    if (now < startDate) return { status: 'upcoming', label: 'Upcoming', color: 'bg-blue-100 text-blue-800 border-blue-200' };
    if (now > endDate) return { status: 'expired', label: 'Expired', color: 'bg-red-100 text-red-800 border-red-200' };
    return { status: 'active', label: 'Active', color: 'bg-green-100 text-green-800 border-green-200' };
  };

  const stats = {
    total: goals.length,
    active: goals.filter(g => isGoalActive(g)).length,
    upcoming: goals.filter(g => new Date() < new Date(g.start_date)).length,
    expired: goals.filter(g => new Date() > new Date(g.end_date)).length,
  };

  if (fetchLoading) {
    return (
      <div className="min-h-screen p-6 bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-600"></div>
            <span className="ml-3 text-slate-600">Loading goals...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Section */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              My Goals
            </h1>
            <p className="text-muted-foreground mt-2">
              Track and complete your organization's goals
            </p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-card backdrop-blur-sm border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Goals</p>
                  <p className="text-2xl font-bold text-foreground">{stats.total}</p>
                </div>
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <Target className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card backdrop-blur-sm border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Active</p>
                  <p className="text-2xl font-bold text-foreground">{stats.active}</p>
                </div>
                <div className="p-2 bg-green-500/10 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card backdrop-blur-sm border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Upcoming</p>
                  <p className="text-2xl font-bold text-foreground">{stats.upcoming}</p>
                </div>
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <Calendar className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card backdrop-blur-sm border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Expired</p>
                  <p className="text-2xl font-bold text-foreground">{stats.expired}</p>
                </div>
                <div className="p-2 bg-red-500/10 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Goals Table */}
        <Card className="bg-card backdrop-blur-sm border-border overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-xl flex items-center gap-2 text-foreground">
              <Target className="h-5 w-5" />
              Goals
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {goals.length === 0 ? (
              <div className="text-center py-16">
                <Package className="h-16 w-16 text-muted-foreground/40 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">No Goals Available</h3>
                <p className="text-muted-foreground mb-4">
                  There are currently no goals set for your organization.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr className="border-b border-border">
                      <th className="text-left p-4 text-muted-foreground font-medium">Goal Name</th>
                      <th className="text-left p-4 text-muted-foreground font-medium">Goal Code</th>
                      <th className="text-left p-4 text-muted-foreground font-medium">Score</th>
                      <th className="text-left p-4 text-muted-foreground font-medium">Duration</th>
                      <th className="text-left p-4 text-muted-foreground font-medium">Status</th>
                      <th className="text-right p-4 text-muted-foreground font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {goals.map((goal) => {
                      const goalStatus = getGoalStatus(goal);
                      const active = isGoalActive(goal);
                      const locked = isTaskLocked(goal.goal_code);
                      const remainingTime = getRemainingLockTime(goal.goal_code);
                      
                      return (
                        <tr 
                          key={goal._id} 
                          className={`border-b border-border/50 hover:bg-muted/50 transition-colors ${!active ? 'opacity-60' : ''}`}
                        >
                          <td className="p-4">
                            <div className="space-y-1">
                              <div className="font-medium text-foreground">{goal.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {goal.description || 'No description available'}
                              </div>
                            </div>
                          </td>
                          <td className="p-4">
                            <code className="text-xs bg-muted px-2 py-1 rounded font-mono text-foreground border border-border/50">
                              {goal.goal_code}
                            </code>
                          </td>
                          <td className="p-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <Trophy className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                                <span className="font-medium text-foreground">{goal.total_score}</span>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Qualifying: {goal.qualifying_score}
                              </div>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                <Calendar className="h-3 w-3" />
                                {new Date(goal.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </div>
                              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                <Calendar className="h-3 w-3" />
                                {new Date(goal.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </div>
                            </div>
                          </td>
                          <td className="p-4">
                            <Badge className={goalStatus.color}>
                              {goalStatus.status === 'active' && <TrendingUp className="h-3 w-3 mr-1" />}
                              {goalStatus.status === 'upcoming' && <Calendar className="h-3 w-3 mr-1" />}
                              {goalStatus.status === 'expired' && <AlertTriangle className="h-3 w-3 mr-1" />}
                              {goalStatus.label}
                            </Badge>
                          </td>
                          <td className="p-4">
                            <div className="flex justify-end">
                              {locked && remainingTime ? (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="flex flex-col items-end gap-1">
                                        <Button
                                          disabled={true}
                                          size="sm"
                                          variant="outline"
                                          className="h-8 text-xs px-3 opacity-50 border-border"
                                        >
                                          <Lock className="h-3 w-3 mr-1" />
                                          Locked
                                        </Button>
                                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                                          <Clock className="h-3 w-3" />
                                          {remainingTime.hours}h {remainingTime.minutes}m
                                        </span>
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>You can submit again in {remainingTime.hours}h {remainingTime.minutes}m</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              ) : (
                                <Button
                                  onClick={() => handleMarkTask(goal)}
                                  disabled={!active}
                                  size="sm"
                                  className={`h-8 text-xs px-3 ${
                                    active 
                                      ? 'bg-primary text-primary-foreground hover:bg-primary/90' 
                                      : 'bg-muted text-muted-foreground cursor-not-allowed'
                                  }`}
                                >
                                  <CheckCircle className="h-3 w-3 mr-1" />
                                  Mark Complete
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Mark Task Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[500px] bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
              Mark Task as Complete
            </DialogTitle>
          </DialogHeader>
          
          {selectedGoal && (
            <div className="py-4 space-y-4">
              <Card className="bg-muted/40 border-border">
                <CardContent className="p-4">
                  <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Award className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    {selectedGoal.name}
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Goal Code:</span>
                      <code className="bg-background px-2 py-0.5 rounded text-xs font-mono border border-border text-foreground">
                        {selectedGoal.goal_code}
                      </code>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Score:</span>
                      <span className="font-medium text-foreground flex items-center gap-1">
                        <Trophy className="h-3 w-3 text-yellow-600 dark:text-yellow-400" />
                        {selectedGoal.total_score} points
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Qualifying Score:</span>
                      <span className="font-medium text-foreground">
                        {selectedGoal.qualifying_score} points
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Completion Message <span className="text-red-500">*</span>
                </label>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe what you completed for this goal..."
                  rows={4}
                  className="w-full bg-background border-border text-foreground"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Please provide details about your progress on this goal
                </p>
              </div>

              {submitStatus && (
                <Alert className={submitStatus.type === 'error' ? 'bg-destructive/10 border-destructive/20 text-destructive' : 'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400'}>
                  {submitStatus.type === 'error' ? (
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                  ) : (
                    <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                  )}
                  <AlertDescription>
                    {submitStatus.message}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <DialogFooter className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => setOpen(false)}
              disabled={loading}
              className="border-border text-foreground"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSubmitCompletion}
              disabled={loading || !message.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground mr-2"></div>
                  Submitting...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Mark as Complete
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
