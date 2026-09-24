"use client"
import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Download, DollarSign, CheckCircle, XCircle,
  Clock, AlertCircle, Building2, FileText, FileSpreadsheet, Receipt
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { exportTransactionsExcel, exportTransactionsPDF } from '@/lib/transactionDocuments';
import InvoiceModal from '@/components/InvoiceModal';

// This page used to call GET https://api.ebadgeid.com/api
// /transactions(/export/pdf|/export/excel|/:code/print) -- none of those
// routes, controllers, or a Transaction model exist anywhere in the
// backend (confirmed: no /api/transactions mount in api.js, no matching
// route/controller file). The only real transactional history in this
// system is PendingOrgSignup (completed/failed/expired self-service
// signups) -- the same source Payment Proofs reconciles against for the
// still-pending ones. PDF/Excel export and a real invoice (view, download,
// print) are implemented client-side in lib/transactionDocuments.js and
// components/InvoiceModal.jsx: jsPDF/jspdf-autotable/xlsx were already
// installed (package.json) but never wired to anything. All three operate
// on the exact same rows already fetched from the real backend, so
// nothing here is mocked or sample data.
const STATUS_OPTIONS = ['completed', 'failed', 'expired'];

export default function TransactionsManagement() {
  const [transactions, setTransactions] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [invoiceTarget, setInvoiceTarget] = useState(null);

  const fetchTransactions = useCallback(async (status) => {
    try {
      setLoading(true);
      setError(null);
      const statuses = status ? [status] : STATUS_OPTIONS;
      const results = await Promise.all(statuses.map(async (s) => {
        const res = await apiFetch(`/organizations/self-signup/pending?status=${s}`, { redirectOnUnauthorized: false });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || `Server responded with status ${res.status}`);
        }
        const data = await res.json();
        return data.pending || [];
      }));
      const merged = results.flat().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setTransactions(merged);
    } catch (err) {
      console.error('Fetch transactions error:', err);
      setError(err.message || 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTransactions(statusFilter);
  }, [fetchTransactions, statusFilter]);

  const filteredTransactions = searchQuery.trim()
    ? transactions.filter(t => {
        const q = searchQuery.toLowerCase();
        return (t.payment_reference || '').toLowerCase().includes(q) ||
          (t.plan_name || '').toLowerCase().includes(q) ||
          (t.organization?.name || '').toLowerCase().includes(q);
      })
    : transactions;

  // Real, working export -- a CSV of exactly what's on screen. No PDF/XLSX
  // generation exists on the backend (see comment above), so this is a
  // genuine capability instead of a button wired to a 404.
  const handleExportCSV = () => {
    const header = ['Organization', 'Reference', 'Plan', 'Date', 'Amount', 'Currency', 'Status'];
    const rows = filteredTransactions.map(t => [
      t.organization?.name || '',
      t.payment_reference || '',
      t.plan_name || '',
      t.createdAt ? new Date(t.createdAt).toISOString() : '',
      t.status === 'completed' ? ((t.manual_verification?.verified_amount_cents ?? t.expected_amount_cents) / 100) : (t.expected_amount_cents / 100),
      t.manual_verification?.verified_currency || t.expected_currency || '',
      t.status || '',
    ]);
    const csv = [header, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const formatCurrency = (cents, currency) => {
    if (cents == null) return '-';
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(cents / 100);
    } catch {
      return `${(cents / 100).toFixed(2)} ${currency || ''}`;
    }
  };

  const formatDate = (isoDate) => {
    if (!isoDate) return '—';
    try {
      return new Date(isoDate).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return 'Invalid Date';
    }
  };

  const getStatusStyle = (status) => {
    const map = {
      completed: 'bg-green-100 text-green-800 border-green-200',
      failed: 'bg-red-100 text-red-800 border-red-200',
      expired: 'bg-gray-100 text-gray-800 border-gray-200',
    };
    return map[status] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const stats = {
    totalAmount: transactions.filter(t => t.status === 'completed')
      .reduce((sum, t) => sum + ((t.manual_verification?.verified_amount_cents ?? t.expected_amount_cents) || 0), 0),
    completed: transactions.filter(t => t.status === 'completed').length,
    failed: transactions.filter(t => t.status === 'failed').length,
    expired: transactions.filter(t => t.status === 'expired').length,
  };

  return (
    <div className="min-h-screen pb-12">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Transactions</h1>
            <p className="text-gray-600 mt-1">History of completed, failed, and expired paid signups</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleExportCSV}
              disabled={loading || !!error || filteredTransactions.length === 0}
              className={`px-5 py-3 rounded-xl font-medium transition-all ${
                loading || !!error || filteredTransactions.length === 0
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg hover:shadow-xl'
              }`}
            >
              <Download className="inline mr-2 h-4 w-4" />
              CSV
            </button>
            <button
              onClick={() => exportTransactionsExcel(filteredTransactions)}
              disabled={loading || !!error || filteredTransactions.length === 0}
              className={`px-5 py-3 rounded-xl font-medium transition-all ${
                loading || !!error || filteredTransactions.length === 0
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg hover:shadow-xl'
              }`}
            >
              <FileSpreadsheet className="inline mr-2 h-4 w-4" />
              Excel
            </button>
            <button
              onClick={() => exportTransactionsPDF(filteredTransactions)}
              disabled={loading || !!error || filteredTransactions.length === 0}
              className={`px-5 py-3 rounded-xl font-medium transition-all ${
                loading || !!error || filteredTransactions.length === 0
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-rose-600 text-white hover:bg-rose-700 shadow-lg hover:shadow-xl'
              }`}
            >
              <FileText className="inline mr-2 h-4 w-4" />
              PDF
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-6 py-4 rounded-xl flex items-center gap-3">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <div><strong>Error:</strong> {error}</div>
          </div>
        )}

        {!error && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <StatCard icon={<DollarSign />} title="Verified Total" value={formatCurrency(stats.totalAmount, 'USD')} color="from-indigo-500 to-indigo-600" />
            <StatCard icon={<CheckCircle />} title="Completed" value={stats.completed} color="from-green-500 to-green-600" />
            <StatCard icon={<XCircle />} title="Failed" value={stats.failed} color="from-red-500 to-red-600" />
            <StatCard icon={<Clock />} title="Expired" value={stats.expired} color="from-gray-500 to-gray-600" />
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-md border p-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative md:col-span-2">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by organization, reference, or plan..."
                className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
            >
              <option value="">All Statuses</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="expired">Expired</option>
            </select>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead className="bg-gray-100/70">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Organization</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Reference</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Plan</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Amount</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Invoice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={7} className="py-20 text-center text-gray-500">Loading transactions...</td></tr>
                ) : filteredTransactions.length === 0 ? (
                  <tr><td colSpan={7} className="py-20 text-center text-gray-500">No transactions found</td></tr>
                ) : (
                  filteredTransactions.map((t) => (
                    <tr key={t._id} className="hover:bg-indigo-50/40 transition-colors">
                      <td className="px-6 py-5 text-gray-700">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-gray-400" />
                          <span className="font-medium">{t.organization?.name || 'N/A'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-5 font-mono text-sm text-gray-700">{t.payment_reference || '—'}</td>
                      <td className="px-6 py-5 text-gray-600">{t.plan_name || '—'}</td>
                      <td className="px-6 py-5 text-gray-600 text-sm">{formatDate(t.createdAt)}</td>
                      <td className="px-6 py-5 font-medium text-indigo-700">
                        {formatCurrency(t.manual_verification?.verified_amount_cents ?? t.expected_amount_cents, t.manual_verification?.verified_currency || t.expected_currency)}
                      </td>
                      <td className="px-6 py-5">
                        <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium border ${getStatusStyle(t.status)}`}>
                          {t.status || 'Unknown'}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <button
                          onClick={() => setInvoiceTarget(t)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors"
                        >
                          <Receipt className="h-4 w-4" />
                          Invoice
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <InvoiceModal transaction={invoiceTarget} onClose={() => setInvoiceTarget(null)} />
    </div>
  );
}

function StatCard({ icon, title, value, color }) {
  return (
    <div className={`bg-gradient-to-br ${color} rounded-2xl p-6 text-white shadow-lg transition-transform hover:scale-[1.02]`}>
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
