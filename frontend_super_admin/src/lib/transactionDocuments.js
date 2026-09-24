// Real CSV export already existed (super_admin/transactions/page.js). PDF
// and Excel export, and a printable/downloadable invoice, did not -- the
// earlier SA-01..SA-06 round removed those 3 buttons rather than leave them
// pointing at backend routes that never existed (see that page's own
// header comment, kept for history). This module is the real
// implementation: jsPDF/jspdf-autotable/xlsx were already installed
// (package.json) but never wired to anything -- all three operate on the
// exact same transaction rows already fetched from the real backend
// (PendingOrgSignup via /organizations/self-signup/pending), so nothing
// here is mocked or sample data.
// jsPDF se carga bajo demanda, no al evaluar el modulo. Su codigo toca
// DOMMatrix, una API de navegador: importado arriba se evalua durante el
// render en servidor y lanza "ReferenceError: DOMMatrix is not defined"
// como unhandledRejection, capaz de tumbar el proceso de Next.
const cargarPdf = async () => {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  return { jsPDF, autoTable };
};
import * as XLSX from 'xlsx';

export const transactionAmountCents = (t) =>
  t.status === 'completed'
    ? (t.manual_verification?.verified_amount_cents ?? t.expected_amount_cents)
    : t.expected_amount_cents;

export const transactionCurrency = (t) =>
  t.manual_verification?.verified_currency || t.expected_currency || 'USD';

export const formatMoney = (cents, currency) => {
  if (cents == null) return '-';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency || ''}`;
  }
};

const transactionRows = (transactions) => transactions.map((t) => ({
  Organization: t.organization?.name || '',
  Reference: t.payment_reference || '',
  Plan: t.plan_name || '',
  Date: t.createdAt ? new Date(t.createdAt).toISOString().slice(0, 10) : '',
  Amount: transactionAmountCents(t) != null ? transactionAmountCents(t) / 100 : '',
  Currency: transactionCurrency(t),
  Status: t.status || '',
}));

// Real .xlsx workbook (SheetJS) -- a genuine binary Excel file, not a
// renamed CSV. json_to_sheet infers column headers from the row objects'
// own keys, so this stays in sync with transactionRows above automatically.
export function exportTransactionsExcel(transactions, filename = `transactions-${new Date().toISOString().slice(0, 10)}.xlsx`) {
  const rows = transactionRows(transactions);
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [{ wch: 28 }, { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Transactions');
  XLSX.writeFile(workbook, filename);
}

// Real PDF (jsPDF + jspdf-autotable v5's `autoTable(doc, options)` free
// function -- the plugin no longer patches doc.autoTable() directly as of
// v4/v5, confirmed against the installed package before writing this).
export async function exportTransactionsPDF(transactions, filename = `transactions-${new Date().toISOString().slice(0, 10)}.pdf`) {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(16);
  doc.text('eBadge ID — Transactions Report', 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Generated ${new Date().toLocaleString('en-US')} — ${transactions.length} record(s)`, 14, 22);

  autoTable(doc, {
    startY: 28,
    head: [['Organization', 'Reference', 'Plan', 'Date', 'Amount', 'Currency', 'Status']],
    body: transactionRows(transactions).map((r) => [r.Organization, r.Reference, r.Plan, r.Date, r.Amount, r.Currency, r.Status]),
    headStyles: { fillColor: [79, 70, 229] },
    styles: { fontSize: 9 },
  });

  doc.save(filename);
}

// A single transaction rendered as a real invoice PDF -- positioned text,
// not a screenshot of the DOM, so the downloaded file stays crisp and
// selectable. buildInvoiceView (InvoiceModal.jsx) renders the on-screen/
// print version of the exact same fields.
export async function downloadInvoicePDF(transaction) {
  const { jsPDF, autoTable } = await cargarPdf();
  const doc = new jsPDF();
  const amount = transactionAmountCents(transaction);
  const currency = transactionCurrency(transaction);
  const invoiceNumber = transaction.payment_reference || transaction._id;
  const issueDate = transaction.createdAt ? new Date(transaction.createdAt) : new Date();

  doc.setFontSize(20);
  doc.setTextColor(30);
  doc.text('INVOICE', 14, 20);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text('eBadge ID — Tara Solutions', 14, 28);

  doc.setTextColor(30);
  doc.setFontSize(11);
  doc.text(`Invoice #: ${invoiceNumber}`, 140, 20);
  doc.text(`Date: ${issueDate.toLocaleDateString('en-US')}`, 140, 26);
  doc.text(`Status: ${(transaction.status || '').toUpperCase()}`, 140, 32);

  doc.setDrawColor(220);
  doc.line(14, 38, 196, 38);

  doc.setFontSize(11);
  doc.setTextColor(60);
  doc.text('Bill To', 14, 48);
  doc.setFontSize(10);
  doc.setTextColor(30);
  const org = transaction.organization || {};
  const billLines = [
    org.name || '(organization name not provided)',
    [org.city, org.state, org.country].filter(Boolean).join(', '),
    org.email || '',
    org.phone || '',
  ].filter(Boolean);
  billLines.forEach((line, i) => doc.text(line, 14, 55 + i * 6));

  const tableStartY = 55 + billLines.length * 6 + 10;
  autoTable(doc, {
    startY: tableStartY,
    head: [['Description', 'Amount']],
    body: [[transaction.plan_name || 'Subscription plan', formatMoney(amount, currency)]],
    headStyles: { fillColor: [79, 70, 229] },
    foot: [['Total', formatMoney(amount, currency)]],
    footStyles: { fillColor: [240, 240, 245], textColor: 20, fontStyle: 'bold' },
  });

  const finalY = doc.lastAutoTable.finalY + 12;
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text('This invoice reflects a manually verified self-service signup payment.', 14, finalY);
  if (transaction.manual_verification?.evidence_reference) {
    doc.text(`Payment evidence reference: ${transaction.manual_verification.evidence_reference}`, 14, finalY + 6);
  }

  doc.save(`invoice-${invoiceNumber}.pdf`);
}
