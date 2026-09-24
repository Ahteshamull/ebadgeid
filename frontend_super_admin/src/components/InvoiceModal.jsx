"use client";

import { useRef } from "react";
import { useReactToPrint } from "react-to-print";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";
import { transactionAmountCents, transactionCurrency, formatMoney, downloadInvoicePDF } from "@/lib/transactionDocuments";

// Real invoice view for a single transaction (a completed/failed/expired
// PendingOrgSignup) -- print and PDF download both operate on real fields
// already fetched from the backend, no separate invoice endpoint needed
// since every field an invoice needs (organization, plan, amount, date,
// reference) is already on the record the Transactions table renders.
export default function InvoiceModal({ transaction, onClose }) {
  const printRef = useRef(null);
  const handlePrint = useReactToPrint({ contentRef: printRef, documentTitle: `invoice-${transaction?.payment_reference || transaction?._id || ""}` });

  if (!transaction) return null;

  const amount = transactionAmountCents(transaction);
  const currency = transactionCurrency(transaction);
  const org = transaction.organization || {};
  const issueDate = transaction.createdAt ? new Date(transaction.createdAt) : new Date();

  return (
    <Dialog open={!!transaction} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Invoice — {transaction.payment_reference || transaction._id}</DialogTitle>
        </DialogHeader>

        <div ref={printRef} className="bg-white text-gray-900 p-6 rounded-lg border">
          <div className="flex justify-between items-start border-b pb-4 mb-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">INVOICE</h2>
              <p className="text-sm text-gray-500">eBadge ID — Tara Solutions</p>
            </div>
            <div className="text-right text-sm">
              <p><span className="text-gray-500">Invoice #:</span> {transaction.payment_reference || transaction._id}</p>
              <p><span className="text-gray-500">Date:</span> {issueDate.toLocaleDateString('en-US')}</p>
              <p><span className="text-gray-500">Status:</span> <span className="font-semibold uppercase">{transaction.status}</span></p>
            </div>
          </div>

          <div className="mb-4">
            <p className="text-xs font-semibold uppercase text-gray-500 mb-1">Bill To</p>
            <p className="font-medium">{org.name || '(organization name not provided)'}</p>
            {(org.city || org.state || org.country) && (
              <p className="text-sm text-gray-600">{[org.city, org.state, org.country].filter(Boolean).join(', ')}</p>
            )}
            {org.email && <p className="text-sm text-gray-600">{org.email}</p>}
            {org.phone && <p className="text-sm text-gray-600">{org.phone}</p>}
          </div>

          <table className="w-full text-sm border-t border-b">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-2">Description</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t">
                <td className="py-3">{transaction.plan_name || 'Subscription plan'}</td>
                <td className="py-3 text-right">{formatMoney(amount, currency)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t font-semibold">
                <td className="py-3">Total</td>
                <td className="py-3 text-right">{formatMoney(amount, currency)}</td>
              </tr>
            </tfoot>
          </table>

          <p className="text-xs text-gray-400 mt-4">
            This invoice reflects a manually verified self-service signup payment.
            {transaction.manual_verification?.evidence_reference && (
              <> Payment evidence reference: {transaction.manual_verification.evidence_reference}.</>
            )}
          </p>
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <Button type="button" variant="outline" onClick={() => downloadInvoicePDF(transaction)}>
            <Download className="mr-2 h-4 w-4" />
            Download PDF
          </Button>
          <Button type="button" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
