// The columns a bulk-issue CSV can use — see parseBulkRecipients below.
// Order doesn't matter (matched by header name, not position); any subset
// is fine as long as either `username` or `email` is present per row.
export const BULK_CSV_COLUMNS = ['username', 'first_name', 'last_name', 'email', 'designation', 'city'];

// What real spreadsheets actually call these columns. Header matching used
// to be exact-string only, which meant a file exported from a Spanish
// system ("nombre,apellido,correo") matched nothing, fell through to the
// legacy one-username-per-line branch, and turned every entire CSV LINE
// into a username -- issuing a batch of nonsense credentials that consumed
// real plan quota, with no error shown anywhere. Aliases fix the common
// cases; detectCsvColumns below reports what it could not match so the
// admin can map the rest by hand instead of the file being misread.
export const BULK_CSV_COLUMN_ALIASES = {
  username: ['username', 'user', 'user name', 'usuario', 'account', 'cuenta', 'login', 'id'],
  first_name: ['first name', 'firstname', 'first', 'nombre', 'nombres', 'given name', 'name'],
  last_name: ['last name', 'lastname', 'last', 'apellido', 'apellidos', 'surname', 'family name'],
  email: ['email', 'e mail', 'mail', 'correo', 'correo electronico', 'email address', 'direccion de correo'],
  designation: ['designation', 'title', 'role', 'cargo', 'puesto', 'rol'],
  city: ['city', 'ciudad', 'localidad', 'town', 'municipio'],
};

// Case, accents, and the punctuation people separate words with
// ("First_Name", "first-name", "Primer Nombre") all normalize away, so
// header matching does not hinge on exactly how a spreadsheet spelled it.
export function normalizeHeader(header) {
  return String(header ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Maps a CSV's header cells onto this system's columns.
// Returns { mapping, unmapped, recognized } where `mapping` is
// { column: cellIndex }, `unmapped` lists the header cells nothing matched
// (shown to the admin so they can map them by hand), and `recognized` says
// whether this line is a header at all.
//
// First alias wins: if two cells both look like `first_name`, the earlier
// one is used rather than the later silently overwriting it.
export function detectCsvColumns(headerCells) {
  const normalized = headerCells.map(normalizeHeader);
  const mapping = {};
  const claimed = new Set();

  for (const column of BULK_CSV_COLUMNS) {
    const aliases = BULK_CSV_COLUMN_ALIASES[column] || [column];
    for (let i = 0; i < normalized.length; i++) {
      if (claimed.has(i)) continue;
      if (aliases.includes(normalized[i])) {
        mapping[column] = i;
        claimed.add(i);
        break;
      }
    }
  }

  const unmapped = headerCells.filter((_, i) => !claimed.has(i) && String(headerCells[i]).trim() !== '');
  return { mapping, unmapped, recognized: Object.keys(mapping).length > 0 };
}

// Minimal CSV field splitter — handles double-quoted fields (so a value
// like a city with a comma in it, "San Francisco, CA", survives) and
// doubled-quote escaping ("" inside a quoted field becomes one "). Not a
// full RFC 4180 parser, but covers what a spreadsheet export actually
// produces for the columns this form asks for.
export function splitCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; } else inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map((v) => v.trim());
}

// Parses a bulk-issue file into { achiever_username, guest_recipient? }
// objects. Two formats, auto-detected — this is what keeps the plain
// "one username per line" files everyone already has working exactly as
// before:
//   1. No recognized header on the first line -> legacy format, one
//      username per line, same as this form has always accepted.
//   2. First line contains a recognized column name (see BULK_CSV_COLUMNS)
//      -> header-driven CSV. A row with `username` filled in is treated as
//      an existing account; a row with no username but a real `email` is
//      issued as a guest recipient (see credentialController.createCredential)
//      — the two can be mixed freely in the same file.
export function parseBulkRecipients(rawText, { mapping: mappingOverride } = {}) {
  const lines = rawText.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim());
  if (lines.length === 0) return { recipients: [], errors: [], header: null, mapping: {}, unmapped: [] };

  const headerCells = splitCsvLine(lines[0]);
  // An explicit mapping from the admin (the column-mapping step in the UI)
  // always wins over detection -- it is the answer to detection having
  // failed, so re-detecting would defeat the point.
  const detected = detectCsvColumns(headerCells);
  const columnIndex = mappingOverride || detected.mapping;
  const isHeader = Boolean(mappingOverride) || detected.recognized;

  if (!isHeader) {
    // A file with several columns per line is a spreadsheet export whose
    // headers this did not recognize -- NOT the legacy one-username-per-
    // line format. Treating it as legacy would make every whole line a
    // username and issue a batch of nonsense, so refuse and hand back the
    // header cells for the admin to map instead.
    if (headerCells.length > 1) {
      return {
        recipients: [],
        errors: ['None of the columns in this file were recognized. Map them to the fields below and try again.'],
        header: headerCells,
        mapping: {},
        unmapped: headerCells.filter((h) => String(h).trim() !== ''),
        needsMapping: true,
      };
    }
    const recipients = lines.map((line) => ({ achiever_username: line.trim() })).filter((r) => r.achiever_username);
    return { recipients, errors: [], header: null, mapping: {}, unmapped: [] };
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const recipients = [];
  const errors = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]);
    const get = (col) => (columnIndex[col] !== undefined ? (values[columnIndex[col]] || '').trim() : '');
    const username = get('username');
    const email = get('email');
    const first_name = get('first_name');
    const last_name = get('last_name');

    if (username) {
      recipients.push({ achiever_username: username });
      continue;
    }
    if (!email) {
      errors.push(`row ${i + 1} has neither a username nor an email`);
      continue;
    }
    if (!emailPattern.test(email)) {
      errors.push(`row ${i + 1}: "${email}" is not a valid email address`);
      continue;
    }
    if (!first_name || !last_name) {
      errors.push(`row ${i + 1} (${email}) needs first_name and last_name to issue without a username`);
      continue;
    }
    recipients.push({
      achiever_username: `${first_name} ${last_name}`.trim(),
      guest_recipient: { email, first_name, last_name, designation: get('designation'), city: get('city') },
    });
  }
  return {
    recipients,
    errors,
    header: headerCells,
    mapping: columnIndex,
    // Header cells nothing was matched to -- surfaced so the UI can offer
    // to map them rather than quietly dropping the data they hold.
    unmapped: mappingOverride ? [] : detected.unmapped,
  };
}
