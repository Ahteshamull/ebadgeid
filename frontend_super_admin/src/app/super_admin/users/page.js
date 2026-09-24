"use client"
import React, { useState, useEffect } from 'react';
import {
  Search, Plus, UserCog, Mail, Globe, ShieldCheck,
  Power, Trash2, Upload, File
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { apiFetch, uploadFile } from '@/lib/api';
import ExportButtons from '@/components/ExportButtons';

// Deliberately excludes anything credential-bearing or internal: no ids,
// no password/auth fields, no profile-picture URLs. Only what the table
// already shows on screen.
const SUPER_ADMIN_EXPORT_COLUMNS = [
  { header: 'Name', key: (u) => `${u.first_name || ''} ${u.last_name || ''}`.trim() },
  { header: 'Username', key: 'username' },
  { header: 'Email', key: 'email' },
  { header: 'Designation', key: 'designation' },
  { header: 'Organization', key: 'organization_code' },
  { header: 'Status', key: 'status' },
  { header: 'City', key: 'city' },
  { header: 'Country', key: 'country' },
  { header: 'Created', key: 'createdAt', format: (v) => (v ? new Date(v).toISOString().slice(0, 10) : '') },
];

export default function SuperAdminManagement() {
  const [users, setUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Confirmation dialog
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    type: null, // 'toggle' | 'delete'
    user: null
  });

  // File upload states
  const [uploadingProfile, setUploadingProfile] = useState(false);

  // Create form (for Super Admin)
  const [createForm, setCreateForm] = useState({
    username: '',
    password: '',
    first_name: '',
    last_name: '',
    designation: 'Super Admin', // fixed
    city: '',
    state: '',
    country: '',
    email: '',
    phone: '',
    profile_picture_url: ''
  });

  // SA-04 fix: the search box used to filter a fully-downloaded list in
  // the browser (data.filter(...) on the whole /users response). This
  // debounces the query and re-fetches from the server with ?search=,
  // ?designation=Super+Admin instead -- the backend does the filtering
  // (userController.js's getAllUsers), not the client.
  useEffect(() => {
    const handle = setTimeout(() => { fetchSuperAdmins(searchQuery); }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // SA-01/SA-03/SA-04 fix: was a bare fetch() with a localStorage bearer
  // token (always null after the login fix), against an endpoint that
  // could only ever see the caller's own organization -- then filtered
  // the result in the browser for a designation match. apiFetch carries
  // the session cookie; ?designation=Super+Admin&search=... does the
  // actual filtering server-side, across every organization (the backend
  // now grants platform_admin that scope -- see userController.js).
  const fetchSuperAdmins = async (search = '') => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ designation: 'Super Admin' });
      if (search.trim()) params.set('search', search.trim());
      const res = await apiFetch(`/users?${params.toString()}`, { redirectOnUnauthorized: false });
      const data = await res.json();
      if (res.ok) {
        setUsers(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to load super admins', err);
    } finally {
      setLoading(false);
    }
  };

  const handleProfilePicUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadingProfile(true);
      // SA-05 fix: authenticated upload (session cookie + CSRF) against
      // the real storage host, not an unauthenticated POST to a typo'd
      // domain (sss.ebadgeid.com) that never resolved to anything.
      const url = await uploadFile(file);
      setCreateForm(f => ({ ...f, profile_picture_url: url }));
    } catch (err) {
      setCreateError('Profile picture upload failed: ' + err.message);
    } finally {
      setUploadingProfile(false);
    }
  };

  const handleCreateSuperAdmin = async () => {
    setCreateError('');
    if (!createForm.username || !createForm.password || !createForm.email) {
      setCreateError('Username, Password and Email are required');
      return;
    }
    setCreating(true);
    try {
      // SA-03 fix: POST /auth/superadmin/register now exists (see
      // backend controllers/authController.js's createPlatformAdmin) --
      // it previously pointed at a route that had never been implemented
      // anywhere, so this button always failed.
      const res = await apiFetch('/auth/superadmin/register', {
        method: 'POST',
        body: JSON.stringify(createForm),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok) {
        setShowCreateModal(false);
        resetForm();
        await fetchSuperAdmins(searchQuery);
      } else {
        setCreateError(result.message || 'Failed to create super admin');
      }
    } catch (err) {
      setCreateError('Error: ' + err.message);
    } finally {
      setCreating(false);
    }
  };

  const resetForm = () => {
    setCreateForm({
      username: '', password: '', first_name: '', last_name: '', designation: 'Super Admin',
      city: '', state: '', country: '', email: '', phone: '', profile_picture_url: ''
    });
    setCreateError('');
  };

  const handleActionConfirm = async () => {
    if (!confirmDialog.user) return;

    const { user, type } = confirmDialog;
    // SA-03 fix: the backend's PUT/DELETE /users/:id looks the user up
    // by its Mongo _id, not by username -- sending username (as this
    // used to prefer) always failed with a cast error.
    const url = `/users/${user._id}`;

    try {
      let res;
      if (type === 'toggle') {
        const newStatus = user.status?.toUpperCase() === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
        res = await apiFetch(url, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
      } else if (type === 'delete') {
        res = await apiFetch(url, { method: 'DELETE' });
      }

      if (res.ok) {
        await fetchSuperAdmins(searchQuery);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.message || 'Operation failed');
      }
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setConfirmDialog({ open: false, type: null, user: null });
    }
  };

  // Stats
  const stats = {
    total: users.length,
    active: users.filter(u => u.status?.toUpperCase() === 'ACTIVE').length,
    suspended: users.filter(u => u.status?.toUpperCase() === 'SUSPENDED').length,
  };

  const getStatusStyle = (status) => {
    const s = (status || '').toUpperCase();
    const styles = {
      ACTIVE: 'bg-green-100 text-green-800 border-green-200',
      SUSPENDED: 'bg-gray-100 text-gray-800 border-gray-200',
      INACTIVE: 'bg-red-100 text-red-800 border-red-200'
    };
    return styles[s] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  return (
    <div className="min-h-screen p-6 pb-12">
      <div className="max-w-7xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Super Admin Management</h1>
            <p className="text-gray-600 mt-1">Manage system super administrators</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ExportButtons
              rows={users}
              columns={SUPER_ADMIN_EXPORT_COLUMNS}
              filenameBase="super-admins"
              title="eBadge ID — Super Administrators"
              sheetName="Super Admins"
            />
            <Button
              onClick={() => { resetForm(); setShowCreateModal(true); }}
              className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800"
            >
              <Plus className="mr-2 h-4 w-4" /> Add Super Admin
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <StatCard icon={<UserCog />} title="Total Super Admins" value={stats.total} color="from-purple-500 to-purple-600" />
          <StatCard icon={<ShieldCheck />} title="Active" value={stats.active} color="from-green-500 to-green-600" />
          <StatCard icon={<Power />} title="Suspended" value={stats.suspended} color="from-red-500 to-red-600" />
        </div>

        {/* Search */}
        <div className="bg-white rounded-2xl shadow-md border p-5">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by name, email or username..."
              className="w-full pl-12 pr-5 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
            />
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl shadow-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100/70">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Username</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Email</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Location</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={6} className="py-20 text-center">Loading super admins...</td></tr>
                ) : users.length === 0 ? (
                  <tr><td colSpan={6} className="py-20 text-center text-gray-500">No super admins found</td></tr>
                ) : (
                  users.map(user => (
                    <tr key={user._id} className="hover:bg-purple-50/30 transition-colors">
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          {user.profile_picture_url ? (
                            <img
                              src={user.profile_picture_url}
                              alt=""
                              className="w-10 h-10 rounded-full object-cover ring-1 ring-gray-200"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-100 to-indigo-100 flex items-center justify-center text-purple-600">
                              <UserCog size={20} />
                            </div>
                          )}
                          <div className="font-medium text-gray-900">
                            {user.first_name} {user.last_name}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-5 font-mono text-sm text-gray-600">{user.username}</td>
                      <td className="px-6 py-5 text-sm text-gray-600">{user.email}</td>
                      <td className="px-6 py-5 text-sm text-gray-600">
                        {user.city ? `${user.city}, ` : ''}{user.country}
                      </td>
                      <td className="px-6 py-5">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusStyle(user.status)}`}>
                          {user.status || 'UNKNOWN'}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setConfirmDialog({
                              open: true,
                              type: 'toggle',
                              user
                            })}
                            className={user.status?.toUpperCase() === 'ACTIVE'
                              ? "border-red-200 text-red-700 hover:bg-red-50"
                              : "border-green-200 text-green-700 hover:bg-green-50"}
                          >
                            <Power className="mr-1.5 h-4 w-4" />
                            {user.status?.toUpperCase() === 'ACTIVE' ? 'Disable' : 'Enable'}
                          </Button>

                          <Button
                            variant="destructive"
                            size="sm"
                            className="text-white"
                            onClick={() => setConfirmDialog({
                              open: true,
                              type: 'delete',
                              user
                            })}
                          >
                            <Trash2 className="mr-1.5 h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Create Super Admin Modal */}
        <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Super Admin</DialogTitle>
            </DialogHeader>
            {createError && (
              <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2">
                {createError}
              </div>
            )}
            <div className="space-y-5 py-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Username *</label>
                  <input
                    value={createForm.username}
                    onChange={e => setCreateForm(f => ({ ...f, username: e.target.value }))}
                    className="w-full px-4 py-2.5 border rounded-xl focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Email *</label>
                  <input
                    type="email"
                    value={createForm.email}
                    onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full px-4 py-2.5 border rounded-xl focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Password *</label>
                  <input
                    type="password"
                    value={createForm.password}
                    onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
                    className="w-full px-4 py-2.5 border rounded-xl focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone</label>
                  <input
                    value={createForm.phone}
                    onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full px-4 py-2.5 border rounded-xl focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">First Name</label>
                  <input value={createForm.first_name} onChange={e => setCreateForm(f => ({ ...f, first_name: e.target.value }))} className="w-full px-4 py-2.5 border rounded-xl" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Last Name</label>
                  <input value={createForm.last_name} onChange={e => setCreateForm(f => ({ ...f, last_name: e.target.value }))} className="w-full px-4 py-2.5 border rounded-xl" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Designation</label>
                  <input
                    value="Super Admin"
                    disabled
                    className="w-full px-4 py-2.5 border rounded-xl bg-gray-100 cursor-not-allowed"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">City</label>
                  <input value={createForm.city} onChange={e => setCreateForm(f => ({ ...f, city: e.target.value }))} className="w-full px-4 py-2.5 border rounded-xl" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">State/Province</label>
                  <input value={createForm.state} onChange={e => setCreateForm(f => ({ ...f, state: e.target.value }))} className="w-full px-4 py-2.5 border rounded-xl" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Country</label>
                  <input value={createForm.country} onChange={e => setCreateForm(f => ({ ...f, country: e.target.value }))} className="w-full px-4 py-2.5 border rounded-xl" />
                </div>
              </div>

              {/* Profile Picture Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Profile Picture</label>
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-purple-400 transition-colors">
                  <input
                    type="file"
                    id="profile-upload"
                    accept="image/*"
                    className="hidden"
                    onChange={handleProfilePicUpload}
                    disabled={uploadingProfile}
                  />
                  <label htmlFor="profile-upload" className="cursor-pointer">
                    <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                    <p className="text-sm font-medium text-gray-600">
                      {uploadingProfile ? 'Uploading...' : createForm.profile_picture_url ? 'Uploaded ✓' : 'Click to upload profile picture'}
                    </p>
                  </label>
                </div>
              </div>

              <div className="flex gap-4 pt-6">
                <Button variant="outline" className="flex-1" onClick={() => setShowCreateModal(false)} disabled={creating}>
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-purple-600 hover:bg-purple-700"
                  disabled={creating || uploadingProfile || !createForm.username || !createForm.password || !createForm.email}
                  onClick={handleCreateSuperAdmin}
                >
                  {creating ? 'Creating…' : 'Create Super Admin'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Confirmation Dialog */}
        <Dialog open={confirmDialog.open} onOpenChange={(o) => setConfirmDialog(prev => ({ ...prev, open: o }))}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {confirmDialog.type === 'toggle'
                  ? (confirmDialog.user?.status?.toUpperCase() === 'ACTIVE' ? 'Disable' : 'Enable') + ' Super Admin'
                  : 'Delete Super Admin'
                }
              </DialogTitle>
              <DialogDescription>
                {confirmDialog.type === 'toggle'
                  ? `Are you sure you want to ${confirmDialog.user?.status?.toUpperCase() === 'ACTIVE' ? 'disable' : 'enable'} this super admin?`
                  : 'This action is irreversible. The super admin account will be permanently deleted.'
                }
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDialog({ open: false, type: null, user: null })}>
                Cancel
              </Button>
              <Button
                variant={confirmDialog.type === 'delete' ? "destructive" : "default"}
                onClick={handleActionConfirm}
              >
                {confirmDialog.type === 'toggle'
                  ? (confirmDialog.user?.status?.toUpperCase() === 'ACTIVE' ? 'Disable' : 'Enable')
                  : 'Delete'
                }
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function StatCard({ icon, title, value, color }) {
  return (
    <div className={`bg-gradient-to-br ${color} rounded-2xl p-6 text-white shadow-lg`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium opacity-90">{title}</p>
          <p className="text-3xl font-bold mt-1">{value}</p>
        </div>
        <div className="opacity-80">
          {React.cloneElement(icon, { size: 32 })}
        </div>
      </div>
    </div>
  );
}
