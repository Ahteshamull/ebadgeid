"use client"
import React, { useState, useEffect } from 'react';
import {
  Search, CheckCircle, XCircle, Clock, DollarSign,
  Building2, AlertTriangle
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

// SA-03 fix: this page used to call GET/PATCH https://api.ebadgeid.com/api
// /payment-proofs/*, an endpoint that never existed anywhere in the
// backend (no route, no controller, no model). The real, already-built,
// already-tested feature for "a paid organization signup awaiting manual
// payment confirmation" is PendingOrgSignup + the
// /organizations/self-signup/pending routes (organizationRoutes.js /
// services/selfServiceSignup.js) -- this reconciles the page to that real
// contract instead of a fictitious one. Field names differ from the
// original mockup (there is no uploaded proof *image* in this data model,
// only a text evidence_reference the reviewer records at approval time,
// e.g. a bank transfer ID) -- shown as-is rather than inventing an upload
// flow that doesn't exist on the backend.
export default function PaymentProofsManagement() {
  const [proofs, setProofs] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    proof: null,
    action: null, // 'accept' | 'reject'
  });
  const [approveForm, setApproveForm] = useState({ evidence_reference: '', verified_amount_cents: '', verified_currency: '', note: '' });
  const [rejectNote, setRejectNote] = useState('');

  useEffect(() => {
    fetchPaymentProofs();
  }, []);

  const filteredProofs = searchQuery.trim()
    ? proofs.filter(p => {
        const q = searchQuery.toLowerCase();
        return p.organization?.name?.toLowerCase().includes(q) ||
          p.payment_reference?.toLowerCase().includes(q) ||
          p.plan_name?.toLowerCase().includes(q) ||
          p.admin?.email?.toLowerCase().includes(q);
      })
    : proofs;

  const fetchPaymentProofs = async () => {
    try {
      setLoading(true);
      const res = await apiFetch('/organizations/self-signup/pending?status=awaiting_verification', { redirectOnUnauthorized: false });
      const data = await res.json();
      if (res.ok) {
        setProofs(data.pending || []);
      }
    } catch (err) {
      console.error('Failed to load pending payment signups', err);
    } finally {
      setLoading(false);
    }
  };

  const openAccept = (proof) => {
    setApproveForm({
      evidence_reference: '',
      verified_amount_cents: proof.expected_amount_cents ?? '',
      verified_currency: proof.expected_currency ?? '',
      note: '',
    });
    setActionError('');
    setConfirmDialog({ open: true, proof, action: 'accept' });
  };

  const openReject = (proof) => {
    setRejectNote('');
    setActionError('');
    setConfirmDialog({ open: true, proof, action: 'reject' });
  };

  const handleStatusUpdate = async () => {
    if (!confirmDialog.proof || !confirmDialog.action) return;
    setActionError('');

    const { proof, action } = confirmDialog;
    setSubmitting(true);
    try {
      let res;
      if (action === 'accept') {
        if (!approveForm.evidence_reference || !approveForm.verified_amount_cents || !approveForm.verified_currency) {
          setActionError('Evidence reference, verified amount, and currency are required to approve.');
          setSubmitting(false);
          return;
        }
        res = await apiFetch(`/organizations/self-signup/pending/${proof._id}/approve`, {
          method: 'POST',
          body: JSON.stringify({
            evidence_reference: approveForm.evidence_reference,
            verified_amount_cents: Number(approveForm.verified_amount_cents),
            verified_currency: approveForm.verified_currency,
            note: approveForm.note,
          }),
        });
      } else {
        res = await apiFetch(`/organizations/self-signup/pending/${proof._id}/reject`, {
          method: 'POST',
          body: JSON.stringify({ note: rejectNote }),
        });
      }

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setConfirmDialog({ open: false, proof: null, action: null });
        await fetchPaymentProofs();
      } else {
        setActionError(data.message || 'Failed to update status');
      }
    } catch (err) {
      setActionError('Error: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const formatCurrency = (cents, currency) => {
    if (cents == null) return '-';
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(cents / 100);
    } catch {
      return `${(cents / 100).toFixed(2)} ${currency || ''}`;
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="min-h-screen pb-12">
      <div className="max-w-7xl mx-auto space-y-8">

        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Payment Proofs</h1>
            <p className="text-gray-600 mt-1">Review and verify paid organization signups awaiting confirmation</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <StatCard icon={<Clock />} title="Awaiting Verification" value={proofs.length} color="from-amber-500 to-amber-600" />
          <StatCard icon={<DollarSign />} title="Total Pending" value={proofs.length} color="from-indigo-500 to-indigo-600" />
        </div>

        <div className="bg-white rounded-2xl shadow-md border p-5">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by organization, plan, payment reference or email..."
              className="w-full pl-12 pr-5 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100/70">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Reference</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Plan</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Organization</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Admin Email</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Expected Amount</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Started</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={7} className="py-20 text-center">Loading…</td></tr>
                ) : filteredProofs.length === 0 ? (
                  <tr><td colSpan={7} className="py-20 text-center text-gray-500">No payments awaiting verification</td></tr>
                ) : (
                  filteredProofs.map(proof => (
                    <tr key={proof._id} className="hover:bg-indigo-50/30 transition-colors">
                      <td className="px-6 py-5 font-mono text-sm text-gray-700">{proof.payment_reference}</td>
                      <td className="px-6 py-5 font-medium text-gray-900">{proof.plan_name}</td>
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-2">
                          <Building2 size={16} className="text-gray-500" />
                          <span>{proof.organization?.name || proof.organization_code || '-'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-gray-600">{proof.admin?.email || '-'}</td>
                      <td className="px-6 py-5 font-medium text-indigo-700">{formatCurrency(proof.expected_amount_cents, proof.expected_currency)}</td>
                      <td className="px-6 py-5 text-gray-600">{formatDate(proof.createdAt)}</td>
                      <td className="px-6 py-5 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <Button variant="outline" size="sm" className="border-green-200 text-green-700 hover:bg-green-50" onClick={() => openAccept(proof)}>
                            <CheckCircle className="mr-1.5 h-4 w-4" /> Accept
                          </Button>
                          <Button variant="outline" size="sm" className="border-red-200 text-red-700 hover:bg-red-50" onClick={() => openReject(proof)}>
                            <XCircle className="mr-1.5 h-4 w-4" /> Reject
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

        <Dialog open={confirmDialog.open} onOpenChange={(o) => setConfirmDialog(prev => ({ ...prev, open: o }))}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {confirmDialog.action === 'accept' ? (
                  <CheckCircle className="text-green-600" size={24} />
                ) : (
                  <AlertTriangle className="text-red-600" size={24} />
                )}
                {confirmDialog.action === 'accept' ? 'Confirm Payment & Provision Organization' : 'Reject Payment Signup'}
              </DialogTitle>
              <DialogDescription className="pt-2">
                {confirmDialog.action === 'accept'
                  ? 'Confirm the transaction in Tilopay\'s own dashboard first, then record what you verified here. The organization is only created once you submit this.'
                  : 'This signup will be marked as failed and the organization will not be provisioned.'}
              </DialogDescription>
            </DialogHeader>

            {confirmDialog.proof && (
              <div className="p-4 bg-gray-50 rounded-lg text-sm space-y-1">
                <div className="font-medium">{confirmDialog.proof.organization?.name}</div>
                <div className="text-gray-600">{confirmDialog.proof.plan_name} · {formatCurrency(confirmDialog.proof.expected_amount_cents, confirmDialog.proof.expected_currency)}</div>
              </div>
            )}

            {actionError && (
              <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2">{actionError}</div>
            )}

            {confirmDialog.action === 'accept' ? (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="evidence">Evidence reference (Tilopay transaction ID) *</Label>
                  <Input id="evidence" value={approveForm.evidence_reference}
                    onChange={e => setApproveForm(f => ({ ...f, evidence_reference: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="amount">Verified amount (cents) *</Label>
                    <Input id="amount" type="number" value={approveForm.verified_amount_cents}
                      onChange={e => setApproveForm(f => ({ ...f, verified_amount_cents: e.target.value }))} />
                  </div>
                  <div>
                    <Label htmlFor="currency">Currency *</Label>
                    <Input id="currency" value={approveForm.verified_currency}
                      onChange={e => setApproveForm(f => ({ ...f, verified_currency: e.target.value.toUpperCase() }))} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="note">Note (optional)</Label>
                  <Input id="note" value={approveForm.note}
                    onChange={e => setApproveForm(f => ({ ...f, note: e.target.value }))} />
                </div>
              </div>
            ) : (
              <div>
                <Label htmlFor="reject-note">Reason (optional)</Label>
                <Input id="reject-note" value={rejectNote} onChange={e => setRejectNote(e.target.value)} />
              </div>
            )}

            <DialogFooter className="gap-3 mt-6">
              <Button variant="outline" onClick={() => setConfirmDialog({ open: false, proof: null, action: null })} disabled={submitting}>
                Cancel
              </Button>
              <Button variant={confirmDialog.action === 'accept' ? "default" : "destructive"} onClick={handleStatusUpdate} disabled={submitting}>
                {submitting ? 'Working…' : confirmDialog.action === 'accept' ? 'Confirm & Provision' : 'Reject'}
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
