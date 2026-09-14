// ============================================================================
// utils/moduleExport.js -- every CSV that leaves HR or Accounts.
//
// Goes through the CRM's export log first (egress governance, mig 167): the
// same soft audit and daily export cap as every other client-side export, so
// a balance sheet or a change log never walks out unrecorded. Returns
// { ok: false, error } when the person's daily cap blocks it.
// ============================================================================
import { downloadCSV } from './recordFormat';
import { logClientExport } from './exportSpec';

export async function auditedCSV(dataset, rows, headers, filename, filters) {
  const ok = await logClientExport(dataset, rows.length, filters || null);
  if (!ok) return { ok: false, error: 'You have reached your export limit for today. Ask an admin if you need more.' };
  downloadCSV(rows, headers, filename);
  return { ok: true };
}
