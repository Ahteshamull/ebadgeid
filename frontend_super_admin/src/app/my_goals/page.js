'use client';

import { useEffect, useState } from 'react';
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
  Package,
  Upload,
  X,
  File,
  Image as ImageIcon
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { apiFetch, uploadFile } from '@/lib/api';
import { useSession } from '@/hooks/use-session';

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
  const [files, setFiles] = useState([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);

  // SA-01 fix: was localStorage.getItem('organization_code'/'username'),
  // always null now that login no longer writes to localStorage. Session
  // lives in the httpOnly cookie; useSession() reads it via /auth/me.
  const getOrganizationCode = () => {
    return session?.organization_code || 'org_123';
  };

  const getUsername = () => {
    return session?.username || 'user123';
  };

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
    // session resolves asynchronously via useSession()'s /auth/me call --
    // wait for it so fetchGoals uses the real organization_code instead of
    // the 'org_123' placeholder fallback.
    if (!session) return;
    fetchGoals();
    loadCompletionLocks();
  }, [session]);

  const handleMarkTask = (goal) => {
    setSelectedGoal(goal);
    setMessage('');
    setSubmitStatus(null);
    setFiles([]);
    setOpen(true);
  };

  const handleFileSelect = (event) => {
    const selectedFiles = Array.from(event.target.files);
    
    // Filter for images and PDFs (you can adjust this as needed)
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    const validFiles = selectedFiles.filter(file => allowedTypes.includes(file.type));
    
    if (validFiles.length === 0) {
      setSubmitStatus({ 
        type: 'error', 
        message: 'Please select valid files (JPEG, PNG, GIF, WebP, or PDF)' 
      });
      return;
    }
    
    // Limit to 5 files
    if (files.length + validFiles.length > 5) {
      setSubmitStatus({ 
        type: 'error', 
        message: 'Maximum 5 files allowed' 
      });
      return;
    }
    
    const newFiles = validFiles.map(file => ({
      file,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      name: file.name,
      size: file.size,
      type: file.type,
      uploading: false,
      uploaded: false,
      url: null,
      error: null
    }));
    
    setFiles([...files, ...newFiles]);
    event.target.value = ''; // Reset file input
  };

  const removeFile = (index) => {
    const updatedFiles = [...files];
    if (updatedFiles[index].preview) {
      URL.revokeObjectURL(updatedFiles[index].preview);
    }
    updatedFiles.splice(index, 1);
    setFiles(updatedFiles);
  };

  const uploadFileToStorage = async (fileObj) => {
    try {
      // SA-05 fix: was a bare unauthenticated fetch to the storage domain.
      // uploadFile() (imported from @/lib/api) is the shared authenticated
      // upload helper -- it returns the url string directly or throws.
      const url = await uploadFile(fileObj.file);
      return { ...fileObj, uploaded: true, url, uploading: false };
    } catch (error) {
      console.error('Upload error:', error);
      return { ...fileObj, error: error.message, uploading: false };
    }
  };

  const uploadAllFiles = async () => {
    if (files.length === 0) return [];
    
    setUploadingFiles(true);
    
    const uploadPromises = files.map(async (fileObj, index) => {
      // Update file state to show uploading
      setFiles(prev => prev.map((f, i) => 
        i === index ? { ...f, uploading: true, error: null } : f
      ));
      
      const result = await uploadFileToStorage(fileObj);
      
      // Update file state with result
      setFiles(prev => prev.map((f, i) => 
        i === index ? result : f
      ));
      
      return result;
    });
    
    const results = await Promise.all(uploadPromises);
    setUploadingFiles(false);
    
    return results;
  };

  const handleSubmitCompletion = async () => {
    if (!message.trim()) {
      setSubmitStatus({ type: 'error', message: 'Please enter a completion message' });
      return;
    }

    setLoading(true);

    try {
      // Upload files first
      const uploadedFiles = await uploadAllFiles();
      
      // Check for upload errors
      const failedUploads = uploadedFiles.filter(f => f.error);
      if (failedUploads.length > 0) {
        throw new Error(`Failed to upload ${failedUploads.length} file(s)`);
      }
      
      // Get successful upload URLs
      const attachment_url = uploadedFiles
        .filter(f => f.uploaded && f.url)
        .map(f => f.url);

      const completionData = {
        username: getUsername(),
        message: message.trim(),
        attachment_url,
        organization_code: getOrganizationCode(),
        goal_code: selectedGoal.goal_code
      };

      const response = await apiFetch('/completions', {
        method: 'POST',
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
        setFiles([]);
        // Clean up preview URLs
        files.forEach(file => {
          if (file.preview) {
            URL.revokeObjectURL(file.preview);
          }
        });
      }, 2000);
      
    } catch (error) {
      console.error('Failed to submit task completion:', error);
      setSubmitStatus({ 
        type: 'error', 
        message: error.message || 'Failed to submit task completion. Please try again.' 
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

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
              My Goals
            </h1>
            <p className="text-slate-600 mt-2">
              Track and complete your organization&apos;s goals
            </p>
          </div>
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
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Calendar className="h-5 w-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white/50 backdrop-blur-sm border-slate-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">Expired</p>
                  <p className="text-2xl font-bold text-slate-900">{stats.expired}</p>
                </div>
                <div className="p-2 bg-red-100 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Goals Table */}
        <Card className="bg-white/80 backdrop-blur-sm border-slate-200 overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-xl flex items-center gap-2">
              <Target className="h-5 w-5" />
              Goals
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {goals.length === 0 ? (
              <div className="text-center py-16">
                <Package className="h-16 w-16 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-900 mb-2">No Goals Available</h3>
                <p className="text-slate-500 mb-4">
                  There are currently no goals set for your organization.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50/80">
                    <tr className="border-b border-slate-200">
                      <th className="text-left p-4 text-slate-600 font-medium">Goal Name</th>
                      <th className="text-left p-4 text-slate-600 font-medium">Goal Code</th>
                      <th className="text-left p-4 text-slate-600 font-medium">Score</th>
                      <th className="text-left p-4 text-slate-600 font-medium">Duration</th>
                      <th className="text-left p-4 text-slate-600 font-medium">Status</th>
                      <th className="text-right p-4 text-slate-600 font-medium">Action</th>
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
                          className={`border-b border-slate-100 hover:bg-slate-50/50 transition-colors ${!active ? 'opacity-60' : ''}`}
                        >
                          <td className="p-4">
                            <div className="space-y-1">
                              <div className="font-medium text-slate-900">{goal.name}</div>
                              <div className="text-xs text-slate-500">
                                {goal.description || 'No description available'}
                              </div>
                            </div>
                          </td>
                          <td className="p-4">
                            <code className="text-xs bg-slate-100 px-2 py-1 rounded font-mono text-slate-700">
                              {goal.goal_code}
                            </code>
                          </td>
                          <td className="p-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <Trophy className="h-4 w-4 text-yellow-600" />
                                <span className="font-medium text-slate-900">{goal.total_score}</span>
                              </div>
                              <div className="text-xs text-slate-500">
                                Qualifying: {goal.qualifying_score}
                              </div>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1 text-sm text-slate-600">
                                <Calendar className="h-3 w-3" />
                                {new Date(goal.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </div>
                              <div className="flex items-center gap-1 text-sm text-slate-600">
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
                                          className="h-8 text-xs px-3 opacity-50 border-slate-300"
                                        >
                                          <Lock className="h-3 w-3 mr-1" />
                                          Locked
                                        </Button>
                                        <span className="text-xs text-slate-500 flex items-center gap-1">
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
                                      ? 'bg-black hover:bg-zinc-900 text-white' 
                                      : 'bg-slate-200 text-slate-500 cursor-not-allowed'
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
        <DialogContent className="sm:max-w-[500px] bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Mark Task as Complete
            </DialogTitle>
          </DialogHeader>
          
          {selectedGoal && (
            <div className="py-4 space-y-4">
              <Card className="bg-slate-50 border-slate-200">
                <CardContent className="p-4">
                  <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                    <Award className="h-4 w-4 text-blue-600" />
                    {selectedGoal.name}
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Goal Code:</span>
                      <code className="bg-white px-2 py-0.5 rounded text-xs font-mono border">
                        {selectedGoal.goal_code}
                      </code>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Total Score:</span>
                      <span className="font-medium text-slate-900 flex items-center gap-1">
                        <Trophy className="h-3 w-3 text-yellow-600" />
                        {selectedGoal.total_score} points
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Qualifying Score:</span>
                      <span className="font-medium text-slate-900">
                        {selectedGoal.qualifying_score} points
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Completion Message <span className="text-red-500">*</span>
                </label>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe what you completed for this goal..."
                  rows={4}
                  className="w-full bg-white border-slate-200"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Please provide details about your progress on this goal
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Attachments (Optional)
                </label>
                <div className="space-y-3">
                  <div className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center hover:border-slate-400 transition-colors">
                    <input
                      type="file"
                      multiple
                      accept="image/*,.pdf"
                      onChange={handleFileSelect}
                      className="hidden"
                      id="file-upload"
                    />
                    <label
                      htmlFor="file-upload"
                      className="cursor-pointer flex flex-col items-center"
                    >
                      <Upload className="h-8 w-8 text-slate-400 mb-2" />
                      <span className="text-sm font-medium text-slate-700">
                        Click to upload files
                      </span>
                      <span className="text-xs text-slate-500 mt-1">
                        Images or PDFs, up to 5 files
                      </span>
                    </label>
                  </div>

                  {files.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-slate-600">
                        {files.length} file(s) selected
                      </p>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {files.map((file, index) => (
                          <div
                            key={index}
                            className={`flex items-center justify-between p-2 rounded border ${
                              file.error
                                ? 'bg-red-50 border-red-200'
                                : file.uploading
                                ? 'bg-blue-50 border-blue-200'
                                : file.uploaded
                                ? 'bg-green-50 border-green-200'
                                : 'bg-slate-50 border-slate-200'
                            }`}
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              {file.preview ? (
                                <div className="h-10 w-10 flex-shrink-0 rounded overflow-hidden">
                                  <img
                                    src={file.preview}
                                    alt={file.name}
                                    className="h-full w-full object-cover"
                                  />
                                </div>
                              ) : (
                                <div className="h-10 w-10 flex-shrink-0 rounded bg-slate-200 flex items-center justify-center">
                                  <File className="h-5 w-5 text-slate-500" />
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-slate-900 truncate">
                                  {file.name}
                                </p>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-slate-500">
                                    {formatFileSize(file.size)}
                                  </span>
                                  {file.uploading && (
                                    <div className="flex items-center gap-1">
                                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600"></div>
                                      <span className="text-xs text-blue-600">Uploading...</span>
                                    </div>
                                  )}
                                  {file.uploaded && (
                                    <span className="text-xs text-green-600 flex items-center gap-1">
                                      <CheckCircle className="h-3 w-3" />
                                      Uploaded
                                    </span>
                                  )}
                                  {file.error && (
                                    <span className="text-xs text-red-600">{file.error}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeFile(index)}
                              className="h-8 w-8 p-0 text-slate-500 hover:text-red-600"
                              disabled={file.uploading}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {submitStatus && (
                <Alert className={submitStatus.type === 'error' ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}>
                  {submitStatus.type === 'error' ? (
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                  ) : (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  )}
                  <AlertDescription className={submitStatus.type === 'error' ? 'text-red-800' : 'text-green-800'}>
                    {submitStatus.message}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <DialogFooter className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                setOpen(false);
                // Clean up preview URLs
                files.forEach(file => {
                  if (file.preview) {
                    URL.revokeObjectURL(file.preview);
                  }
                });
                setFiles([]);
              }}
              disabled={loading || uploadingFiles}
              className="border-black text-black"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSubmitCompletion}
              disabled={loading || uploadingFiles || !message.trim()}
              className="bg-black hover:bg-zinc-900 text-white"
            >
              {(loading || uploadingFiles) ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  {uploadingFiles ? 'Uploading...' : 'Submitting...'}
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