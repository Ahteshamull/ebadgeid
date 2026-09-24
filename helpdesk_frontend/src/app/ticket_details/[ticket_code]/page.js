"use client"
import React, { useState, useEffect, useRef } from 'react';
import { FTP_BASE_URL } from '@/lib/config';
import { apiFetch } from '@/lib/api';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { 
  Badge 
} from '@/components/ui/badge';
import { 
  Button 
} from '@/components/ui/button';
import { 
  Input 
} from '@/components/ui/input';
import { 
  Textarea 
} from '@/components/ui/textarea';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Avatar, 
  AvatarFallback, 
  AvatarImage 
} from '@/components/ui/avatar';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { 
  Separator 
} from '@/components/ui/separator';
import { 
  ScrollArea 
} from '@/components/ui/scroll-area';
import {
  Send,
  Paperclip,
  Clock,
  User,
  Users,
  AlertCircle,
  CheckCircle2,
  Circle,
  Pause,
  X,
  Edit3,
  Plus,
  Mail,
  FileText,
  PlayCircle,
  XCircle,
  Star,
  Bell,
  Share2,
  MoreHorizontal,
  MessageSquare,
  Crown,
  Shield,
  Download,
  Activity,
  Calendar,
  Tag,
  Archive,
  Trash2
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { useLocalization } from '@/context/LocalizationContext';
import { helpdeskTranslations } from '@/locales';

const TicketDetailScreen = () => {
    const { language, changeLanguage } = useLocalization();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [assigneeEmail, setAssigneeEmail] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [showEditTicket, setShowEditTicket] = useState(false);
  const [editForm, setEditForm] = useState({ ticket_title: '', department: '', ticket_description: '', priority: 'low' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const params = useParams();
  const t = helpdeskTranslations[language] || helpdeskTranslations.en;
  const ticketCode = params.ticket_code;
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [ticket?.messages]);

  useEffect(() => {
    fetchTicket();
  }, []);

  const fetchTicket = async () => {
    try {
      setLoading(true);
      const response = await apiFetch(`/tickets/${encodeURIComponent(ticketCode)}`);

      if (!response.ok) {
        throw new Error('Failed to fetch ticket');
      }

      const data = await response.json();
      setTicket(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() && selectedFiles.length === 0) return;

    try {
      setSendingMessage(true);
      let attachmentUrls = [];

      // Upload files if selected
      if (selectedFiles.length > 0) {
        attachmentUrls = await uploadFiles(selectedFiles);
      }

      const messageData = {
        message_content: newMessage || t.ticket_file_attachments
      };

      if (attachmentUrls.length > 0) {
        messageData.attachment = attachmentUrls;
      }

      const response = await apiFetch(`/tickets/${encodeURIComponent(ticketCode)}/messages`, {
        method: 'POST',
        body: JSON.stringify(messageData)
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const updatedTicket = await response.json();
      setTicket(updatedTicket);
      setNewMessage('');
      setSelectedFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingMessage(false);
    }
  };

  const uploadFiles = async (files) => {
    try {
      setUploadingFiles(true);
      const uploadPromises = files.map(async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        // Ticket attachments can carry customer PII/screenshots -- keep
        // them tenant-scoped, not defaulted to public.
        formData.append('visibility', 'private');

        const response = await fetch(`${FTP_BASE_URL}/api/uploads`, {
          method: 'POST',
          credentials: 'include',
          body: formData
        });

        if (!response.ok) {
          throw new Error(`Failed to upload ${file.name}`);
        }

        const result = await response.json();
        return result.url; // Assuming the server returns { url: "file_url" }
      });

      const urls = await Promise.all(uploadPromises);
      return urls;
    } catch (err) {
      throw new Error(`File upload failed: ${err.message}`);
    } finally {
      setUploadingFiles(false);
    }
  };

  const handleFilesSelect = (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    // Check each file size (e.g., 10MB limit)
    const validFiles = files.filter(file => {
      if (file.size > 10 * 1024 * 1024) {
        setError(t.ticket_file_too_large.replace('{name}', file.name).replace('{size}', '10MB'));
        return false;
      }
      return true;
    });

    // Check total number of files (limit to 5 files per message)
    const totalFiles = selectedFiles.length + validFiles.length;
    if (totalFiles > 5) {
      setError(t.ticket_max_files);
      return;
    }

    setSelectedFiles(prev => [...prev, ...validFiles]);
  };

  const removeSelectedFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const clearAllFiles = () => {
    setSelectedFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const getFileIcon = (filename) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'pdf':
        return '📄';
      case 'doc':
      case 'docx':
        return '📝';
      case 'xls':
      case 'xlsx':
        return '📊';
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
        return '🖼️';
      case 'zip':
      case 'rar':
        return '📦';
      default:
        return '📎';
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleStatusChange = async (newStatus) => {
    try {
      setUpdatingStatus(true);
      const response = await apiFetch(`/tickets/${encodeURIComponent(ticketCode)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      });

      if (!response.ok) {
        const errorData = await response.json();
        
        // Check for specific "Access denied for OTP users" message
        if (errorData.message === "Access denied for OTP users") {
          throw new Error(t.ticket_status_change_denied);
        }
        
        throw new Error(errorData.message || 'Failed to update status');
      }

      const updatedTicket = await response.json();
      setTicket(updatedTicket);
      setError(null); // Clear any previous errors on success
    } catch (err) {
      setError(err.message);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleAddMember = async () => {
    if (!newMemberEmail.trim()) return;

    try {
      setAddingMember(true);
      const response = await apiFetch(`/tickets/${encodeURIComponent(ticketCode)}/add-member`, {
        method: 'POST',
        body: JSON.stringify({ email: newMemberEmail })
      });

      if (!response.ok) {
        throw new Error('Failed to add member');
      }

      const updatedTicket = await response.json();
      setTicket(updatedTicket.ticket);
      setNewMemberEmail('');
      setShowAddMember(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setAddingMember(false);
    }
  };

  const handleAssign = async (email) => {
    try {
      setAssigning(true);
      const response = await apiFetch(`/tickets/${encodeURIComponent(ticketCode)}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ email })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to assign ticket');
      }

      const updatedTicket = await response.json();
      setTicket(updatedTicket);
      setAssigneeEmail('');
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setAssigning(false);
    }
  };

  const openEditTicket = () => {
    setEditForm({
      ticket_title: ticket.ticket_title || '',
      department: ticket.department || '',
      ticket_description: ticket.ticket_description || '',
      priority: ticket.priority || 'low',
    });
    setShowEditTicket(true);
  };

  const handleSaveEdit = async () => {
    if (!editForm.ticket_title.trim() || !editForm.ticket_description.trim()) return;

    try {
      setSavingEdit(true);
      const response = await apiFetch(`/tickets/${encodeURIComponent(ticketCode)}`, {
        method: 'PUT',
        body: JSON.stringify(editForm)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update ticket');
      }

      const updatedTicket = await response.json();
      setTicket(updatedTicket);
      setShowEditTicket(false);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const getUserTypeColor = (userType) => {
    const colors = {
      'admin': 'bg-purple-100 text-purple-800',
      'developer': 'bg-blue-100 text-blue-800',
      'user': 'bg-green-100 text-green-800'
    };
    return colors[userType] || colors.user;
  };

  const getStatusColor = (status) => {
    const colors = {
      'open': 'bg-blue-50 text-blue-700 border-blue-200',
      'in-progress': 'bg-orange-50 text-orange-700 border-orange-200',
      'resolved': 'bg-green-50 text-green-700 border-green-200',
      'closed': 'bg-gray-50 text-gray-700 border-gray-200'
    };
    return colors[status] || colors.open;
  };

  const getPriorityColor = (priority) => {
    const colors = {
      'low': 'bg-green-50 text-green-700 border-green-200',
      'medium': 'bg-yellow-50 text-yellow-700 border-yellow-200',
      'high': 'bg-red-50 text-red-700 border-red-200',
      'urgent': 'bg-purple-50 text-purple-700 border-purple-200'
    };
    return colors[priority] || colors.medium;
  };

  const getStatusIcon = (status) => {
    const icons = {
      'open': <Circle className="w-4 h-4" />,
      'in-progress': <PlayCircle className="w-4 h-4" />,
      'resolved': <CheckCircle2 className="w-4 h-4" />,
      'closed': <XCircle className="w-4 h-4" />
    };
    return icons[status] || icons.open;
  };

  const getUserInitials = (name) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const getUserTypeIcon = (userType) => {
    const icons = {
      'admin': <Crown className="w-3 h-3" />,
      'developer': <Shield className="w-3 h-3" />,
      'user': <User className="w-3 h-3" />
    };
    return icons[userType] || icons.user;
  };

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error && !ticket) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{t.ticket_error_title}</h2>
          <p className="text-gray-600">{error}</p>
          <Button onClick={() => {
            setError(null);
            fetchTicket();
          }} className="mt-4">
            {t.ticket_try_again}
          </Button>
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{t.ticket_not_found}</h2>
          <p className="text-gray-600">{t.ticket_not_exist}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      {/* Error Banner */}
      {error && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-50 border border-red-200 rounded-lg px-4 py-3 shadow-lg max-w-md w-full mx-4">
          <div className="flex items-center">
            <AlertCircle className="w-5 h-5 text-red-500 mr-3 flex-shrink-0" />
            <p className="text-sm text-red-800 flex-1">{error}</p>
            <button
              onClick={() => setError(null)}
              className="ml-2 text-red-500 hover:text-red-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Header with Glassmorphism Effect */}
      <div className="sticky top-0 z-40 backdrop-blur-lg bg-white/80 border-b border-white/20 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
                  {ticket.ticket_title}
                </h1>
                <div className="flex items-center space-x-2 mt-1">
                  <span className="text-sm text-gray-500">#{ticket.ticket_code}</span>
                  <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                  <span className="text-sm text-gray-500">{ticket.department}</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              <div className={`px-4 py-2 rounded-full border ${getStatusColor(ticket.status)} font-medium text-sm flex items-center space-x-2 shadow-sm`}>
                {getStatusIcon(ticket.status)}
                <span className="capitalize">{t[`status_${ticket.status.replace('-', '_')}`]}</span>
              </div>
              <div className={`px-4 py-2 rounded-full border ${getPriorityColor(ticket.priority)} font-medium text-sm flex items-center space-x-2 shadow-sm`}>
                <AlertCircle className="w-4 h-4" />
                <span className="capitalize">{t.priorityOptions[ticket.priority]}</span>
              </div>
              <div className="flex items-center space-x-1">
                <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                  <Star className="w-5 h-5 text-gray-400" />
                </button>
                <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                  <Bell className="w-5 h-5 text-gray-400" />
                </button>
                <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                  <Share2 className="w-5 h-5 text-gray-400" />
                </button>
                <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                  <MoreHorizontal className="w-5 h-5 text-gray-400" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="xl:col-span-2 space-y-6">
            {/* Ticket Description Card */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
              <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                  <Edit3 className="w-5 h-5 mr-3 text-blue-600" />
                  {t.ticket_description}
                </h2>
                <button
                  onClick={openEditTicket}
                  className="px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <Edit3 className="w-4 h-4" /> {t.ticket_edit_button}
                </button>
              </div>
              <div className="p-6">
                <p className="text-gray-700 leading-relaxed text-base">
                  {ticket.ticket_description}
                </p>
                <div className="mt-4 flex items-center text-sm text-gray-500">
                  <Clock className="w-4 h-4 mr-2" />
                  {t.ticket_last_updated} {formatTime(ticket.last_activity)}
                </div>
              </div>
            </div>

            {/* Messages Card */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
              <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-green-50 to-emerald-50">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                  <MessageSquare className="w-5 h-5 mr-3 text-green-600" />
                  {`${t.ticket_conversation} (${ticket.messages.length})`}
                </h2>
              </div>
              <div className="p-6">
                <div className="space-y-6 max-h-96 overflow-y-auto">
                  {ticket.messages.map((message, index) => (
                    <div key={index} className="flex space-x-4 group">
                      <div className="flex-shrink-0">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${getUserTypeColor(message.user_type)}`}>
                          {getUserInitials(message.username)}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2 mb-2">
                          <span className="font-medium text-gray-900">{message.username}</span>
                          <div className={`px-2 py-1 rounded-full text-xs font-medium ${getUserTypeColor(message.user_type)} flex items-center space-x-1`}>
                            {getUserTypeIcon(message.user_type)}
                            <span>{message.user_type}</span>
                          </div>
                          <span className="text-xs text-gray-500">{formatTime(message.createdAt)}</span>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                          <p className="text-gray-700">{message.message_content}</p>
                          {message.attachment && message.attachment.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {message.attachment.map((file, attachIndex) => (
                                <div key={attachIndex} className="inline-flex items-center px-3 py-2 bg-white rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors cursor-pointer">
                                  <span className="mr-2">{getFileIcon(file)}</span>
                                  <span className="text-sm text-gray-700">{file}</span>
                                  <Download className="w-4 h-4 ml-2 text-gray-400" />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Message Input */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
              <div className="p-6">
                {/* Selected Files Preview */}
                {selectedFiles.length > 0 && (
                  <div className="mb-4 p-4 bg-blue-50 rounded-xl border border-blue-200">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-blue-900">
                        {`${t.ticket_selected_files} (${selectedFiles.length}/5)`}
                      </span>
                      <button
                        onClick={clearAllFiles}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                      >
                        {t.ticket_clear_all}
                      </button>
                    </div>
                    <div className="space-y-2">
                      {selectedFiles.map((file, index) => (
                        <div key={index} className="flex items-center justify-between p-3 bg-white rounded-lg border border-blue-200">
                          <div className="flex items-center space-x-3">
                            <span className="text-lg">{getFileIcon(file.name)}</span>
                            <div>
                              <p className="text-sm font-medium text-gray-900">{file.name}</p>
                              <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => removeSelectedFile(index)}
                            className="p-1 hover:bg-red-50 rounded-full transition-colors"
                          >
                            <X className="w-4 h-4 text-red-500" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Message Input */}
                <div className="flex space-x-4">
                  <div className="flex-1">
                    <textarea
                      placeholder={t.ticket_message_placeholder}
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      className="w-full min-h-[100px] p-4 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                    />
                  </div>
                  <div className="flex flex-col space-y-2">
                    <div className="relative">
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        onChange={handleFilesSelect}
                        className="hidden"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.zip,.rar,.txt"
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingFiles || selectedFiles.length >= 5}
                        className="relative p-3 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors disabled:opacity-50"
                      >
                        <Paperclip className="w-5 h-5 text-gray-600" />
                        {selectedFiles.length > 0 && (
                          <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                            {selectedFiles.length}
                          </span>
                        )}
                      </button>
                    </div>
                    <button
                      onClick={handleSendMessage}
                      disabled={sendingMessage || uploadingFiles || (!newMessage.trim() && selectedFiles.length === 0)}
                      className="p-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-xl transition-all disabled:opacity-50 shadow-lg"
                    >
                      {sendingMessage ? (
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                      ) : (
                        <Send className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Status Management */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
              <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-purple-50 to-pink-50">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                  <Activity className="w-5 h-5 mr-3 text-purple-600" />
                  {t.ticket_status}
                </h2>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    {t.ticket_current_status}
                  </label>
                  <select
                    value={ticket.status}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    disabled={updatingStatus}
                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="open">{t.status_open}</option>
                    <option value="in-progress">{t.status_in_progress}</option>
                    <option value="resolved">{t.status_resolved}</option>
                    <option value="closed">{t.status_closed}</option>
                  </select>
                  {updatingStatus && (
                    <p className="text-xs text-gray-500 mt-2 flex items-center">
                      <div className="animate-spin rounded-full h-3 w-3 border-b border-blue-600 mr-2"></div>
                      {t.ticket_updating_status}
                    </p>
                  )}
                </div>
                
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    {t.ticket_priority_level}
                  </label>
                  <div className={`px-4 py-3 rounded-xl border ${getPriorityColor(ticket.priority)} font-medium text-sm flex items-center justify-center space-x-2`}>
                    <AlertCircle className="w-4 h-4" />
                    <span className="capitalize">{t.priorityOptions[ticket.priority]}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Assigned Agent (1:1 assignment, distinct from Team Members below) */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
              <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-blue-50">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                  <Shield className="w-5 h-5 mr-3 text-indigo-600" />
                  {t.ticket_assigned_agent}
                </h2>
              </div>
              <div className="p-6 space-y-4">
                {ticket.assigned_to ? (
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                    <div className="flex items-center space-x-3 min-w-0">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium bg-indigo-100 text-indigo-800 flex-shrink-0">
                        {getUserInitials(ticket.assigned_to)}
                      </div>
                      <p className="text-sm font-medium text-gray-900 truncate">{ticket.assigned_to}</p>
                    </div>
                    <button
                      onClick={() => handleAssign('')}
                      disabled={assigning}
                      className="px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
                    >
                      {assigning ? t.ticket_assigning : t.ticket_unassign_button}
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">{t.ticket_unassigned}</p>
                )}
                <div className="flex space-x-2">
                  <input
                    type="email"
                    placeholder={t.ticket_assign_placeholder}
                    value={assigneeEmail}
                    onChange={(e) => setAssigneeEmail(e.target.value)}
                    className="flex-1 p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  />
                  <button
                    onClick={() => handleAssign(assigneeEmail)}
                    disabled={assigning || !assigneeEmail.trim()}
                    className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 rounded-xl transition-all disabled:opacity-50 flex-shrink-0"
                  >
                    {assigning ? t.ticket_assigning : t.ticket_assign_button}
                  </button>
                </div>
              </div>
            </div>

            {/* Team Members */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
              <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-orange-50 to-red-50">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                    <Users className="w-5 h-5 mr-3 text-orange-600" />
                    {`${t.ticket_team} (${ticket.ticket_members.length})`}
                  </h2>
                  <button
                    onClick={() => setShowAddMember(true)}
                    className="p-2 bg-orange-100 hover:bg-orange-200 rounded-lg transition-colors"
                  >
                    <Plus className="w-4 h-4 text-orange-600" />
                  </button>
                </div>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  {ticket.ticket_members.map((member, index) => (
                    <div key={index} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-xl">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${getUserTypeColor(member.user_type)}`}>
                        {getUserInitials(member.usernameOrEmail)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {member.usernameOrEmail}
                        </p>
                        <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getUserTypeColor(member.user_type)} mt-1`}>
                          {getUserTypeIcon(member.user_type)}
                          <span className="ml-1">{member.user_type}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Ticket Information */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
              <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-slate-50">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                  <Calendar className="w-5 h-5 mr-3 text-gray-600" />
                  {t.ticket_information}
                </h2>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">{t.ticket_created}</span>
                    <span className="text-sm text-gray-900 font-medium">{formatTime(ticket.createdAt)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">{t.ticket_updated}</span>
                    <span className="text-sm text-gray-900 font-medium">{formatTime(ticket.updatedAt)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">{t.ticket_messages}</span>
                    <span className="text-sm text-gray-900 font-medium">{ticket.messages.length}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">{t.ticket_department}</span>
                    <span className="text-sm text-gray-900 font-medium">{ticket.department}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Ticket Dialog */}
      {showEditTicket && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-md">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">{t.ticket_edit_title}</h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">{t.ticket_edit_title_field}</label>
                <input
                  type="text"
                  value={editForm.ticket_title}
                  onChange={(e) => setEditForm(f => ({ ...f, ticket_title: e.target.value }))}
                  className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">{t.ticket_department}</label>
                <input
                  type="text"
                  value={editForm.department}
                  onChange={(e) => setEditForm(f => ({ ...f, department: e.target.value }))}
                  className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">{t.ticket_description}</label>
                <textarea
                  value={editForm.ticket_description}
                  onChange={(e) => setEditForm(f => ({ ...f, ticket_description: e.target.value }))}
                  className="w-full min-h-[100px] p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">{t.ticket_priority_level}</label>
                <select
                  value={editForm.priority}
                  onChange={(e) => setEditForm(f => ({ ...f, priority: e.target.value }))}
                  className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="low">{t.priorityOptions.low}</option>
                  <option value="medium">{t.priorityOptions.medium}</option>
                  <option value="high">{t.priorityOptions.high}</option>
                  <option value="urgent">{t.priorityOptions.urgent}</option>
                  <option value="critical">{t.priorityOptions.critical}</option>
                </select>
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 flex justify-end space-x-3">
              <button
                onClick={() => setShowEditTicket(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
              >
                {t.ticket_cancel}
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={savingEdit || !editForm.ticket_title.trim() || !editForm.ticket_description.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 rounded-lg transition-all disabled:opacity-50"
              >
                {savingEdit ? t.ticket_saving : t.ticket_save_button}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Member Dialog */}
      {showAddMember && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-md">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">{t.ticket_add_member}</h3>
              <p className="text-sm text-gray-600 mt-1">{t.ticket_add_member_desc}</p>
            </div>
            <div className="p-6">
              <input
                type="email"
                placeholder={t.ticket_enter_email}
                value={newMemberEmail}
                onChange={(e) => setNewMemberEmail(e.target.value)}
                className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="p-6 border-t border-gray-100 flex justify-end space-x-3">
              <button
                onClick={() => setShowAddMember(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
              >
                {t.ticket_cancel}
              </button>
              <button
                onClick={handleAddMember}
                disabled={addingMember || !newMemberEmail.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 rounded-lg transition-all disabled:opacity-50"
              >
                {addingMember ? t.ticket_adding : t.ticket_add_member_button}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TicketDetailScreen; 
