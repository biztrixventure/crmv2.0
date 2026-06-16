// Shared CSV helpers for batch export. A downloaded batch is a re-uploadable CSV
// in the same column shape the uploader expects, so a deleted batch can be
// restored by re-uploading the file.

const esc = (c) => `"${String(c ?? '').replace(/"/g, '""')}"`;

// headers: string[], rows: array of value-arrays aligned to headers.
export function toCsv(headers, rows) {
  return [headers, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
}

// Trigger a browser download of a CSV string.
export function downloadCsv(csv, filename) {
  // Prepend a BOM so Excel opens UTF-8 correctly (accents, etc.).
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Derive a friendly .csv name from the original batch file name.
export function exportFileName(original) {
  const base = String(original || 'batch').replace(/\.(csv|xlsx?|xls)$/i, '').trim() || 'batch';
  return `${base} (export).csv`;
}
