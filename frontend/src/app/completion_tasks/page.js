'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { 
  MoreVertical, 
  CheckCircle2, 
  XCircle, 
  Clock,
  User,
  Target,
  MessageSquare,
  Calendar,
  FileCheck,
  AlertTriangle,
  Filter,
  Loader2
} from 'lucide-react';

export default function TaskCompletionPage() {
  const { session } = useSession();
  const [completions, setCompletions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [actionLoading, setActionLoading] = useState(null);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [completionToReject, setCompletionToReject] = useState(null);

  const fetchCompletions = async () => {
    try {
      if (!session?.organization_code) return;
      const response = await apiClient.get(`/completions/org/${session.organization_code}`);
      setCompletions(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch task completions:', error);
      toast.error('Failed to fetch task completions');
      setLoading(false);
    }
  };

  useEffect(() => {
  }, []);

  useEffect(() => { fetchCompletions(); }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleApprove = async (id) => {
    setActionLoading(id);
    try {
      await apiClient.patch(`/completions/${id}/approve`);
      toast.success('Task approved and score updated successfully');
      fetchCompletions();
    } catch (error) {
      console.error('Failed to approve task:', error);
      toast.error('Failed to approve task');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id) => {
    setActionLoading(id);
    try {
      await apiClient.patch(`/completions/${id}/reject`);
      toast.success('Task rejected successfully');
      fetchCompletions();
      setShowRejectDialog(false);
      setCompletionToReject(null);
    } catch (error) {
      console.error('Failed to reject task:', error);
      toast.error('Failed to reject task');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRejectClick = (completion) => {
    setCompletionToReject(completion);
    setShowRejectDialog(true);
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'approved':
        return (
          <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200 flex items-center gap-1 w-fit">
            <CheckCircle2 className="h-3 w-3" />
            Approved
          </Badge>
        );
      case 'rejected':
        return (
          <Badge variant="destructive" className="flex items-center gap-1 w-fit text-white">
            <XCircle className="h-3 w-3" />
            Rejected
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 border-yellow-200 flex items-center gap-1 w-fit">
            <Clock className="h-3 w-3" />
            Under Review
          </Badge>
        );
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const filteredCompletions = completions.filter((completion) => {
    if (statusFilter === 'all') return true;
    return completion.status === statusFilter;
  });

  const stats = {
    total: completions.length,
    pending: completions.filter(c => c.status === 'under_review').length,
    approved: completions.filter(c => c.status === 'approved').length,
    rejected: completions.filter(c => c.status === 'rejected').length,
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex justify-center items-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 dark:text-blue-400 mx-auto" />
          <p className="text-muted-foreground">Loading task completions...</p>
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
              Task Completion Management
            </h1>
            <p className="text-muted-foreground mt-2">
              Review and manage task completion submissions from users
            </p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-card backdrop-blur-sm border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Submissions</p>
                  <p className="text-2xl font-bold text-foreground">{stats.total}</p>
                </div>
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <FileCheck className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card backdrop-blur-sm border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Pending Review</p>
                  <p className="text-2xl font-bold text-foreground">{stats.pending}</p>
                </div>
                <div className="p-2 bg-yellow-500/10 rounded-lg">
                  <Clock className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card backdrop-blur-sm border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Approved</p>
                  <p className="text-2xl font-bold text-foreground">{stats.approved}</p>
                </div>
                <div className="p-2 bg-green-500/10 rounded-lg">
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card backdrop-blur-sm border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Rejected</p>
                  <p className="text-2xl font-bold text-foreground">{stats.rejected}</p>
                </div>
                <div className="p-2 bg-red-500/10 rounded-lg">
                  <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filter Section */}
        <Card className="bg-card backdrop-blur-sm border-border">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">Filter by status:</span>
                <div className="flex gap-2">
                  <Button
                    variant={statusFilter === 'all' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setStatusFilter('all')}
                    className={statusFilter === 'all' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''}
                  >
                    All
                  </Button>
                  <Button
                    variant={statusFilter === 'under_review' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setStatusFilter('under_review')}
                    className={statusFilter === 'under_review' ? 'bg-yellow-600 text-white hover:bg-yellow-700' : ''}
                  >
                    Pending
                  </Button>
                  <Button
                    variant={statusFilter === 'approved' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setStatusFilter('approved')}
                    className={statusFilter === 'approved' ? 'bg-green-600 text-white hover:bg-green-700' : ''}
                  >
                    Approved
                  </Button>
                  <Button
                    variant={statusFilter === 'rejected' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setStatusFilter('rejected')}
                    className={statusFilter === 'rejected' ? 'bg-red-600 text-white hover:bg-red-700' : ''}
                  >
                    Rejected
                  </Button>
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                Showing {filteredCompletions.length} of {completions.length} submissions
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Completions Table */}
        <Card className="bg-card backdrop-blur-sm border-border overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-xl flex items-center gap-2 text-foreground">
              <FileCheck className="h-5 w-5" />
              Task Completion Submissions
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Review and take action on user task completion submissions
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow className="border-b border-border">
                    <TableHead className="text-muted-foreground font-medium">User</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Goal</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Submission</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Status</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Submitted</TableHead>
                    <TableHead className="text-muted-foreground font-medium text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCompletions.map((completion) => (
                    <TableRow key={completion._id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium text-foreground">
                            {completion.user_details?.first_name} {completion.user_details?.last_name}
                          </div>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <User className="h-3 w-3" />
                            {completion.username}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Target className="h-3 w-3" />
                          {completion.goal_code}
                        </div>
                      </TableCell>
                      <TableCell>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="max-w-[300px]">
                                <div className="flex items-start gap-1">
                                  <MessageSquare className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                                  <p className="text-sm text-foreground line-clamp-2 text-left">
                                    {completion.message || 'No message provided'}
                                  </p>
                                </div>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-sm">
                              <p className="text-sm">{completion.message || 'No message provided'}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(completion.status)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {formatDate(completion.createdAt)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          {completion.status === 'under_review' ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-foreground">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48 bg-card border-border">
                                <DropdownMenuItem 
                                  onClick={() => handleApprove(completion._id)}
                                  disabled={actionLoading === completion._id}
                                  className="text-green-600 dark:text-green-400 focus:text-green-600 cursor-pointer"
                                >
                                  {actionLoading === completion._id ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="h-4 w-4 mr-2" />
                                  )}
                                  Approve Submission
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem 
                                  onClick={() => handleRejectClick(completion)}
                                  disabled={actionLoading === completion._id}
                                  className="text-red-600 dark:text-red-400 focus:text-red-600 cursor-pointer"
                                >
                                  <XCircle className="h-4 w-4 mr-2" />
                                  Reject Submission
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <span className="text-xs text-muted-foreground px-3 py-1 flex items-center h-8">
                              {completion.status === 'approved' ? (
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                              ) : (
                                <XCircle className="h-3 w-3 mr-1" />
                              )}
                              {completion.status === 'approved' ? 'Approved' : 'Rejected'}
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            
            {filteredCompletions.length === 0 && (
              <div className="text-center py-12">
                <FileCheck className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">No submissions found</h3>
                <p className="text-muted-foreground">
                  {statusFilter !== "all" 
                    ? "No submissions match the current filter" 
                    : "No task completion submissions yet"
                  }
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Reject Confirmation Dialog */}
      <AlertDialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Reject Submission
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to reject the submission from{' '}
              <strong className="text-foreground">{completionToReject?.user_details?.first_name} {completionToReject?.user_details?.last_name}</strong>?
              <br /><br />
              This action cannot be undone. The user will be notified that their submission was rejected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel 
              onClick={() => setCompletionToReject(null)}
              className="border-border text-foreground"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleReject(completionToReject?._id)}
              disabled={actionLoading === completionToReject?._id}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {actionLoading === completionToReject?._id ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Rejecting...
                </>
              ) : (
                <>
                  <XCircle className="mr-2 h-4 w-4" />
                  Reject Submission
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
