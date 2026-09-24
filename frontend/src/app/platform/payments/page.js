'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
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
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { CreditCard, CheckCircle2, XCircle, ShieldAlert, Building2, Mail, Clock } from 'lucide-react';
import { toast } from 'sonner';

// Built to complete the manual-review payment flow: a Tilopay hosted-
// payment-page return never provisions an organization by itself (a
// browser redirect is not proof of a captured payment -- see
// services/selfServiceSignup.js's handleTilopayReturn), so a paid
// self-signup sits at awaiting_verification until a platform_admin
// confirms the transaction in Tilopay's own dashboard and approves it
// here. Without this page the API existed but had no UI -- an admin would
// have had to call these endpoints by hand (see PRODUCTION_RUNBOOK.md
// section 3.f).
const centsToDisplay = (cents) => (typeof cents === 'number' ? (cents / 100).toFixed(2) : '—');

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function PaymentApprovalsPage() {
  const { session, loading: sessionLoading } = useSession();
  const [pending, setPending] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const [approveTarget, setApproveTarget] = useState(null);
  const [approveForm, setApproveForm] = useState({ evidence_reference: '', verified_amount: '', verified_currency: '', note: '' });
  const [approveSubmitting, setApproveSubmitting] = useState(false);

  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  const fetchPending = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await apiFetch('/organizations/self-signup/pending');
      if (!response.ok) throw new Error(`Error fetching pending signups: ${response.status}`);
      const result = await response.json();
      setPending(result.pending || []);
    } catch (err) {
      console.error('Failed to fetch pending signups:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionLoading) return;
    fetchPending();
  }, [sessionLoading, fetchPending]);

  const openApprove = (item) => {
    setApproveTarget(item);
    setApproveForm({
      evidence_reference: '',
      verified_amount: item.expected_amount_cents != null ? centsToDisplay(item.expected_amount_cents) : '',
      verified_currency: item.expected_currency || 'USD',
      note: '',
    });
  };

  const submitApprove = async () => {
    if (!approveTarget) return;
    const amountNumber = Number(approveForm.verified_amount);
    if (!approveForm.evidence_reference.trim()) {
      toast.error('Evidence reference is required — the Tilopay transaction id or reference you confirmed in their dashboard.');
      return;
    }
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      toast.error('Enter the real verified amount (in dollars) exactly as captured in Tilopay.');
      return;
    }
    setApproveSubmitting(true);
    try {
      const response = await apiFetch(`/organizations/self-signup/pending/${approveTarget._id}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          evidence_reference: approveForm.evidence_reference.trim(),
          verified_amount_cents: Math.round(amountNumber * 100),
          verified_currency: approveForm.verified_currency.trim().toUpperCase(),
          note: approveForm.note.trim() || undefined,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.message || `Approval failed (${response.status})`);
      }
      toast.success(`Organization provisioned: ${result.organization_code}`);
      setApproveTarget(null);
      fetchPending();
    } catch (err) {
      toast.error(err.message || 'Failed to approve this signup');
    } finally {
      setApproveSubmitting(false);
    }
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    setRejectSubmitting(true);
    try {
      const response = await apiFetch(`/organizations/self-signup/pending/${rejectTarget._id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ note: rejectNote.trim() || undefined }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.message || `Rejection failed (${response.status})`);
      }
      toast.success('Signup rejected — no organization was provisioned.');
      setRejectTarget(null);
      setRejectNote('');
      fetchPending();
    } catch (err) {
      toast.error(err.message || 'Failed to reject this signup');
    } finally {
      setRejectSubmitting(false);
    }
  };

  const notPlatformAdmin = !sessionLoading && session && session.role !== 'platform_admin';

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">
            Payment Approvals
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Paid self-signups never provision from the Tilopay return redirect alone — confirm the transaction in
            Tilopay's own dashboard first, then approve or reject here.
          </p>
        </div>

        {notPlatformAdmin && (
          <Card className="border-amber-500/20 bg-amber-500/10">
            <CardContent className="p-4 flex items-center gap-3">
              <ShieldAlert className="h-5 w-5 text-amber-500 flex-shrink-0" />
              <p className="text-sm text-amber-600 dark:text-amber-400">
                This page is only usable by a platform_admin. The list below and any approve/reject action will be
                rejected by the API if your session doesn't have that role.
              </p>
            </CardContent>
          </Card>
        )}

        <Card className="bg-card border-border shadow-sm overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-xl flex items-center gap-2 text-foreground">
              <CreditCard className="h-5 w-5 text-primary" />
              Awaiting verification
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {pending.length} signup{pending.length === 1 ? '' : 's'} waiting on a manual payment check
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {error && (
              <div className="p-6 text-sm text-red-600">Failed to load pending signups: {error}</div>
            )}
            {!error && isLoading && (
              <div className="p-6 text-sm text-muted-foreground">Loading…</div>
            )}
            {!error && !isLoading && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50 border-b border-border">
                    <TableRow className="border-b border-border">
                      <TableHead className="text-muted-foreground font-medium">Organization</TableHead>
                      <TableHead className="text-muted-foreground font-medium">Admin contact</TableHead>
                      <TableHead className="text-muted-foreground font-medium">Plan</TableHead>
                      <TableHead className="text-muted-foreground font-medium">Expected</TableHead>
                      <TableHead className="text-muted-foreground font-medium">Reference</TableHead>
                      <TableHead className="text-muted-foreground font-medium">Requested</TableHead>
                      <TableHead className="text-muted-foreground font-medium text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.map((item) => (
                      <TableRow key={item._id} className="border-b border-border hover:bg-muted/40 transition-colors align-top">
                        <TableCell>
                          <div className="flex items-center gap-1 font-medium text-foreground">
                            <Building2 className="h-3 w-3 text-muted-foreground" />
                            {item.organization?.name || '—'}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {[item.organization?.city, item.organization?.country].filter(Boolean).join(', ')}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm text-foreground">
                            <Mail className="h-3 w-3 text-muted-foreground" />
                            {item.admin?.email || '—'}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {[item.admin?.first_name, item.admin?.last_name].filter(Boolean).join(' ')}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{item.plan_name}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-foreground">
                          {centsToDisplay(item.expected_amount_cents)} {item.expected_currency}
                        </TableCell>
                        <TableCell>
                          <code className="text-xs bg-muted text-foreground px-2 py-1 rounded border border-border">{item.payment_reference}</code>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {formatDate(item.createdAt)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8" onClick={() => openApprove(item)}>
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Approve
                            </Button>
                            <Button size="sm" variant="destructive" className="text-xs h-8 text-white" onClick={() => setRejectTarget(item)}>
                              <XCircle className="h-3 w-3 mr-1" />
                              Reject
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {!error && !isLoading && pending.length === 0 && (
              <div className="text-center py-12">
                <CreditCard className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">Nothing waiting on you</h3>
                <p className="text-muted-foreground text-sm">No paid self-signups are currently awaiting verification.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Approve dialog */}
      <Dialog open={!!approveTarget} onOpenChange={(open) => !open && setApproveTarget(null)}>
        <DialogContent className="sm:max-w-md bg-card border-border text-card-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
              Approve {approveTarget?.organization?.name}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Only confirm this after checking the real transaction in Tilopay's dashboard. The amount/currency you
              enter must match exactly what was quoted (
              {approveTarget ? `${centsToDisplay(approveTarget.expected_amount_cents)} ${approveTarget.expected_currency}` : ''}
              ) or the API will reject the approval.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Evidence reference (Tilopay transaction id)</label>
              <Input
                value={approveForm.evidence_reference}
                onChange={(e) => setApproveForm((f) => ({ ...f, evidence_reference: e.target.value }))}
                placeholder="e.g. TILOPAY-TXN-000123"
                className="bg-background border-input text-foreground"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Verified amount</label>
                <Input
                  type="number"
                  step="0.01"
                  value={approveForm.verified_amount}
                  onChange={(e) => setApproveForm((f) => ({ ...f, verified_amount: e.target.value }))}
                  className="bg-background border-input text-foreground"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Currency</label>
                <Input
                  value={approveForm.verified_currency}
                  onChange={(e) => setApproveForm((f) => ({ ...f, verified_currency: e.target.value }))}
                  className="bg-background border-input text-foreground"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Note (optional)</label>
              <Textarea
                value={approveForm.note}
                onChange={(e) => setApproveForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Any context worth keeping on the audit trail"
                className="bg-background border-input text-foreground"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)} disabled={approveSubmitting} className="border-border">
              Cancel
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold" onClick={submitApprove} disabled={approveSubmitting}>
              {approveSubmitting ? 'Approving…' : 'Approve and provision'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject confirmation */}
      <AlertDialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <AlertDialogContent className="bg-card border-border text-card-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <XCircle className="h-5 w-5" />
              Reject {rejectTarget?.organization?.name}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This marks the signup as failed. No organization will be provisioned, and this cannot be undone from
              this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="Optional note (e.g. no matching transaction found in Tilopay)"
            className="bg-background border-input text-foreground"
          />
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRejectNote('')} className="border-border hover:bg-muted text-foreground">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={submitReject} disabled={rejectSubmitting} className="bg-red-600 hover:bg-red-700">
              {rejectSubmitting ? 'Rejecting…' : 'Reject signup'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
