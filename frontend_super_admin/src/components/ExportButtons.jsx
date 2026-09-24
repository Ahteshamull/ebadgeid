"use client";

// One export control used by every table, so Admin and Super Admin get
// the same buttons, in the same order, with the same colours, disabled
// states and empty-data behaviour. Previously each page styled its own,
// which is why the same action looked different depending on where you
// were standing.
//
// It exports exactly the rows it is handed -- the caller passes what is
// currently on screen, after filters/search/date range -- so the file can
// never contain more than the user is already looking at.
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { exportToExcel, exportToCSV, exportToPDF } from "@/lib/exporters";

const base =
  "px-5 py-3 rounded-xl font-medium transition-all inline-flex items-center disabled:cursor-not-allowed";
const disabledLook = "bg-gray-300 text-gray-500";

export default function ExportButtons({
  rows = [],
  columns = [],
  filenameBase = "export",
  title = "Report",
  sheetName = "Sheet1",
  disabled = false,
  show = { csv: true, excel: true, pdf: true },
}) {
  const stamp = new Date().toISOString().slice(0, 10);
  // Nothing to export is a real state, not an error: the buttons stay
  // visible (so the feature is discoverable) but inert.
  const off = disabled || rows.length === 0;

  return (
    <div className="flex flex-wrap gap-3">
      {show.csv && (
        <button
          type="button"
          onClick={() => exportToCSV(rows, columns, { filename: `${filenameBase}-${stamp}.csv` })}
          disabled={off}
          className={`${base} ${off ? disabledLook : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg hover:shadow-xl"}`}
        >
          <Download className="mr-2 h-4 w-4" />
          CSV
        </button>
      )}
      {show.excel && (
        <button
          type="button"
          onClick={() => exportToExcel(rows, columns, { filename: `${filenameBase}-${stamp}.xlsx`, sheetName })}
          disabled={off}
          className={`${base} ${off ? disabledLook : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg hover:shadow-xl"}`}
        >
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Excel
        </button>
      )}
      {show.pdf && (
        <button
          type="button"
          onClick={() => exportToPDF(rows, columns, { filename: `${filenameBase}-${stamp}.pdf`, title })}
          disabled={off}
          className={`${base} ${off ? disabledLook : "bg-rose-600 text-white hover:bg-rose-700 shadow-lg hover:shadow-xl"}`}
        >
          <FileText className="mr-2 h-4 w-4" />
          PDF
        </button>
      )}
    </div>
  );
}
