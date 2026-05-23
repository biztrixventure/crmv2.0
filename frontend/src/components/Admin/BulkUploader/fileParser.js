import * as XLSX from 'xlsx';

/**
 * Parse a CSV or .xlsx file fully in the browser.
 * Returns { headers: string[], rows: object[] } where each row is keyed by header.
 * raw:false → cells come back as display strings (dates already formatted).
 */
export async function parseFile(file) {
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(buf, { type: 'array', cellDates: false });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { headers: [], rows: [] };

  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
  // Header row even if there are zero data rows.
  const headerRow = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0 })[0] || [];
  const headers = rows.length ? Object.keys(rows[0]) : headerRow.map(String);

  // Drop fully-empty rows.
  const clean = rows.filter(r => Object.values(r).some(v => String(v ?? '').trim() !== ''));
  return { headers, rows: clean };
}

export const ACCEPTED_EXT = ['.csv', '.xlsx', '.xls'];
// Guard against a browser-hanging parse of an oversized workbook.
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export function isAcceptedFile(file) {
  const name = (file?.name || '').toLowerCase();
  return ACCEPTED_EXT.some(ext => name.endsWith(ext));
}

// Flag headers that will confuse mapping: blank cells (XLSX names them
// "__EMPTY", "__EMPTY_1", …) and case-insensitive duplicates.
export function headerWarnings(headers = []) {
  const blank = headers.filter(h => !String(h).trim() || /^__EMPTY/i.test(String(h)));
  const seen = new Set(), dups = new Set();
  headers.forEach(h => {
    const k = String(h).trim().toLowerCase();
    if (!k) return;
    if (seen.has(k)) dups.add(h); else seen.add(k);
  });
  return { blank, dups: [...dups] };
}
