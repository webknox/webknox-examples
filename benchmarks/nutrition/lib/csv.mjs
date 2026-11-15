// A small RFC 4180 CSV reader: quoted fields, "" inside quotes, commas and line breaks
// inside quotes, CRLF or LF line ends. FoodData Central's CSVs quote every field.

/** Yields each row of `text` as an array of strings. */
export function* csvRows(text) {
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const n = text.length;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // byte order mark
  while (i < n) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      quoted = true;
      i++;
    } else if (c === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (c === '\n' || c === '\r') {
      row.push(field);
      field = '';
      yield row;
      row = [];
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += c;
      i++;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    yield row;
  }
}

/** Yields each data row as an object keyed by the header row. Blank lines are skipped. */
export function* csvRecords(text) {
  let header = null;
  for (const row of csvRows(text)) {
    if (row.length === 1 && row[0] === '') continue;
    if (!header) {
      header = row;
      continue;
    }
    const record = {};
    for (let j = 0; j < header.length; j++) record[header[j]] = row[j] ?? '';
    yield record;
  }
}

/** Quotes one value for a CSV cell when it needs it. */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
