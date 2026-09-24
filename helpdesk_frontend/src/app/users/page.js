"use client"

import { useEffect, useState } from "react";
import { API_BASE_URL } from "@/lib/config";
import { apiFetch } from '@/lib/api';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  MoreVertical, 
  Trash2, 
  UserX, 
  Download, 
  Plus, 
  Users, 
  Eye,
  EyeOff,
  User,
  Search,
  Mail,
  Calendar,
  Shield,
  UserCheck,
  Upload,
  AlertCircle,
  Loader2,
  RefreshCw
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [addUserLoading, setAddUserLoading] = useState(false);
  const [userData, setUserData] = useState({
    name: "",
    email: "",
    username: "",
    password: "",
    address: "",
    user_type: "user"
  });
  const [showPassword, setShowPassword] = useState(false);
  const [alert, setAlert] = useState({ show: false, message: "", type: "success" });

  // Show alert helper
  const showAlert = (message, type = "success") => {
    setAlert({ show: true, message, type });
    setTimeout(() => {
      setAlert({ show: false, message: "", type: "success" });
    }, 5000);
  };

  // API Base URL

  // API headers with authorization
  const getHeaders = () => ({
    'Content-Type': 'application/json'
  });

  // Fetch users from API
  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await apiFetch(`${API_BASE_URL}/auth/users`, {
        headers: getHeaders()
      });

      if (!response.ok) {
        throw new Error('Failed to fetch users');
      }

      const data = await response.json();
      setUsers(data);
    } catch (error) {
      console.error('Error fetching users:', error);
      showAlert("Failed to fetch users. Please try again.", "error");
    } finally {
      setLoading(false);
    }
  };

  // Delete user
  const handleDeleteUser = async (userId) => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/auth/users/${userId}`, {
        method: 'DELETE',
        headers: getHeaders()
      });

      if (!response.ok) {
        throw new Error('Failed to delete user');
      }

      setUsers(users.filter(user => user._id !== userId));
      showAlert("User deleted successfully");
    } catch (error) {
      console.error('Error deleting user:', error);
      showAlert("Failed to delete user. Please try again.", "error");
    }
  };

  // Add new user
  const handleAddUser = async () => {
    if (!userData.name || !userData.email || !userData.username || !userData.password) {
      showAlert("Please fill all required fields.", "error");
      return;
    }

    try {
      setAddUserLoading(true);
      const response = await apiFetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(userData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to add user');
      }

      const newUser = await response.json();
      setUsers([...users, newUser]);
      
      showAlert("User added successfully!");

      // Reset form and close modal
      setUserData({
        name: "",
        email: "",
        username: "",
        password: "",
        address: "",
        user_type: "user"
      });
      setShowAddUserModal(false);
    } catch (error) {
      console.error('Error adding user:', error);
      showAlert(error.message || "Failed to add user. Please try again.", "error");
    } finally {
      setAddUserLoading(false);
    }
  };

  // Generate random password
  const generatePassword = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
    const values = new Uint32Array(16);
    window.crypto.getRandomValues(values);
    const password = Array.from(values, value => chars[value % chars.length]).join('');
    setUserData({ ...userData, password });
  };

  // Filter users
  const filteredUsers = users.filter((user) => {
    const matchesSearch = `${user.name} ${user.username} ${user.email}`
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchesType = filterType === "all" || user.user_type === filterType;
    return matchesSearch && matchesType;
  });

  // Get user type badge variant
  const getUserTypeBadge = (type) => {
    switch(type) {
      case 'admin': return { variant: "outlined", icon: <Shield className="w-3 h-3" /> };
      case 'agent': return { variant: "default", icon: <UserCheck className="w-3 h-3" /> };
      default: return { variant: "secondary", icon: <User className="w-3 h-3" /> };
    }
  };

  // Format date
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Export the currently filtered user list to a real PDF -- same
  // columns as the on-screen table, minus profile pictures and the
  // actions column, which have no meaning on paper.
  const exportToPDF = async () => {
    try {
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF({ orientation: 'landscape' });
      doc.setFontSize(14);
      doc.text('Helpdesk Users', 14, 15);
      doc.setFontSize(9);
      doc.text(`Exported ${formatDate(new Date().toISOString())} — ${filteredUsers.length} user(s)`, 14, 21);
      autoTable(doc, {
        startY: 26,
        head: [['Name', 'Username', 'Email', 'Type', 'Address', 'Created']],
        body: filteredUsers.map((user) => [
          user.name || '',
          user.username || '',
          user.email || '',
          user.user_type || '',
          user.address || '',
          formatDate(user.createdAt),
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [30, 41, 59] },
      });
      doc.save(`helpdesk-users-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (error) {
      console.error('PDF export failed:', error);
      showAlert('Could not generate the PDF export. Please try again.', 'error');
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex items-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading users...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Alert */}
      {alert.show && (
        <Alert className={`${alert.type === "error" ? "border-red-500 bg-red-50" : "border-green-500 bg-green-50"}`}>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className={alert.type === "error" ? "text-red-700" : "text-green-700"}>
            {alert.message}
          </AlertDescription>
        </Alert>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">User Management</h1>
          <p className="text-muted-foreground">Manage your team members and their permissions</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchUsers}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" onClick={exportToPDF}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button onClick={() => setShowAddUserModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add User
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{users.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Admins</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{users.filter(u => u.user_type === 'admin').length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Agents</CardTitle>
            <UserCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{users.filter(u => u.user_type === 'agent').length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Regular Users</CardTitle>
            <User className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{users.filter(u => u.user_type === 'user').length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search users by name, username, or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="agent">Agent</SelectItem>
                <SelectItem value="user">User</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="mt-4 text-sm text-muted-foreground">
            Showing {filteredUsers.length} of {users.length} users
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.map((user) => {
                const typeBadge = getUserTypeBadge(user.user_type);
                return (
                  <TableRow key={user._id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                          {user.profile_picture ? (
                            <img
                              src={user.profile_picture}
                              alt={user.name}
                              className="w-10 h-10 rounded-full object-cover"
                            />
                          ) : (
                            <User className="w-5 h-5 text-white" />
                          )}
                        </div>
                        <div>
                          <div className="font-medium">{user.name}</div>
                          <div className="text-sm text-muted-foreground">@{user.username || 'N/A'}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-muted-foreground" />
                        <a 
                          href={`mailto:${user.email}`} 
                          className="text-blue-600 hover:underline"
                        >
                          {user.email}
                        </a>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={typeBadge.variant} className="flex items-center gap-1 w-fit">
                        {typeBadge.icon}
                        <span className="capitalize">{user.user_type}</span>
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-xs truncate text-muted-foreground">
                        {user.address || "Not provided"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="w-4 h-4" />
                        {formatDate(user.createdAt)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem 
                            onClick={() => handleDeleteUser(user._id)}
                            className="text-red-600 focus:text-red-600"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {filteredUsers.length === 0 && (
            <div className="text-center py-12">
              <User className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium">No users found</h3>
              <p className="text-muted-foreground">Try adjusting your search or filters</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add User Modal */}
      <Dialog open={showAddUserModal} onOpenChange={setShowAddUserModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" />
              Add New User
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Full Name *"
              value={userData.name}
              onChange={(e) => setUserData({ ...userData, name: e.target.value })}
            />
            <Input
              placeholder="Email Address *"
              type="email"
              value={userData.email}
              onChange={(e) => setUserData({ ...userData, email: e.target.value })}
            />
            <Input
              placeholder="Username *"
              value={userData.username}
              onChange={(e) => setUserData({ ...userData, username: e.target.value })}
            />
            <div className="relative">
              <Input
                placeholder="Password *"
                type={showPassword ? "text" : "password"}
                value={userData.password}
                onChange={(e) => setUserData({ ...userData, password: e.target.value })}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={generatePassword}
              className="w-full"
            >
              Generate Strong Password
            </Button>
            <Input
              placeholder="Address (Optional)"
              value={userData.address}
              onChange={(e) => setUserData({ ...userData, address: e.target.value })}
            />
            <Select 
              value={userData.user_type} 
              onValueChange={(value) => setUserData({ ...userData, user_type: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select user type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="agent">Agent</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            className="w-full mt-6"
            onClick={handleAddUser}
            disabled={addUserLoading}
          >
            {addUserLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Adding User...
              </>
            ) : (
              "Add User"
            )}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
