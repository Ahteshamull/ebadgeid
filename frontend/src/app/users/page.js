'use client';

import { useEffect, useState } from "react";
import { apiFetch } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
import Image from "next/image";
// jsPDF se carga SOLO al exportar, nunca al evaluar el modulo. Su
// codigo toca DOMMatrix, una API de navegador: importado arriba se
// evalua durante el render en servidor y lanza
// "ReferenceError: DOMMatrix is not defined" como unhandledRejection,
// que puede tumbar el proceso de Next. El editor de disenos ya usaba
// este patron dinamico; estas paginas se habian quedado atras.
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { 
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  MoreVertical, 
  Trash2, 
  UserX, 
  Download, 
  Plus, 
  Users, 
  Search,
  Mail,
  Phone,
  MapPin,
  Building,
  User,
  Filter,
  CheckCircle2,
  XCircle,
  Upload,
  FileText
} from "lucide-react";

export default function UserManagementPage() {
  const { session } = useSession();
  const organizationCode = session?.organization_code;
  
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInviteUserModal, setShowInviteUserModal] = useState(false);
  const [showBulkInviteModal, setShowBulkInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDesignation, setInviteDesignation] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [feedbackDialog, setFeedbackDialog] = useState({ open: false, message: "", success: true });
  
  // Bulk invite states
  const [bulkEmails, setBulkEmails] = useState("");
  const [bulkDesignation, setBulkDesignation] = useState("");
  const [csvFile, setCsvFile] = useState(null);
  const [bulkInviteLoading, setBulkInviteLoading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0, results: [] });
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        if (!organizationCode) return;
        const res = await apiFetch(`/users/org/${organizationCode}`);
        if (!res.ok) throw new Error("Failed to fetch users");
        const data = await res.json();
        setUsers(data);
      } catch (error) {
        console.error("Error fetching users:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, [organizationCode]);

  const filteredUsers = users.filter((user) => {
    const matchesSearch = `${user.first_name} ${user.last_name} ${user.username}`
      .toLowerCase()
      .includes(search.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || user.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  useEffect(() => {
  }, []);

  const handleDelete = async (username) => {
    const target = users.find(user => user.username === username);
    if (!target?._id) return;
    const response = await apiFetch(`/users/${target._id}`, { method: 'DELETE' });
    if (!response.ok) {
      setFeedbackDialog({ open: true, success: false, message: 'Could not delete this user.' });
      return;
    }
    setUsers(current => current.filter(user => user._id !== target._id));
  };

  const toggleStatus = async (username) => {
    const target = users.find(user => user.username === username);
    if (!target?._id) return;
    const status = target.status === 'Active' ? 'Inactive' : 'Active';
    const response = await apiFetch(`/users/${target._id}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      setFeedbackDialog({ open: true, success: false, message: 'Could not change user status.' });
      return;
    }
    const updated = await response.json();
    setUsers(current => current.map(user => user._id === target._id ? updated : user));
  };

  const handleInviteUser = async () => {
    if (!inviteEmail || !inviteDesignation) {
      setFeedbackDialog({ open: true, success: false, message: "Please fill all fields." });
      return;
    }

    setInviteLoading(true);

    try {
      const response = await apiFetch("/invitation/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: inviteEmail,
          designation: inviteDesignation,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setFeedbackDialog({
          open: true,
          success: true,
          message: "Invitation sent successfully.",
        });
        setShowInviteUserModal(false);
        setInviteEmail("");
        setInviteDesignation("");
      } else if (data.message.includes("already invited")) {
        setFeedbackDialog({
          open: true,
          success: false,
          message: "Employee already invited. Wait until he/she accepts or declines invitation.",
        });
      } else {
        setFeedbackDialog({
          open: true,
          success: false,
          message: data.message || "Failed to send invitation.",
        });
      }
    } catch (error) {
      console.error("Invite error:", error);
      setFeedbackDialog({
        open: true,
        success: false,
        message: "Something went wrong. Please try again.",
      });
    } finally {
      setInviteLoading(false);
    }
  };

  // Parse CSV file
  const parseCSV = (csvText) => {
    const lines = csvText.split('\n').filter(line => line.trim());
    const emails = [];
    
    // Skip header if exists
    const startIndex = lines[0].toLowerCase().includes('email') ? 1 : 0;
    
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) {
        // Simple CSV parsing - assumes email is first column or only column
        const columns = line.split(',').map(col => col.trim().replace(/"/g, ''));
        const email = columns[0];
        if (email && email.includes('@')) {
          emails.push(email);
        }
      }
    }
    
    return emails;
  };

  // Send individual invite
  const sendSingleInvite = async (email, designation) => {
    try {
      const response = await apiFetch("/invitation/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
          designation,
        }),
      });

      const data = await response.json();
      return {
        email: email.trim(),
        success: data.success,
        message: data.message || (data.success ? "Success" : "Failed"),
      };
    } catch (error) {
      return {
        email: email.trim(),
        success: false,
        message: "Network error",
      };
    }
  };

  // Handle bulk invite
  const handleBulkInvite = async () => {
    if (!bulkDesignation.trim()) {
      setFeedbackDialog({
        open: true,
        success: false,
        message: "Please enter a designation for bulk invite.",
      });
      return;
    }

    let emailList = [];

    // Get emails from CSV file
    if (csvFile) {
      try {
        const csvText = await csvFile.text();
        emailList = parseCSV(csvText);
      } catch (error) {
        setFeedbackDialog({
          open: true,
          success: false,
          message: "Error reading CSV file.",
        });
        return;
      }
    }

    // Get emails from text input
    if (bulkEmails.trim()) {
      const textEmails = bulkEmails
        .split(',')
        .map(email => email.trim())
        .filter(email => email && email.includes('@'));
      emailList = [...emailList, ...textEmails];
    }

    // Remove duplicates
    emailList = [...new Set(emailList)];

    if (emailList.length === 0) {
      setFeedbackDialog({
        open: true,
        success: false,
        message: "Please provide at least one valid email address.",
      });
      return;
    }

    setBulkInviteLoading(true);
    setBulkProgress({ current: 0, total: emailList.length, results: [] });

    const results = [];

    // Send invites one by one
    for (let i = 0; i < emailList.length; i++) {
      const email = emailList[i];
      setBulkProgress(prev => ({ ...prev, current: i + 1 }));

      const result = await sendSingleInvite(email, bulkDesignation);
      results.push(result);

      // Add a small delay to avoid overwhelming the server
      if (i < emailList.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setBulkProgress(prev => ({ ...prev, results }));
    setBulkInviteLoading(false);

    // Show summary
    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;

    setFeedbackDialog({
      open: true,
      success: successCount > 0,
      message: `Bulk invite completed! ${successCount} successful, ${failCount} failed.`,
    });
  };

  // Reset bulk invite modal
  const resetBulkInviteModal = () => {
    setBulkEmails("");
    setBulkDesignation("");
    setCsvFile(null);
    setBulkProgress({ current: 0, total: 0, results: [] });
    setShowBulkInviteModal(false);
  };

  const exportToPDF = async () => {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const doc = new jsPDF();
    doc.text("User List", 14, 10);
    const tableColumn = [
      "Username",
      "Name",
      "Designation",
      "Organization",
      "Location",
      "Email",
      "Phone",
      "Status"
    ];

    const tableRows = filteredUsers.map(user => [
      user.username,
      `${user.first_name} ${user.last_name}`,
      user.designation,
      user.organization_code,
      `${user.city}, ${user.state}, ${user.country}`,
      user.email,
      user.phone,
      user.status
    ]);

    autoTable(doc, {
      startY: 20,
      head: [tableColumn],
      body: tableRows,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [22, 163, 74] },
    });

    doc.save("user_list.pdf");
  };

  const getInitials = (firstName, lastName) => {
    return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase();
  };

  return (
    <div className="min-h-full w-full">
      {/* Explicit width/min-width make this page respect DashboardShell's
          available content column instead of its intrinsic table width. */}
      <div className="mx-auto w-full min-w-0 max-w-7xl space-y-6 sm:space-y-8">
        {/* Header Section */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              User Management
            </h1>
            <p className="text-muted-foreground mt-2">
              Manage your organization's users and permissions
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportToPDF} className="gap-2 border-border text-foreground">
              <Download className="h-4 w-4" />
              Export PDF
            </Button>
            <Button onClick={() => setShowInviteUserModal(true)} className="gap-2 bg-blue-600 hover:bg-blue-700 text-white">
              <Plus className="h-4 w-4" />
              Invite User
            </Button>
            <Button onClick={() => setShowBulkInviteModal(true)} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
              <Users className="h-4 w-4" />
              Bulk Invite
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-card border-border shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Users</p>
                  <p className="text-2xl font-bold text-foreground">{users.length}</p>
                </div>
                <div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg">
                  <User className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Active</p>
                  <p className="text-2xl font-bold text-foreground">
                    {users.filter(u => u.status === "Active").length}
                  </p>
                </div>
                <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-lg">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Inactive</p>
                  <p className="text-2xl font-bold text-foreground">
                    {users.filter(u => u.status === "Inactive").length}
                  </p>
                </div>
                <div className="p-2 bg-rose-500/10 text-rose-500 rounded-lg">
                  <XCircle className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Filtered</p>
                  <p className="text-2xl font-bold text-foreground">{filteredUsers.length}</p>
                </div>
                <div className="p-2 bg-purple-500/10 text-purple-500 rounded-lg">
                  <Filter className="h-5 w-5" />
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
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search users by name, username, or email..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10 bg-background border-border text-foreground"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[180px] bg-background border-border text-foreground">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-foreground">
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="text-sm text-muted-foreground">
                {loading ? (
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                    Loading users...
                  </div>
                ) : (
                  `Showing ${filteredUsers.length} of ${users.length} users`
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Users Table */}
        <Card className="bg-card border-border overflow-hidden shadow-sm">
          <CardHeader className="pb-3 border-b border-border">
            <CardTitle className="text-xl flex items-center gap-2 text-foreground">
              <Users className="h-5 w-5" />
              Users
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {/* The table stays readable on compact desktops and mobile
                widths: columns do not collapse or hide behind the sidebar;
                this region alone becomes horizontally scrollable instead. */}
            <div className="w-full overflow-x-auto overscroll-x-contain">
              <Table className="min-w-[900px]">
                <TableHeader className="bg-muted/50">
                  <TableRow className="border-b border-border">
                    <TableHead className="w-16 text-muted-foreground font-medium">User</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Details</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Organization</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Contact</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Status</TableHead>
                    <TableHead className="text-muted-foreground font-medium text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user, index) => (
                    <TableRow 
                      key={index} 
                      className="border-b border-border hover:bg-muted/40 transition-colors"
                    >
                      <TableCell>
                        <Avatar className="h-10 w-10 border-2 border-border shadow-sm">
                          <AvatarImage src={user.profile_picture_url} alt={user.first_name} />
                          <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-sm">
                            {getInitials(user.first_name, user.last_name)}
                          </AvatarFallback>
                        </Avatar>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium text-foreground">
                            {user.first_name} {user.last_name}
                          </div>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <User className="h-3 w-3" />
                            {user.username}
                          </div>
                          <div className="text-sm text-muted-foreground">{user.designation}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Building className="h-3 w-3" />
                            {user.organization_code}
                          </div>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <MapPin className="h-3 w-3" />
                            {user.city}, {user.state}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-1 text-sm text-muted-foreground cursor-help">
                                  <Mail className="h-3 w-3" />
                                  <span className="truncate max-w-[160px]">{user.email}</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent className="bg-popover text-popover-foreground border-border">
                                <p>{user.email}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          {user.phone && (
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <Phone className="h-3 w-3" />
                              {user.phone}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={user.status === "Active" ? "default" : "secondary"}
                          className={
                            user.status === "Active" 
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" 
                              : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                          }
                        >
                          {user.status === "Active" ? (
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                          ) : (
                            <XCircle className="h-3 w-3 mr-1" />
                          )}
                          {user.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48 bg-card border-border text-foreground">
                              <DropdownMenuItem onClick={() => toggleStatus(user.username)}>
                                <UserX className="mr-2 h-4 w-4" />
                                {user.status === "Active" ? "Disable User" : "Enable User"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator className="bg-border" />
                              <DropdownMenuItem
                                onClick={() => handleDelete(user.username)}
                                className="text-rose-600 focus:text-rose-600"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete User
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            
            {filteredUsers.length === 0 && !loading && (
              <div className="text-center py-12">
                <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">No users found</h3>
                <p className="text-muted-foreground mb-4">
                  {search || statusFilter !== "all" 
                    ? "Try adjusting your search or filters" 
                    : "Get started by inviting your first user"
                  }
                </p>
                <Button onClick={() => setShowInviteUserModal(true)} className="bg-blue-600 hover:bg-blue-700 text-white">
                  <Plus className="mr-2 h-4 w-4" />
                  Invite User
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Single Invite Modal */}
      <Dialog open={showInviteUserModal} onOpenChange={setShowInviteUserModal}>
        <DialogContent className="sm:max-w-md bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Mail className="h-5 w-5" />
              Invite User
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Send an invitation to join your organization
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Email Address</label>
              <Input
                placeholder="Enter email address"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="bg-background border-border text-foreground"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Designation</label>
              <Input
                placeholder="Enter designation"
                value={inviteDesignation}
                onChange={(e) => setInviteDesignation(e.target.value)}
                className="bg-background border-border text-foreground"
              />
            </div>
            <Button
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              onClick={handleInviteUser}
              disabled={inviteLoading}
            >
              {inviteLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Sending Invite...
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  Send Invite
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Feedback Dialog */}
      <Dialog open={feedbackDialog.open} onOpenChange={(open) => setFeedbackDialog({ ...feedbackDialog, open })}>
        <DialogContent className="sm:max-w-md bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className={`flex items-center gap-2 ${
              feedbackDialog.success ? "text-emerald-500" : "text-rose-500"
            }`}>
              {feedbackDialog.success ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <XCircle className="h-5 w-5" />
              )}
              {feedbackDialog.success ? "Success" : "Error"}
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-foreground">{feedbackDialog.message}</div>
          
          {/* Show detailed results for bulk invite */}
          {bulkProgress.results.length > 0 && (
            <div className="mt-4">
              <div className="text-sm font-medium mb-2 text-foreground">Detailed Results:</div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {bulkProgress.results.map((result, index) => (
                  <div key={index} className="flex items-center justify-between py-1 px-2 rounded text-xs bg-muted/40">
                    <span className="truncate flex-1 mr-2 text-muted-foreground">{result.email}</span>
                    <span className={result.success ? "text-emerald-500" : "text-rose-500"}>
                      {result.success ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <Button
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => setFeedbackDialog({ ...feedbackDialog, open: false })}
          >
            Close
          </Button>
        </DialogContent>
      </Dialog>

      {/* Bulk Invite Modal */}
      <Dialog open={showBulkInviteModal} onOpenChange={resetBulkInviteModal}>
        <DialogContent className="sm:max-w-lg bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Users className="h-5 w-5" />
              Bulk Invite Users
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Invite multiple users at once using email list or CSV upload
            </DialogDescription>
          </DialogHeader>
          
          <Tabs defaultValue="emails" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-muted">
              <TabsTrigger value="emails">Email List</TabsTrigger>
              <TabsTrigger value="csv">CSV Upload</TabsTrigger>
            </TabsList>
            
            <TabsContent value="emails" className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Designation (for all invites)</label>
                <Input
                  placeholder="Enter designation"
                  value={bulkDesignation}
                  onChange={(e) => setBulkDesignation(e.target.value)}
                  className="bg-background border-border text-foreground"
                />
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Email Addresses</label>
                <textarea
                  placeholder="example1@mail.com, example2@mail.com"
                  className="w-full border border-border rounded-md p-3 text-sm bg-background text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  rows={6}
                  value={bulkEmails}
                  onChange={(e) => setBulkEmails(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Enter email addresses separated by commas
                </p>
              </div>
            </TabsContent>
            
            <TabsContent value="csv" className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Designation (for all invites)</label>
                <Input
                  placeholder="Enter designation"
                  value={bulkDesignation}
                  onChange={(e) => setBulkDesignation(e.target.value)}
                  className="bg-background border-border text-foreground"
                />
              </div>
              
              <div className="space-y-3">
                <label className="text-sm font-medium text-foreground">Upload CSV File</label>
                <div className="border-2 border-dashed border-border rounded-lg p-6 text-center bg-muted/30">
                  <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-foreground mb-2">
                    Drag and drop your CSV file here, or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground mb-4">
                    CSV should contain email addresses in the first column
                  </p>
                  <Input 
                    type="file" 
                    accept=".csv" 
                    className="hidden" 
                    id="csv-upload"
                    onChange={(e) => setCsvFile(e.target.files[0])}
                  />
                  <Button 
                    variant="outline" 
                    className="gap-2 border-border text-foreground"
                    onClick={() => document.getElementById('csv-upload').click()}
                  >
                    <FileText className="h-4 w-4" />
                    Choose File
                  </Button>
                  {csvFile && (
                    <p className="text-sm text-emerald-500 mt-2">
                      Selected: {csvFile.name}
                    </p>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {/* Progress indicator */}
          {bulkInviteLoading && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Sending invites...</span>
                <span>{bulkProgress.current} of {bulkProgress.total}</span>
              </div>
              <Progress value={(bulkProgress.current / bulkProgress.total) * 100} className="h-2" />
            </div>
          )}
          
          <Button 
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" 
            onClick={handleBulkInvite}
            disabled={bulkInviteLoading}
          >
            {bulkInviteLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Sending Invites...
              </>
            ) : (
              <>
                <Users className="mr-2 h-4 w-4" />
                Send Bulk Invites
              </>
            )}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
