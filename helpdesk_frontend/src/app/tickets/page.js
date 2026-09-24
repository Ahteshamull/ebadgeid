"use client"

import { useEffect, useState } from "react";
import { API_BASE_URL } from "@/lib/config";
import { apiFetch } from '@/lib/api';
import { useRouter } from "next/navigation";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  MoreVertical, 
  Trash2, 
  Plus, 
  Ticket, 
  Search,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Clock,
  Users,
  Eye,
  MessageSquare,
  Loader2,
  RefreshCw,
  AlertCircle,
  Download,
  User,
  Mail,
  Edit,
  Archive
} from "lucide-react";

export default function TicketManagementPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [showAddTicketModal, setShowAddTicketModal] = useState(false);
  const [showChangeStatusModal, setShowChangeStatusModal] = useState(false);
  const [selectedTicketForStatus, setSelectedTicketForStatus] = useState(null);
  const [newStatus, setNewStatus] = useState("");
  const [addTicketLoading, setAddTicketLoading] = useState(false);
  const [statusUpdateLoading, setStatusUpdateLoading] = useState(false);
  const [alert, setAlert] = useState({ show: false, message: "", type: "success" });
  const [ticketData, setTicketData] = useState({
    ticket_title: "",
    ticket_description: "",
    priority: "medium",
    usernameOrEmail: ""
  });

  // API Base URL

  // Show alert helper
  const showAlert = (message, type = "success") => {
    setAlert({ show: true, message, type });
    setTimeout(() => {
      setAlert({ show: false, message: "", type: "success" });
    }, 5000);
  };

  // API headers with authorization
  const getHeaders = () => ({
    'Content-Type': 'application/json'
  });

  // Fetch tickets from API
  const fetchTickets = async () => {
    try {
      setLoading(true);
      const response = await apiFetch(`${API_BASE_URL}/tickets`, {
        headers: getHeaders()
      });

      if (!response.ok) {
        throw new Error('Failed to fetch tickets');
      }

      const data = await response.json();
      setTickets(data);
    } catch (error) {
      console.error('Error fetching tickets:', error);
      showAlert("Failed to fetch tickets. Please try again.", "error");
    } finally {
      setLoading(false);
    }
  };

  // Create new ticket
  const handleAddTicket = async () => {
    if (!ticketData.ticket_title || !ticketData.ticket_description || !ticketData.usernameOrEmail) {
      showAlert("Please fill all required fields.", "error");
      return;
    }

    try {
      setAddTicketLoading(true);
      const response = await apiFetch(`${API_BASE_URL}/tickets`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(ticketData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to create ticket');
      }

      const newTicket = await response.json();
      setTickets([newTicket, ...tickets]);
      
      showAlert("Ticket created successfully!");

      // Reset form and close modal
      setTicketData({
        ticket_title: "",
        ticket_description: "",
        priority: "medium",
        usernameOrEmail: ""
      });
      setShowAddTicketModal(false);
    } catch (error) {
      console.error('Error creating ticket:', error);
      showAlert(error.message || "Failed to create ticket. Please try again.", "error");
    } finally {
      setAddTicketLoading(false);
    }
  };

  // Delete ticket. Keyed by ticket_code, same as every other ticket route
  // (status, update, messages) -- this used to send the Mongo _id instead,
  // to a DELETE /api/tickets/:id backend route that never existed at all
  // (bug found during an audit round: the button always failed with 404).
  const handleDeleteTicket = async (ticketCode) => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/tickets/${ticketCode}`, {
        method: 'DELETE',
        headers: getHeaders()
      });

      if (!response.ok) {
        throw new Error('Failed to delete ticket');
      }

      setTickets(tickets.filter(ticket => ticket.ticket_code !== ticketCode));
      showAlert("Ticket deleted successfully");
    } catch (error) {
      console.error('Error deleting ticket:', error);
      showAlert("Failed to delete ticket. Please try again.", "error");
    }
  };

  // Update ticket status using ticket_code
  const handleUpdateStatus = async () => {
    if (!selectedTicketForStatus || !newStatus) return;

    try {
      setStatusUpdateLoading(true);
      const response = await apiFetch(`${API_BASE_URL}/tickets/${selectedTicketForStatus.ticket_code}/status`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ status: newStatus })
      });

      if (!response.ok) {
        throw new Error('Failed to update ticket status');
      }

      const updatedTicket = await response.json();
      setTickets(tickets.map(ticket => 
        ticket._id === selectedTicketForStatus._id 
          ? updatedTicket
          : ticket
      ));
      
      showAlert(`Ticket status updated to ${newStatus}`);
      setShowChangeStatusModal(false);
      setSelectedTicketForStatus(null);
      setNewStatus("");
    } catch (error) {
      console.error('Error updating ticket status:', error);
      showAlert("Failed to update ticket status. Please try again.", "error");
    } finally {
      setStatusUpdateLoading(false);
    }
  };

  // Open change status modal
  const openChangeStatusModal = (ticket) => {
    setSelectedTicketForStatus(ticket);
    setNewStatus(ticket.status);
    setShowChangeStatusModal(true);
  };

  // Navigate to ticket details page. `/ticket_details/[ticket_code]` is the
  // maintained detail view (file attachments, translations, proper
  // "OTP user can't change status" error handling); `/tickets/[ticket_code]`
  // is an older duplicate that never got those updates — route here instead
  // of there so agents land on the current page.
  const viewTicket = (ticketCode) => {
    router.push(`/ticket_details/${ticketCode}`);
  };

  // Filter tickets
  const filteredTickets = tickets.filter((ticket) => {
    const matchesSearch = `${ticket.ticket_title} ${ticket.ticket_code} ${ticket.ticket_description}`
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchesStatus = filterStatus === "all" || ticket.status === filterStatus;
    const matchesPriority = filterPriority === "all" || ticket.priority === filterPriority;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  // Get status badge variant and icon
  const getStatusBadge = (status) => {
    switch(status) {
      case 'open': return { variant: "default", icon: <Clock className="w-3 h-3" />, color: "bg-blue-50 text-blue-700 border-blue-200" };
      case 'in-progress': return { variant: "secondary", icon: <Clock className="w-3 h-3" />, color: "bg-yellow-50 text-yellow-700 border-yellow-200" };
      case 'resolved': return { variant: "outline", icon: <CheckCircle className="w-3 h-3" />, color: "bg-green-50 text-green-700 border-green-200" };
      case 'closed': return { variant: "secondary", icon: <Archive className="w-3 h-3" />, color: "bg-gray-50 text-gray-700 border-gray-200" };
      default: return { variant: "default", icon: <Clock className="w-3 h-3" />, color: "bg-blue-50 text-blue-700 border-blue-200" };
    }
  };

  // Get priority badge variant and icon
  const getPriorityBadge = (priority) => {
    switch(priority) {
      case 'critical': return { variant: "destructive", icon: <AlertTriangle className="w-3 h-3" />, color: "bg-red-100 text-red-800 border-red-200" };
      case 'urgent': return { variant: "destructive", icon: <AlertTriangle className="w-3 h-3" />, color: "bg-orange-100 text-orange-800 border-orange-200" };
      case 'high': return { variant: "secondary", icon: <AlertTriangle className="w-3 h-3" />, color: "bg-red-50 text-red-700 border-red-200" };
      case 'medium': return { variant: "outline", icon: <AlertTriangle className="w-3 h-3" />, color: "bg-yellow-50 text-yellow-700 border-yellow-200" };
      case 'low': return { variant: "secondary", icon: <AlertTriangle className="w-3 h-3" />, color: "bg-green-50 text-green-700 border-green-200" };
      default: return { variant: "outline", icon: <AlertTriangle className="w-3 h-3" />, color: "bg-yellow-50 text-yellow-700 border-yellow-200" };
    }
  };

  // Format date
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Format relative time
  const formatRelativeTime = (dateString) => {
    const now = new Date();
    const date = new Date(dateString);
    const diffInHours = Math.floor((now - date) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return 'Just now';
    if (diffInHours < 24) return `${diffInHours}h ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays}d ago`;
    return formatDate(dateString);
  };

  // Export the currently filtered ticket list to a real PDF -- one row
  // per ticket, same columns as the on-screen table (minus the actions
  // column, which has no meaning on paper).
  const exportToPDF = async () => {
    try {
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF({ orientation: 'landscape' });
      doc.setFontSize(14);
      doc.text('Support Tickets', 14, 15);
      doc.setFontSize(9);
      doc.text(`Exported ${formatDate(new Date().toISOString())} — ${filteredTickets.length} ticket(s)`, 14, 21);
      autoTable(doc, {
        startY: 26,
        head: [['Ticket', 'Code', 'Status', 'Priority', 'Members', 'Messages', 'Last Activity']],
        body: filteredTickets.map((ticket) => [
          ticket.ticket_title || '',
          ticket.ticket_code || '',
          ticket.status || '',
          ticket.priority || '',
          String(ticket.ticket_members?.length || 0),
          String(ticket.messages?.length || 0),
          formatDate(ticket.last_activity),
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [30, 41, 59] },
      });
      doc.save(`tickets-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (error) {
      console.error('PDF export failed:', error);
      showAlert('Could not generate the PDF export. Please try again.', 'error');
    }
  };

  // View ticket details
  const viewTicketDetails = (ticket) => {
    setSelectedTicket(ticket);
    setShowTicketDetailsModal(true);
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex items-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading tickets...</span>
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
          <h1 className="text-3xl font-bold">Ticket Management</h1>
          <p className="text-muted-foreground">Manage support tickets and customer requests</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchTickets}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" onClick={exportToPDF}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button onClick={() => setShowAddTicketModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Ticket
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tickets</CardTitle>
            <Ticket className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tickets.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open</CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tickets.filter(t => t.status === 'open').length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tickets.filter(t => t.status === 'in-progress').length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Resolved</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tickets.filter(t => t.status === 'resolved').length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Critical</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tickets.filter(t => t.priority === 'critical').length}</div>
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
                placeholder="Search tickets by title, code, or description..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in-progress">In Progress</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="Filter by priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="mt-4 text-sm text-muted-foreground">
            Showing {filteredTickets.length} of {tickets.length} tickets
          </div>
        </CardContent>
      </Card>

      {/* Tickets Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Messages</TableHead>
                <TableHead>Last Activity</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTickets.map((ticket) => {
                const statusBadge = getStatusBadge(ticket.status);
                const priorityBadge = getPriorityBadge(ticket.priority);
                return (
                  <TableRow key={ticket._id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell>
                      <div className="space-y-1">
                        <div className="font-medium">{ticket.ticket_title}</div>
                        <div className="text-sm text-muted-foreground">{ticket.ticket_code}</div>
                        <div className="text-xs text-muted-foreground max-w-xs truncate">
                          {ticket.ticket_description}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={`${statusBadge.color} border flex items-center gap-1 w-fit`}>
                        {statusBadge.icon}
                        <span className="capitalize">{ticket.status}</span>
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={`${priorityBadge.color} border flex items-center gap-1 w-fit`}>
                        {priorityBadge.icon}
                        <span className="capitalize">{ticket.priority}</span>
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">{ticket.ticket_members?.length || 0}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">{ticket.messages?.length || 0}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="w-4 h-4" />
                        <span className="text-sm">{formatRelativeTime(ticket.last_activity)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => openChangeStatusModal(ticket)}
                        >
                          Change Status
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => viewTicket(ticket.ticket_code)}
                        >
                          View Ticket
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (window.confirm('Are you sure you want to delete this ticket? This cannot be undone.')) {
                              handleDeleteTicket(ticket.ticket_code);
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {filteredTickets.length === 0 && (
            <div className="text-center py-12">
              <Ticket className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium">No tickets found</h3>
              <p className="text-muted-foreground">Try adjusting your search or filters</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Ticket Modal */}
      <Dialog open={showAddTicketModal} onOpenChange={setShowAddTicketModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" />
              Create New Ticket
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Ticket Title *"
              value={ticketData.ticket_title}
              onChange={(e) => setTicketData({ ...ticketData, ticket_title: e.target.value })}
            />
            <Textarea
              placeholder="Ticket Description *"
              value={ticketData.ticket_description}
              onChange={(e) => setTicketData({ ...ticketData, ticket_description: e.target.value })}
              rows={4}
            />
            <Select 
              value={ticketData.priority} 
              onValueChange={(value) => setTicketData({ ...ticketData, priority: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Contact Email *"
              type="email"
              value={ticketData.usernameOrEmail}
              onChange={(e) => setTicketData({ ...ticketData, usernameOrEmail: e.target.value })}
            />
          </div>
          <Button
            className="w-full mt-6"
            onClick={handleAddTicket}
            disabled={addTicketLoading}
          >
            {addTicketLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating Ticket...
              </>
            ) : (
              "Create Ticket"
            )}
          </Button>
        </DialogContent>
      </Dialog>

      {/* Change Status Modal */}
      <Dialog open={showChangeStatusModal} onOpenChange={setShowChangeStatusModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="w-5 h-5" />
              Change Ticket Status
            </DialogTitle>
          </DialogHeader>
          {selectedTicketForStatus && (
            <div className="space-y-4">
              <div>
                <h4 className="font-medium">{selectedTicketForStatus.ticket_title}</h4>
                <p className="text-sm text-muted-foreground">{selectedTicketForStatus.ticket_code}</p>
              </div>
              
              <div>
                <label className="text-sm font-medium mb-2 block">Current Status:</label>
                <Badge className={`${getStatusBadge(selectedTicketForStatus.status).color} border`}>
                  {selectedTicketForStatus.status}
                </Badge>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">New Status:</label>
                <Select value={newStatus} onValueChange={setNewStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select new status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in-progress">In Progress</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2 pt-4">
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => setShowChangeStatusModal(false)}
                  disabled={statusUpdateLoading}
                >
                  Cancel
                </Button>
                <Button 
                  className="flex-1"
                  onClick={handleUpdateStatus}
                  disabled={statusUpdateLoading || newStatus === selectedTicketForStatus.status}
                >
                  {statusUpdateLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    "Update Status"
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
