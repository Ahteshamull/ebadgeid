'use client';

import { useEffect, useState } from "react";
import Image from "next/image";
// jsPDF se carga SOLO al exportar, nunca al evaluar el modulo. Su
// codigo toca DOMMatrix, una API de navegador: importado arriba se
// evalua durante el render en servidor y lanza
// "ReferenceError: DOMMatrix is not defined" como unhandledRejection,
// que puede tumbar el proceso de Next. El editor de disenos ya usaba
// este patron dinamico; estas paginas se habian quedado atras.
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
import { checkAuth } from '../../lib/authChecker.js';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
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
  FileText,
  FileSpreadsheet
} from "lucide-react";
import { useLocale } from "@/context/Localecontext.js";

export default function UserManagementPage() {

  const { t } = useLocale();
  const { session } = useSession();
  const orgCode = session?.organization_code;
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInviteUserModal, setShowInviteUserModal] = useState(false);
  const [showBulkInviteModal, setShowBulkInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDesignation, setInviteDesignation] = useState("");
  const [inviteIsAdmin, setInviteIsAdmin] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [feedbackDialog, setFeedbackDialog] = useState({ open: false, message: "", success: true });

  // Bulk invite states
  const [bulkEmails, setBulkEmails] = useState("");
  const [bulkDesignation, setBulkDesignation] = useState("");
  const [bulkIsAdmin, setBulkIsAdmin] = useState(false);
  const [csvFile, setCsvFile] = useState(null);
  const [bulkInviteLoading, setBulkInviteLoading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0, results: [] });
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    if (!session) return;
    const fetchUsers = async () => {
      try {
        const res = await apiFetch(`/users/org/${orgCode}`);
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
  }, [session, orgCode]);

  const generateSixDigitCode = () => Math.floor(100000 + Math.random() * 900000).toString();

  const filteredUsers = users.filter((user) => {
    const matchesSearch = `${user.first_name} ${user.last_name} ${user.username}`
      .toLowerCase()
      .includes(search.toLowerCase());

    const matchesStatus = statusFilter === "all" || user.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  useEffect(() => {
    checkAuth('admin');
  }, []);

  const handleDelete = (username) => {
    setUsers(users.filter((user) => user.username !== username));
  };

  const toggleStatus = (username) => {
    setUsers(users.map((user) =>
      user.username === username
        ? { ...user, status: user.status === "Active" ? "Inactive" : "Active" }
        : user
    ));
  };

  const handleInviteUser = async () => {
    const org_code = orgCode;
    const six_digit_code = generateSixDigitCode();

    if (!inviteEmail || !inviteDesignation) {
      setFeedbackDialog({ open: true, success: false, message: "Please fill all fields." });
      return;
    }

    setInviteLoading(true);

    try {
      const response = await apiFetch("/invitation/generate", {
        method: "POST",
        body: JSON.stringify({
          email: inviteEmail,
          org_code,
          six_digit_code,
          designation: inviteDesignation,
          is_admin: inviteIsAdmin,
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
        setInviteIsAdmin(false);
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
  const sendSingleInvite = async (email, designation, isAdmin = false) => {
    const org_code = orgCode;
    const six_digit_code = generateSixDigitCode();

    try {
      const response = await apiFetch("/invitation/generate", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          org_code,
          six_digit_code,
          designation,
          is_admin: isAdmin,
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

      const result = await sendSingleInvite(email, bulkDesignation, bulkIsAdmin);
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
    setBulkIsAdmin(false);
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

  const exportToExcel = () => {
    const data = filteredUsers.map(user => ({
      "Username": user.username,
      "Name": `${user.first_name} ${user.last_name}`,
      "Designation": user.designation,
      "Organization": user.organization_code,
      "Location": `${user.city}, ${user.state}, ${user.country}`,
      "Email": user.email,
      "Phone": user.phone,
      "Status": user.status,
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);

    // Auto-size columns based on content
    const colWidths = Object.keys(data[0] || {}).map(key => {
      const maxLen = Math.max(
        key.length,
        ...data.map(row => (row[key] ? String(row[key]).length : 0))
      );
      return { wch: Math.min(maxLen + 2, 40) };
    });
    worksheet['!cols'] = colWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Users");

    const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob([excelBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    saveAs(blob, "user_list.xlsx");
  };

  const getInitials = (firstName, lastName) => {
    return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase();
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header Section */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
              {t('user_management')}
            </h1>
            <p className="text-slate-600 mt-2">
              {t('manage_users_description')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportToPDF} className="gap-2">
              <Download className="h-4 w-4" />
              {t('export_pdf')}
            </Button>
            <Button variant="outline" onClick={exportToExcel} className="gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              {t('export_excel')}
            </Button>
            <Button onClick={() => setShowInviteUserModal(true)} className="gap-2 bg-blue-600 hover:bg-blue-700">
              <Plus className="h-4 w-4" />
              {t('invite_user')}
            </Button>
            <Button onClick={() => setShowBulkInviteModal(true)} className="gap-2 bg-green-600 hover:bg-green-700">
              <Users className="h-4 w-4" />
              {t('bulk_invite')}
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-white/50 backdrop-blur-sm border-slate-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">{t('total_users')}</p>
                  <p className="text-2xl font-bold text-slate-900">{users.length}</p>
                </div>
                <div className="p-2 bg-blue-100 rounded-lg">
                  <User className="h-5 w-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white/50 backdrop-blur-sm border-slate-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">{t('active')}</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {users.filter(u => u.status === "Active").length}
                  </p>
                </div>
                <div className="p-2 bg-green-100 rounded-lg">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white/50 backdrop-blur-sm border-slate-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">{t('inactive')}</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {users.filter(u => u.status === "Inactive").length}
                  </p>
                </div>
                <div className="p-2 bg-red-100 rounded-lg">
                  <XCircle className="h-5 w-5 text-red-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white/50 backdrop-blur-sm border-slate-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">{t('filtered')}</p>
                  <p className="text-2xl font-bold text-slate-900">{filteredUsers.length}</p>
                </div>
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Filter className="h-5 w-5 text-purple-600" />
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
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder={t('search_users_by_name_username_or_email')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10 bg-white/50 border-slate-200"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[180px] bg-white/50 border-slate-200">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('all_status')}</SelectItem>
                    <SelectItem value="Active">{t('active')}</SelectItem>
                    <SelectItem value="Inactive">{t('inactive')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="text-sm text-slate-500">
                {loading ? (
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                    {t('loading_users')}
                  </div>
                ) : (
                  `${t('showing')} ${filteredUsers.length} ${t('of')} ${users.length} ${t('users')}`
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Users Table */}
        <Card className="bg-white/80 backdrop-blur-sm border-slate-200 overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-xl flex items-center gap-2">
              <Users className="h-5 w-5" />
              {t('users')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50/80">
                  <TableRow className="border-b border-slate-200">
                    <TableHead className="w-16 text-slate-600 font-medium">{t('user')}</TableHead>
                    <TableHead className="text-slate-600 font-medium">{t('details')}</TableHead>
                    <TableHead className="text-slate-600 font-medium">{t('organization')}</TableHead>
                    <TableHead className="text-slate-600 font-medium">{t('contact')}</TableHead>
                    <TableHead className="text-slate-600 font-medium">{t('status')}</TableHead>
                    <TableHead className="text-slate-600 font-medium text-right">{t('actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user, index) => (
                    <TableRow
                      key={index}
                      className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors"
                    >
                      <TableCell>
                        <Avatar className="h-10 w-10 border-2 border-white shadow-sm">
                          <AvatarImage src={user.profile_picture_url} alt={user.first_name} />
                          <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-sm">
                            {getInitials(user.first_name, user.last_name)}
                          </AvatarFallback>
                        </Avatar>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium text-slate-900">
                            {user.first_name} {user.last_name}
                          </div>
                          <div className="flex items-center gap-1 text-sm text-slate-500">
                            <User className="h-3 w-3" />
                            {user.username}
                          </div>
                          <div className="text-sm text-slate-600">{user.designation}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 text-sm text-slate-600">
                            <Building className="h-3 w-3" />
                            {user.organization_code}
                          </div>
                          <div className="flex items-center gap-1 text-sm text-slate-500">
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
                                <div className="flex items-center gap-1 text-sm text-slate-600 cursor-help">
                                  <Mail className="h-3 w-3" />
                                  <span className="truncate max-w-[160px]">{user.email}</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{user.email}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          {user.phone && (
                            <div className="flex items-center gap-1 text-sm text-slate-500">
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
                              ? "bg-green-100 text-green-800 hover:bg-green-100 border-green-200"
                              : "bg-red-100 text-red-800 hover:bg-red-100 border-red-200"
                          }
                        >
                          {t(user.status.toLowerCase())}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem onClick={() => toggleStatus(user.username)}>
                                <UserX className="mr-2 h-4 w-4" />
                                {user.status === "Active" ? "Disable User" : "Enable User"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleDelete(user.username)}
                                className="text-red-600 focus:text-red-600"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                {t('delete_user')}
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
                <Users className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-900 mb-2">{t('no_users_found')}</h3>
                <p className="text-slate-500 mb-4">
                  {search || statusFilter !== "all"
                    ? t('try_adjusting_your_search_or_filters')
                    : t('get_started_by_inviting_your_first_user')
                  }
                </p>
                <Button onClick={() => setShowInviteUserModal(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t('invite_user')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Single Invite Modal */}
      <Dialog open={showInviteUserModal} onOpenChange={setShowInviteUserModal}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              {t('invite_user')}
            </DialogTitle>
            <DialogDescription>
              {t('send_an_invitation_to_join_your_organization')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('email_address')}</label>
              <Input
                placeholder={t('enter_email_address')}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="bg-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('designation')}</label>
              <Input
                placeholder={t('enter_designation')}
                value={inviteDesignation}
                onChange={(e) => setInviteDesignation(e.target.value)}
                className="bg-white"
              />
            </div>
            <div className="flex items-center space-x-2 py-2">
              <Checkbox
                id="is-admin"
                checked={inviteIsAdmin}
                onCheckedChange={setInviteIsAdmin}
              />
              <label
                htmlFor="is-admin"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                {t('is_admin')}
              </label>
            </div>
            <Button
              className="w-full bg-blue-600 hover:bg-blue-700"
              onClick={handleInviteUser}
              disabled={inviteLoading}
            >
              {inviteLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  {t('sending_invite')}
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  {t('send_invite')}
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Feedback Dialog */}
      <Dialog open={feedbackDialog.open} onOpenChange={(open) => setFeedbackDialog({ ...feedbackDialog, open })}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle className={`flex items-center gap-2 ${feedbackDialog.success ? "text-green-600" : "text-red-600"
              }`}>
              {feedbackDialog.success ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <XCircle className="h-5 w-5" />
              )}
              {feedbackDialog.success ? "Success" : "Error"}
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-slate-700">{feedbackDialog.message}</div>

          {/* Show detailed results for bulk invite */}
          {bulkProgress.results.length > 0 && (
            <div className="mt-4">
              <div className="text-sm font-medium mb-2 text-slate-900">{t('detailed_result')}:</div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {bulkProgress.results.map((result, index) => (
                  <div key={index} className="flex items-center justify-between py-1 px-2 rounded text-xs">
                    <span className="truncate flex-1 mr-2 text-slate-600">{result.email}</span>
                    <span className={result.success ? "text-green-600" : "text-red-600"}>
                      {result.success ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button
            className="w-full bg-slate-900 hover:bg-slate-800"
            onClick={() => setFeedbackDialog({ ...feedbackDialog, open: false })}
          >
            {t('close_btn')}
          </Button>
        </DialogContent>
      </Dialog>

      {/* Bulk Invite Modal */}
      <Dialog open={showBulkInviteModal} onOpenChange={resetBulkInviteModal}>
        <DialogContent className="sm:max-w-lg bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {t('bulk_invite')}
            </DialogTitle>
            <DialogDescription>
              {t('bulk_invite_description')}
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="emails" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="emails">{t('email_list')}</TabsTrigger>
              <TabsTrigger value="csv">{t('csv_file')}</TabsTrigger>
            </TabsList>

            <TabsContent value="emails" className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('designation')}</label>
                <Input
                  placeholder={t('enter_designation')}
                  value={bulkDesignation}
                  onChange={(e) => setBulkDesignation(e.target.value)}
                  className="bg-white"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t('email_addresses')}</label>
                <textarea
                  placeholder="example1@mail.com, example2@mail.com"
                  className="w-full border border-slate-200 rounded-md p-3 text-sm bg-white resize-none"
                  rows={6}
                  value={bulkEmails}
                  onChange={(e) => setBulkEmails(e.target.value)}
                />
                <p className="text-xs text-slate-500">
                  {t('enter_email_addresses_separated_by_commas')}
                </p>
              </div>

              <div className="flex items-center space-x-2 py-2">
                <Checkbox
                  id="bulk-is-admin-emails"
                  checked={bulkIsAdmin}
                  onCheckedChange={setBulkIsAdmin}
                />
                <label
                  htmlFor="bulk-is-admin-emails"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  {t('is_admin')}
                </label>
              </div>
            </TabsContent>

            <TabsContent value="csv" className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('designation')}</label>
                <Input
                  placeholder={t('enter_designation')}
                  value={bulkDesignation}
                  onChange={(e) => setBulkDesignation(e.target.value)}
                  className="bg-white"
                />
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium">{t('upload_csv')}</label>
                <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center bg-slate-50/50">
                  <Upload className="h-8 w-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm text-slate-600 mb-2">
                    {t('drag_and_drop_your_csv_file_here_or_click_to_browse')}
                  </p>
                  <p className="text-xs text-slate-500 mb-4">
                    {t('csv_should_contain_email_addresses_in_the_first_column')}
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
                    className="gap-2"
                    onClick={() => document.getElementById('csv-upload').click()}
                  >
                    <FileText className="h-4 w-4" />
                    {t('choose_file')}
                  </Button>
                  {csvFile && (
                    <p className="text-sm text-green-600 mt-2">
                      {t('selected')}: {csvFile.name}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-2 py-2">
                <Checkbox
                  id="bulk-is-admin-csv"
                  checked={bulkIsAdmin}
                  onCheckedChange={setBulkIsAdmin}
                />
                <label
                  htmlFor="bulk-is-admin-csv"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  {t('is_admin')}
                </label>
              </div>
            </TabsContent>
          </Tabs>

          {/* Progress indicator */}
          {bulkInviteLoading && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-slate-600">
                <span>{t('sending_invites')}</span>
                <span>{bulkProgress.current} of {bulkProgress.total}</span>
              </div>
              <Progress value={(bulkProgress.current / bulkProgress.total) * 100} className="h-2" />
            </div>
          )}

          <Button
            className="w-full bg-green-600 hover:bg-green-700"
            onClick={handleBulkInvite}
            disabled={bulkInviteLoading}
          >
            {bulkInviteLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                {t('sending_invites')}
              </>
            ) : (
              <>
                <Users className="mr-2 h-4 w-4" />
                {t('send_bulk_invites')}
              </>
            )}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}