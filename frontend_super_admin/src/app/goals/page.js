'use client';

import { useEffect, useState } from 'react';
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
import { checkAuth } from '../../lib/authChecker.js';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
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
  Users,
  Download,
  Paperclip,
  Eye
} from 'lucide-react';
import { toast } from 'sonner';

export default function GoalManagementPage() {
  const { session } = useSession();
  const [goals, setGoals] = useState([]);
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewAttachmentsDialog, setViewAttachmentsDialog] = useState(false);
  const [selectedGoalAttachments, setSelectedGoalAttachments] = useState([]);
  const [formData, setFormData] = useState({
    organization_code: '',
    goal_code: '',
    name: '',
    start_date: '',
    end_date: '',
  });

  const generateGoalCode = () => {
    const timestamp = new Date().getTime().toString(36);
    const random = Math.random().toString(36).substring(2, 6);
    return `GOAL-${timestamp}-${random}`.toUpperCase();
  };

  const fetchGoals = async () => {
    try {
      const response = await apiFetch('/goals');
      if (!response.ok) throw new Error('Failed to fetch goals');
      const data = await response.json();
      setGoals(data);
    } catch (error) {
      console.error('Failed to fetch goals:', error);
      toast.error('Failed to fetch goals');
    }
  };

  const fetchGoalAttachments = async (goalCode) => {
    try {
      // There is no /completions/goal/:code endpoint -- this called one that
      // never existed, so every attachment fetch 404'd and the panel stayed
      // empty with a "Failed to fetch attachments" toast. /completions is the
      // real endpoint; it is scoped server-side to the caller's own
      // organization, so filtering by goal here narrows that set rather than
      // widening it.
      const response = await apiFetch('/completions');
      if (!response.ok) throw new Error('Failed to fetch attachments');
      const todas = (await response.json()) || [];
      const completions = todas.filter((c) => c.goal_code === goalCode);
      
      const allAttachments = [];
      completions.forEach(completion => {
        if (completion.attachment_url && Array.isArray(completion.attachment_url)) {
          completion.attachment_url.forEach(url => {
            allAttachments.push({
              url,
              username: completion.username,
              message: completion.message,
              status: completion.status,
              submittedDate: completion.createdAt || new Date().toISOString()
            });
          });
        }
      });
      
      return allAttachments;
    } catch (error) {
      console.error('Failed to fetch attachments:', error);
      return [];
    }
  };

  const handleViewAttachments = async (goalCode) => {
    const attachments = await fetchGoalAttachments(goalCode);
    setSelectedGoalAttachments(attachments);
    setViewAttachmentsDialog(true);
  };

  const downloadFile = async (url, filename) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename || url.split('/').pop() || 'attachment';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download failed:', error);
      toast.error('Failed to download file');
    }
  };

  const getFileNameFromUrl = (url) => {
    try {
      return decodeURIComponent(url.split('/').pop().split('?')[0]);
    } catch (e) {
      return 'attachment';
    }
  };

  const getFileTypeIcon = (url) => {
    const extension = url.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension)) {
      return '🖼️';
    } else if (extension === 'pdf') {
      return '📄';
    } else if (['doc', 'docx'].includes(extension)) {
      return '📝';
    } else if (['xls', 'xlsx'].includes(extension)) {
      return '📊';
    } else {
      return '📎';
    }
  };

  useEffect(() => {
    checkAuth('admin');
  }, []);

  useEffect(() => {
    fetchGoals();
  }, []);

  useEffect(() => {
    if (!session) return;
    setFormData(prev => ({
      ...prev,
      organization_code: session.organization_code,
      goal_code: generateGoalCode()
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
      if (!formData.name || !formData.start_date || !formData.end_date) {
        toast.error('Please fill all required fields');
        return;
      }

      const dataToSubmit = {
        ...formData,
        goal_code: generateGoalCode(),
        total_score: '100', // Silently set to 100
        qualifying_score: '100' // Silently set to 100
      };
      
      const response = await apiFetch('/goals', {
        method: 'POST',
        body: JSON.stringify(dataToSubmit),
      });
      if (!response.ok) throw new Error('Failed to create goal');
      const data = await response.json();
      setGoals([...goals, data]);
      setOpen(false);
      setFormData({
        organization_code: session?.organization_code,
        goal_code: generateGoalCode(),
        name: '',
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
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
              Goal Management
            </h1>
            <p className="text-slate-600 mt-2">
              Create and manage organizational goals
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-blue-600 hover:bg-blue-700">
                <Plus className="h-4 w-4" />
                Add Goal
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md bg-white">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Create New Goal
                </DialogTitle>
                <DialogDescription>
                  Set up a new goal with timeline
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Organization Code</label>
                  <Input
                    name="organization_code"
                    value={formData.organization_code}
                    onChange={handleInputChange}
                    className="bg-slate-50 border-slate-200 cursor-not-allowed"
                    readOnly
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Goal Code</label>
                  <Input
                    name="goal_code"
                    value={formData.goal_code}
                    onChange={handleInputChange}
                    className="bg-slate-50 border-slate-200 cursor-not-allowed"
                    readOnly
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Goal Name *</label>
                  <Input
                    name="name"
                    placeholder="Enter goal name"
                    value={formData.name}
                    onChange={handleInputChange}
                    className="bg-white border-slate-200"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Start Date *</label>
                    <DatePicker
                      selected={formData.start_date}
                      onSelect={(date) => handleDateChange('start_date', date)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">End Date *</label>
                    <DatePicker
                      selected={formData.end_date}
                      onSelect={(date) => handleDateChange('end_date', date)}
                      minDate={formData.start_date}
                    />
                  </div>
                </div>
                <Button 
                  onClick={handleSubmit}
                  className="w-full bg-blue-600 hover:bg-blue-700"
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
          <Card className="bg-white/50 backdrop-blur-sm border-slate-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">Total Goals</p>
                  <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
                </div>
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Target className="h-5 w-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white/50 backdrop-blur-sm border-slate-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">Active</p>
                  <p className="text-2xl font-bold text-slate-900">{stats.active}</p>
                </div>
                <div className="p-2 bg-green-100 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white/50 backdrop-blur-sm border-slate-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">Upcoming</p>
                  <p className="text-2xl font-bold text-slate-900">{stats.upcoming}</p>
                </div>
                <div className="p-2 bg-yellow-100 rounded-lg">
                  <Clock className="h-5 w-5 text-yellow-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white/50 backdrop-blur-sm border-slate-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">Completed</p>
                  <p className="text-2xl font-bold text-slate-900">{stats.completed}</p>
                </div>
                <div className="p-2 bg-slate-100 rounded-lg">
                  <CheckCircle2 className="h-5 w-5 text-slate-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search and Filters */}
        <Card className="bg-white/80 backdrop-blur-sm border-slate-200">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="flex flex-1 gap-4 items-center">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[180px] bg-white/50 border-slate-200">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="upcoming">Upcoming</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="text-sm text-slate-500">
                Showing {filteredGoals.length} of {goals.length} goals
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Goals Table */}
        <Card className="bg-white/80 backdrop-blur-sm border-slate-200 overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-xl flex items-center gap-2">
              <Target className="h-5 w-5" />
              Goals
            </CardTitle>
            <CardDescription>
              Manage your organization&apos;s goals
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50/80">
                  <TableRow className="border-b border-slate-200">
                    <TableHead className="text-slate-600 font-medium">Goal</TableHead>
                    <TableHead className="text-slate-600 font-medium">Timeline</TableHead>
                    <TableHead className="text-slate-600 font-medium">Progress</TableHead>
                    <TableHead className="text-slate-600 font-medium">Attachments</TableHead>
                    <TableHead className="text-slate-600 font-medium">Status</TableHead>
                    <TableHead className="text-slate-600 font-medium">Organization</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredGoals.map((goal) => (
                    <TableRow key={goal._id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium text-slate-900">{goal.name}</div>
                          <div className="flex items-center gap-1 text-sm text-slate-500">
                            <Hash className="h-3 w-3" />
                            {goal.goal_code}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 text-sm text-slate-600">
                            <Calendar className="h-3 w-3" />
                            {formatDate(goal.start_date)}
                          </div>
                          <div className="flex items-center gap-1 text-sm text-slate-600">
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
                                <div className="w-24 bg-slate-200 rounded-full h-2">
                                  <div 
                                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                    style={{ width: `${getProgressPercentage(goal)}%` }}
                                  />
                                </div>
                                <div className="text-xs text-slate-500">
                                  {Math.round(getProgressPercentage(goal))}% complete
                                </div>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Time progress: {Math.round(getProgressPercentage(goal))}%</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1"
                          onClick={() => handleViewAttachments(goal.goal_code)}
                        >
                          <Paperclip className="h-3 w-3" />
                          View Files
                        </Button>
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(goal)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm text-slate-600">
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
                <Target className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-900 mb-2">No goals found</h3>
                <p className="text-slate-500 mb-4">
                  {statusFilter !== "all" 
                    ? "No goals match the current filter" 
                    : "Get started by creating your first goal"
                  }
                </p>
                <Dialog open={open} onOpenChange={setOpen}>
                  <DialogTrigger asChild>
                    <Button>
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

      {/* Attachments Dialog */}
      <Dialog open={viewAttachmentsDialog} onOpenChange={setViewAttachmentsDialog}>
        <DialogContent className="sm:max-w-2xl bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Paperclip className="h-5 w-5" />
              Goal Attachments
            </DialogTitle>
            <DialogDescription>
              View and download files submitted for this goal
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {selectedGoalAttachments.length === 0 ? (
              <div className="text-center py-8">
                <Paperclip className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-900 mb-2">No Attachments</h3>
                <p className="text-slate-500">
                  No files have been submitted for this goal yet.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-slate-600">
                    {selectedGoalAttachments.length} file(s) found
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      selectedGoalAttachments.forEach((attachment, index) => {
                        setTimeout(() => {
                          downloadFile(attachment.url, getFileNameFromUrl(attachment.url));
                        }, index * 500);
                      });
                    }}
                  >
                    <Download className="h-3 w-3 mr-1" />
                    Download All
                  </Button>
                </div>
                
                <div className="max-h-96 overflow-y-auto">
                  <div className="space-y-2">
                    {selectedGoalAttachments.map((attachment, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-3 border border-slate-200 rounded-lg hover:bg-slate-50"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="text-xl">
                            {getFileTypeIcon(attachment.url)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-slate-900 truncate">
                                {getFileNameFromUrl(attachment.url)}
                              </p>
                              <Badge 
                                variant="outline" 
                                className={
                                  attachment.status === 'approved' ? 'bg-green-100 text-green-800 border-green-200' :
                                  attachment.status === 'rejected' ? 'bg-red-100 text-red-800 border-red-200' :
                                  'bg-yellow-100 text-yellow-800 border-yellow-200'
                                }
                              >
                                {attachment.status || 'under_review'}
                              </Badge>
                            </div>
                            <div className="text-xs text-slate-500 space-y-1 mt-1">
                              <p>Submitted by: {attachment.username}</p>
                              <p className="truncate">Message: {attachment.message}</p>
                              <p>Date: {new Date(attachment.submittedDate).toLocaleDateString()}</p>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => window.open(attachment.url, '_blank')}
                                  className="h-8 w-8 p-0"
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Preview file</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => downloadFile(attachment.url, getFileNameFromUrl(attachment.url))}
                            className="h-8 gap-1"
                          >
                            <Download className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}