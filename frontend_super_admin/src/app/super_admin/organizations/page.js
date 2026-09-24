"use client"
import React, { useState, useEffect } from 'react';
import {
  Search, Plus, Building2, Mail, Globe, ShieldCheck, X,
  Upload, File, Power, Trash2
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import ExportButtons from '@/components/ExportButtons';

// Explicit projection rather than dumping the raw API objects: an export
// must never carry internal fields (ids, admin sub-documents) that merely
// happened to be in the response. These are exactly the columns shown in
// the table below, so the file matches what the user is looking at.
const ORGANIZATION_EXPORT_COLUMNS = [
  { header: 'Organization', key: 'name' },
  { header: 'Code', key: 'organization_code' },
  { header: 'Plan', key: 'plan' },
  { header: 'Status', key: 'status' },
  { header: 'City', key: 'city' },
  { header: 'State', key: 'state' },
  { header: 'Country', key: 'country' },
  { header: 'Email', key: 'email' },
  { header: 'Phone', key: 'phone' },
  { header: 'Seats used', key: 'seat_count' },
  { header: 'Created', key: 'createdAt', format: (v) => (v ? new Date(v).toISOString().slice(0, 10) : '') },
];

export default function OrganizationManagement() {
  const [organizations, setOrganizations] = useState([]);
  const [filteredOrganizations, setFilteredOrganizations] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Confirmation dialogs
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    type: null, // 'toggle' | 'delete'
    organization: null
  });

  // SA-03 fix: the real POST /organizations (organizationController.js's
  // createOrganization) requires name/city/state/country plus an initial
  // administrator's contact info (admin_email, admin_phone,
  // admin_first_name, admin_last_name) -- it provisions the organization
  // AND that admin's account together in one transaction, and always
  // sends them an activation email. It does not accept plan/logo/
  // signature at creation (plan always starts Free/TRIAL; logo/signature
  // are set later via Edit). Confirmed for real: the original field names
  // (name/email/phone/plan/logo/signature) always failed with
  // {"error":"admin_email is required"}.
  const [createForm, setCreateForm] = useState({
    name: '', city: '', state: '', country: '',
    admin_email: '', admin_phone: '', admin_first_name: '', admin_last_name: '',
  });

  useEffect(() => {
    fetchOrganizations();
  }, []);

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredOrganizations(organizations);
    } else {
      const q = searchQuery.toLowerCase();
      setFilteredOrganizations(
        organizations.filter(org =>
          org.name?.toLowerCase().includes(q) ||
          org.organization_code?.toLowerCase().includes(q) ||
          org.email?.toLowerCase().includes(q)
        )
      );
    }
  }, [searchQuery, organizations]);

  // SA-01 fix: was a bare fetch() with a manually-attached Bearer token
  // read from localStorage (always null after the login fix). apiFetch
  // sends the httpOnly session cookie instead.
  const fetchOrganizations = async () => {
    try {
      setLoading(true);
      const res = await apiFetch('/organizations', { redirectOnUnauthorized: false });
      const data = await res.json();
      if (res.ok) {
        setOrganizations(data || []);
        setFilteredOrganizations(data || []);
      }
    } catch (err) {
      console.error('Failed to load organizations', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    setCreateError('');
    const required = ['name', 'city', 'state', 'country', 'admin_email', 'admin_phone', 'admin_first_name', 'admin_last_name'];
    if (required.some(f => !createForm[f]?.trim())) {
      setCreateError('All fields are required to provision an organization and its administrator.');
      return;
    }
    setCreating(true);
    try {
      const res = await apiFetch('/organizations', {
        method: 'POST',
        body: JSON.stringify(createForm),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setShowCreateModal(false);
        resetForm();
        // Refetch from the server so the new row reflects exactly what
        // was persisted (organization_code, defaults, etc.) rather than
        // trusting the local form state -- confirms real persistence,
        // not just an optimistic UI update.
        await fetchOrganizations();
      } else {
        setCreateError(data.error || data.message || 'Failed to create organization');
      }
    } catch (err) {
      setCreateError('Error: ' + err.message);
    } finally {
      setCreating(false);
    }
  };

  const resetForm = () => {
    setCreateForm({
      name: '', city: '', state: '', country: '',
      admin_email: '', admin_phone: '', admin_first_name: '', admin_last_name: '',
    });
    setCreateError('');
  };

  const handleActionConfirm = async () => {
    if (!confirmDialog.organization) return;

    const { organization, type } = confirmDialog;
    // SA-03 fix: the backend's PUT/DELETE /organizations/:id looks the
    // organization up by its Mongo _id (organizationController.js's
    // findById), not by organization_code -- sending organization_code
    // here always failed (cast error / 404). _id is always present on
    // every row returned by GET /organizations.
    const url = `/organizations/${organization._id}`;

    try {
      let res;
      if (type === 'toggle') {
        const newStatus = organization.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
        res = await apiFetch(url, {
          method: 'PUT',
          body: JSON.stringify({ status: newStatus }),
        });
      } else if (type === 'delete') {
        res = await apiFetch(url, { method: 'DELETE' });
      }

      if (res.ok) {
        await fetchOrganizations();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.message || 'Operation failed');
      }
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setConfirmDialog({ open: false, type: null, organization: null });
    }
  };

  // Stats
  const stats = {
    total: organizations.length,
    active: organizations.filter(o => o.status === 'ACTIVE').length,
    trial: organizations.filter(o => o.status === 'TRIAL').length,
    expired: organizations.filter(o => ['EXPIRED','SUSPENDED'].includes(o.status)).length,
  };

  const getStatusStyle = (status) => {
    const styles = {
      ACTIVE: 'bg-green-100 text-green-800 border-green-200',
      TRIAL: 'bg-amber-100 text-amber-800 border-amber-200',
      EXPIRED: 'bg-red-100 text-red-800 border-red-200',
      SUSPENDED: 'bg-gray-100 text-gray-800 border-gray-200'
    };
    return styles[status] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getPlanStyle = (plan) => {
    const styles = {
      Basic: 'bg-blue-100 text-blue-800',
      Enterprise: 'bg-purple-100 text-purple-800',
      Premium: 'bg-amber-100 text-amber-800'
    };
    return styles[plan] || 'bg-gray-100 text-gray-700';
  };

  return (
    <div className="min-h-screen pb-12">
      <div className="max-w-7xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Organizations</h1>
            <p className="text-gray-600 mt-1">Manage your organization fleet</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Exports the filtered rows currently on screen, not the
                whole collection -- same rule as every other table. */}
            <ExportButtons
              rows={filteredOrganizations}
              columns={ORGANIZATION_EXPORT_COLUMNS}
              filenameBase="organizations"
              title="eBadge ID — Organizations"
              sheetName="Organizations"
            />
            <Button
              onClick={() => { resetForm(); setShowCreateModal(true); }}
              className="bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800"
            >
              <Plus className="mr-2 h-4 w-4" /> New Organization
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <StatCard icon={<Building2 />} title="Total" value={stats.total} color="from-blue-500 to-blue-600" />
          <StatCard icon={<ShieldCheck />} title="Active" value={stats.active} color="from-green-500 to-green-600" />
          <StatCard icon={<Building2 />} title="Trial" value={stats.trial} color="from-amber-500 to-amber-600" />
          <StatCard icon={<Power />} title="Suspended/Expired" value={stats.expired} color="from-red-500 to-red-600" />
        </div>

        {/* Search */}
        <div className="bg-white rounded-2xl shadow-md border p-5">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by name, code or email..."
              className="w-full pl-12 pr-5 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl shadow-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100/70">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Organization</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Code</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Email</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Plan</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={6} className="py-20 text-center">Loading...</td></tr>
                ) : filteredOrganizations.length === 0 ? (
                  <tr><td colSpan={6} className="py-20 text-center text-gray-500">No organizations found</td></tr>
                ) : (
                  filteredOrganizations.map(org => (
                    <tr key={org._id} className="hover:bg-indigo-50/30 transition-colors">
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          {org.logo ? (
                            <img src={org.logo} alt="" className="w-10 h-10 rounded-full object-cover ring-1 ring-gray-200" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center text-indigo-600">
                              <Building2 size={20} />
                            </div>
                          )}
                          <div className="font-medium text-gray-900">{org.name}</div>
                        </div>
                      </td>
                      <td className="px-6 py-5 font-mono text-sm text-gray-600">{org.organization_code}</td>
                      <td className="px-6 py-5 text-sm text-gray-600">{org.email}</td>
                      <td className="px-6 py-5">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${getPlanStyle(org.plan)}`}>
                          {org.plan}
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusStyle(org.status)}`}>
                          {org.status}
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
                              organization: org
                            })}
                            className={org.status === 'ACTIVE'
                              ? "border-red-200 text-red-700 hover:bg-red-50"
                              : "border-green-200 text-green-700 hover:bg-green-50"}
                          >
                            <Power className="mr-1.5 h-4 w-4" />
                            {org.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                          </Button>

                          <Button
                            variant="destructive"
                            className="text-white"
                            size="sm"
                            onClick={() => setConfirmDialog({
                              open: true,
                              type: 'delete',
                              organization: org
                            })}
                          >
                            <Trash2 className="mr-1.5 h-4 w-4 text-white" />
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

        {/* Create Modal -- SA-03 fix: this modal previously rendered a
            title and nothing else (the form body was left as a comment
            placeholder, "paste the previous create form here"), so "New
            Organization" was a dead button -- clicking it opened an empty
            dialog with no way to submit anything. All fields below post
            through the exact `createForm` state/handlers that already
            existed and worked; only the JSX was ever missing. */}
        <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Organization</DialogTitle>
              <DialogDescription>Provisions a real organization immediately.</DialogDescription>
            </DialogHeader>

            {createError && (
              <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2">
                {createError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
              <div className="sm:col-span-2">
                <Label htmlFor="org-name">Organization Name *</Label>
                <Input id="org-name" value={createForm.name}
                  onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="org-city">City *</Label>
                <Input id="org-city" value={createForm.city}
                  onChange={e => setCreateForm(f => ({ ...f, city: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="org-state">State *</Label>
                <Input id="org-state" value={createForm.state}
                  onChange={e => setCreateForm(f => ({ ...f, state: e.target.value }))} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="org-country">Country *</Label>
                <Input id="org-country" value={createForm.country}
                  onChange={e => setCreateForm(f => ({ ...f, country: e.target.value }))} />
              </div>

              <div className="sm:col-span-2 pt-2 border-t text-sm font-medium text-gray-700">
                Initial administrator (an activation email is sent to them)
              </div>
              <div>
                <Label htmlFor="org-admin-first">Admin First Name *</Label>
                <Input id="org-admin-first" value={createForm.admin_first_name}
                  onChange={e => setCreateForm(f => ({ ...f, admin_first_name: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="org-admin-last">Admin Last Name *</Label>
                <Input id="org-admin-last" value={createForm.admin_last_name}
                  onChange={e => setCreateForm(f => ({ ...f, admin_last_name: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="org-admin-email">Admin Email *</Label>
                <Input id="org-admin-email" type="email" value={createForm.admin_email}
                  onChange={e => setCreateForm(f => ({ ...f, admin_email: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="org-admin-phone">Admin Phone *</Label>
                <Input id="org-admin-phone" value={createForm.admin_phone}
                  onChange={e => setCreateForm(f => ({ ...f, admin_phone: e.target.value }))} />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateModal(false)} disabled={creating}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={creating}>
                {creating ? 'Creating…' : 'Create Organization'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Confirmation Dialog */}
        <Dialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {confirmDialog.type === 'toggle'
                  ? (confirmDialog.organization?.status === 'ACTIVE' ? 'Disable' : 'Enable') + ' Organization'
                  : 'Delete Organization'
                }
              </DialogTitle>
              <DialogDescription>
                {confirmDialog.type === 'toggle'
                  ? `Are you sure you want to ${confirmDialog.organization?.status === 'ACTIVE' ? 'disable' : 'enable'} this organization?`
                  : 'This action cannot be undone. The organization and all associated data will be permanently deleted.'
                }
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDialog({ open: false, type: null, organization: null })}>
                Cancel
              </Button>
              <Button
                variant={confirmDialog.type === 'delete' ? "destructive" : "default"}
                onClick={handleActionConfirm}
                className="text-white"
              >
                {confirmDialog.type === 'toggle'
                  ? (confirmDialog.organization?.status === 'ACTIVE' ? 'Disable' : 'Enable')
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

// StatCard component (same as before)
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
