// src/lib/exporters.js
//
// One shared implementation of "download this table" for every page.
//
// Before this, each page that could export had its own copy of the same
// twenty lines (users/page.js built a workbook by hand, transactions had
// its own, and the Super Admin tables had none at all), which is how the
// three ended up with different column formatting and different file
// naming for the same kind of data. Centralizing it is what actually
// keeps the exports consistent between Admin and Super Admin, rather than
// asking each page to remember the same conventions.
//
// Every function here takes the rows the CALLER already has on screen --
// after its filters, its search and its date range. That is deliberate:
// the export must reflect exactly what the user is looking at, and it
// inherits the caller's tenant scoping for free, because those rows came
// from an API call the backend already authorized. No exporter here ever
// fetches data of its own, so none of them can widen what the user is
// allowed to see.
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

const stamp = () => new Date().toISOString().slice(0, 10);

// `columns` is [{ header, key, format? }] -- an explicit projection
// instead of dumping raw API objects, so an export can never leak an
// internal field (ids, hashes, nested admin objects) that merely happened
// to be in the response payload.
const projectRows = (rows, columns) => rows.map((row) => {
  const out = {};
  for (const column of columns) {
    const raw = typeof column.key === 'function' ? column.key(row) : row[column.key];
    out[column.header] = column.format ? column.format(raw, row) : (raw ?? '');
  }
  return out;
});

export function exportToExcel(rows, columns, { filename, sheetName = 'Sheet1' } = {}) {
  const data = projectRows(rows, columns);
  const worksheet = XLSX.utils.json_to_sheet(data);
  // Width the columns to their header so the file opens readable rather
  // than with everything collapsed into the default width.
  worksheet['!cols'] = columns.map((c) => ({ wch: Math.max(12, String(c.header).length + 4) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, filename || `export-${stamp()}.xlsx`);
}

export function exportToCSV(rows, columns, { filename } = {}) {
  const data = projectRows(rows, columns);
  const headers = columns.map((c) => c.header);
  const csv = [headers, ...data.map((r) => headers.map((h) => r[h]))]
    .map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || `export-${stamp()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export async function exportToPDF(rows, columns, { filename, title = 'Report', subtitle } = {}) {
  const { jsPDF, autoTable } = await cargarPdf();
  const doc = new jsPDF({ orientation: columns.length > 5 ? 'landscape' : 'portrait' });
  doc.setFontSize(16);
  doc.text(title, 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(subtitle || `Generated ${new Date().toLocaleString('en-US')} — ${rows.length} record(s)`, 14, 22);

  const data = projectRows(rows, columns);
  const headers = columns.map((c) => c.header);
  autoTable(doc, {
    startY: 28,
    head: [headers],
    body: data.map((r) => headers.map((h) => r[h])),
    headStyles: { fillColor: [79, 70, 229] },
    styles: { fontSize: 9 },
  });
  doc.save(filename || `export-${stamp()}.pdf`);
}
