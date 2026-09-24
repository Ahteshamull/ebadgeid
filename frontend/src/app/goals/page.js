'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { 
  Table, 
  TableHeader, 
  TableRow, 
  TableHead, 
  TableBody, 
  TableCell 
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DatePicker } from '@/components/ui/date-picker';
import { 
  Plus, 
  Target, 
  Calendar,
  Trophy,
  Award,
  TrendingUp,
  Building,
  Hash,
  Clock,
  CheckCircle2,
  AlertTriangle,
  BarChart3,
  Users
} from 'lucide-react';
import { toast } from 'sonner';

export default function GoalManagementPage() {
  const { session } = useSession();
  const [goals, setGoals] = useState([]);
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [formData, setFormData] = useState({
    organization_code: '',
    goal_code: '',
    name: '',
    total_score: '',
    qualifying_score: '',
    start_date: '',
    end_date: '',
  });

  const fetchGoals = async () => {
    try {
      const response = await apiClient.get('/goals');
      setGoals(response.data);
    } catch (error) {
      console.error('Failed to fetch goals:', error);
      toast.error('Failed to fetch goals');
    }
  };

  useEffect(() => {
  }, []);

  useEffect(() => {
    if (!session?.organization_code) return;
    fetchGoals();
    setFormData(prev => ({
      ...prev,
      organization_code: session.organization_code,
      goal_code: 'Generated automatically'
    }));
  }, [session]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleDateChange = (name, date) => {
    setFormData({ ...formData, [name]: date });
  };

  const handleSubmit = async () => {
    try {
      if (!formData.name || !formData.total_score || !formData.qualifying_score || !formData.start_date || !formData.end_date) {
        toast.error('Please fill all required fields');
        return;
      }

      const response = await apiClient.post('/goals', formData);
      setGoals([...goals, response.data]);
      setOpen(false);
      setFormData({
        organization_code: session?.organization_code || '',
        goal_code: 'Generated automatically',
        name: '',
        total_score: '',
        qualifying_score: '',
        start_date: '',
        end_date: '',
      });
      toast.success('Goal created successfully!');
    } catch (error) {
      console.error('Failed to add goal:', error);
      toast.error('Failed to create goal');
    }
  };

  const getGoalStatus = (goal) => {
    const now = new Date();
    const startDate = new Date(goal.start_date);
    const endDate = new Date(goal.end_date);

    if (now < startDate) {
      return 'upcoming';
    } else if (now > endDate) {
      return 'completed';
    } else {
      return 'active';
    }
  };

  const getStatusBadge = (goal) => {
    const status = getGoalStatus(goal);
    
    switch (status) {
      case 'active':
        return (
          <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200 flex items-center gap-1 w-fit">
            <TrendingUp className="h-3 w-3" />
            Active
          </Badge>
        );
      case 'upcoming':
        return (
          <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100 border-blue-200 flex items-center gap-1 w-fit">
            <Clock className="h-3 w-3" />
            Upcoming
          </Badge>
        );
      case 'completed':
        return (
          <Badge variant="outline" className="border-slate-300 text-slate-600 flex items-center gap-1 w-fit">
            <CheckCircle2 className="h-3 w-3" />
            Completed
          </Badge>
        );
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const getProgressPercentage = (goal) => {
    const now = new Date();
    const startDate = new Date(goal.start_date);
    const endDate = new Date(goal.end_date);
    
    if (now < startDate) return 0;
    if (now > endDate) return 100;
    
    const totalDuration = endDate - startDate;
    const elapsed = now - startDate;
    return Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const filteredGoals = goals.filter((goal) => {
    if (statusFilter === 'all') return true;
    return getGoalStatus(goal) === statusFilter;
  });

  const stats = {
    total: goals.length,
    active: goals.filter(goal => getGoalStatus(goal) === 'active').length,
    upcoming: goals.filter(goal => getGoalStatus(goal) === 'upcoming').length,
    completed: goals.filter(goal => getGoalStatus(goal) === 'completed').length,
  };

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Section */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              Goal Management
            </h1>
            <p className="text-muted-foreground mt-2">
              Create and manage organizational goals and achievement targets
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-blue-600 hover:bg-blue-700 text-white">
                <Plus className="h-4 w-4" />
                Add Goal
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md bg-card border-border text-foreground">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-foreground">
                  <Target className="h-5 w-5" />
                  Create New Goal
                </DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  Set up a new goal with scoring criteria and timeline
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Organization Code</label>
                  <Input
                    name="organization_code"
                    value={formData.organization_code}
                    onChange={handleInputChange}
                    className="bg-muted/50 border-border text-muted-foreground cursor-not-allowed"
                    readOnly
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Goal Code</label>
                  <Input
                    name="goal_code"
                    value={formData.goal_code}
                    onChange={handleInputChange}
                    className="bg-muted/50 border-border text-muted-foreground cursor-not-allowed"
                    readOnly
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Goal Name *</label>
                  <Input
                    name="name"
                    placeholder="Enter goal name"
                    value={formData.name}
                    onChange={handleInputChange}
                    className="bg-background border-border text-foreground"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Total Score *</label>
                    <Input
                      name="total_score"
                      placeholder="100"
                      value={formData.total_score}
                      onChange={handleInputChange}
                      type="number"
                      className="bg-background border-border text-foreground"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Qualifying Score *</label>
                    <Input
                      name="qualifying_score"
                      placeholder="70"
                      value={formData.qualifying_score}
                      onChange={handleInputChange}
                      type="number"
                      className="bg-background border-border text-foreground"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Start Date *</label>
                    <DatePicker
                      selected={formData.start_date}
                      onSelect={(date) => handleDateChange('start_date', date)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">End Date *</label>
                    <DatePicker
                      selected={formData.end_date}
                      onSelect={(date) => handleDateChange('end_date', date)}
                      minDate={formData.start_date}
                    />
                  </div>
                </div>
                <Button 
                  onClick={handleSubmit}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                >
                  <Target className="mr-2 h-4 w-4" />
                  Create Goal
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-card border-border shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Goals</p>
                  <p className="text-2xl font-bold text-foreground">{stats.total}</p>
                </div>
                <div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg">
                  <Target className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Active</p>
                  <p className="text-2xl font-bold text-foreground">{stats.active}</p>
                </div>
                <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-lg">
                  <TrendingUp className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Upcoming</p>
                  <p className="text-2xl font-bold text-foreground">{stats.upcoming}</p>
                </div>
                <div className="p-2 bg-amber-500/10 text-amber-500 rounded-lg">
                  <Clock className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Completed</p>
                  <p className="text-2xl font-bold text-foreground">{stats.completed}</p>
                </div>
                <div className="p-2 bg-muted text-muted-foreground rounded-lg">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search and Filters */}
        <Card className="bg-card border-border shadow-sm">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="flex flex-1 gap-4 items-center">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[180px] bg-background border-border text-foreground">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-foreground">
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="upcoming">Upcoming</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="text-sm text-muted-foreground">
                Showing {filteredGoals.length} of {goals.length} goals
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Goals Table */}
        <Card className="bg-card border-border overflow-hidden shadow-sm">
          <CardHeader className="pb-3 border-b border-border">
            <CardTitle className="text-xl flex items-center gap-2 text-foreground">
              <Target className="h-5 w-5" />
              Goals
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Manage your organization's goals and achievement targets
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow className="border-b border-border">
                    <TableHead className="text-muted-foreground font-medium">Goal</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Scoring</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Timeline</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Progress</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Status</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Organization</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredGoals.map((goal) => (
                    <TableRow key={goal._id} className="border-b border-border hover:bg-muted/40 transition-colors">
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium text-foreground">{goal.name}</div>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Hash className="h-3 w-3" />
                            {goal.goal_code}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Trophy className="h-3 w-3" />
                            {goal.qualifying_score}/{goal.total_score} points
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Qualifying: {Math.round((goal.qualifying_score / goal.total_score) * 100)}%
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {formatDate(goal.start_date)}
                          </div>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {formatDate(goal.end_date)}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="space-y-1">
                                <div className="w-24 bg-muted rounded-full h-2">
                                  <div 
                                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                    style={{ width: `${getProgressPercentage(goal)}%` }}
                                  />
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {Math.round(getProgressPercentage(goal))}% complete
                                </div>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent className="bg-popover text-popover-foreground border-border">
                              <p>Time progress: {Math.round(getProgressPercentage(goal))}%</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(goal)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Building className="h-3 w-3" />
                          {goal.organization_code}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            
            {filteredGoals.length === 0 && (
              <div className="text-center py-12">
                <Target className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">No goals found</h3>
                <p className="text-muted-foreground mb-4">
                  {statusFilter !== "all" 
                    ? "No goals match the current filter" 
                    : "Get started by creating your first goal"
                  }
                </p>
                <Dialog open={open} onOpenChange={setOpen}>
                  <DialogTrigger asChild>
                    <Button className="bg-blue-600 hover:bg-blue-700 text-white">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Goal
                    </Button>
                  </DialogTrigger>
                </Dialog>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
