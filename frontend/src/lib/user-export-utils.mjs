/**
 * Utility functions for user management report export (Excel & PDF data preparation).
 */

export const USER_EXPORT_COLUMNS = [
  "Username",
  "Name",
  "Designation",
  "Organization",
  "Location",
  "Email",
  "Phone",
  "Status"
];

/**
 * Normalizes user records for export with clean fallbacks for empty or null properties.
 * Handles special characters and compound fields consistently.
 *
 * @param {Array<Object>} users - List of raw user objects from state
 * @returns {Array<Object>} Normalized user records
 */
export function formatUserDataForExport(users = []) {
  if (!Array.isArray(users)) return [];

  return users.map(user => {
    const firstName = user?.first_name || '';
    const lastName = user?.last_name || '';
    const name = `${firstName} ${lastName}`.trim();

    const locationParts = [user?.city, user?.state, user?.country].filter(
      part => typeof part === 'string' && part.trim().length > 0
    );
    const location = locationParts.join(', ');

    return {
      "Username": user?.username || '',
      "Name": name,
      "Designation": user?.designation || '',
      "Organization": user?.organization_code || '',
      "Location": location,
      "Email": user?.email || '',
      "Phone": user?.phone || '',
      "Status": user?.status || ''
    };
  });
}

/**
 * Calculates optimal column widths so Excel columns don't clip text.
 * Constrained between 10 (minimum readable width) and 40 (standard max width).
 *
 * @param {Array<Object>} formattedData - Normalized records
 * @param {Array<string>} columns - Column headers
 * @returns {Array<{wch: number}>} SheetJS column configurations
 */
export function calculateColumnWidths(formattedData = [], columns = USER_EXPORT_COLUMNS) {
  return columns.map(key => {
    let maxContentLen = 0;
    if (Array.isArray(formattedData)) {
      for (const row of formattedData) {
        const val = row[key] !== undefined && row[key] !== null ? String(row[key]).length : 0;
        if (val > maxContentLen) {
          maxContentLen = val;
        }
      }
    }
    const headerLen = key.length;
    const maxLen = Math.max(headerLen, maxContentLen);
    return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
  });
}

/**
 * Generates an XLSX workbook for the given user records.
 *
 * @param {Object} XLSX - SheetJS library instance
 * @param {Array<Object>} users - User list to export
 * @returns {Object} SheetJS workbook instance
 */
export function generateUserExcelWorkbook(XLSX, users = []) {
  if (!XLSX || !XLSX.utils) {
    throw new Error("Invalid XLSX library instance provided to generateUserExcelWorkbook");
  }

  const data = formatUserDataForExport(users);
  const worksheet = data.length > 0
    ? XLSX.utils.json_to_sheet(data)
    : XLSX.utils.aoa_to_sheet([USER_EXPORT_COLUMNS]);

  worksheet['!cols'] = calculateColumnWidths(data, USER_EXPORT_COLUMNS);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Users");
  return workbook;
}
