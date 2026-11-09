import type { NormalizedRecord } from './schemas';

export interface Change { field: 'status' | 'expiry_date' | 'disciplinary_actions' | 'number'; previous: string | null; next: string | null }

/**
 * Compares two verified records. Unavailable (unknown/null) new values never produce a change:
 * a failed extraction must not look like a status change.
 */
export function detectChanges(prev: NormalizedRecord, next: NormalizedRecord): Change[] {
  const out: Change[] = [];
  if (next.status !== 'unknown' && prev.status !== next.status) {
    out.push({ field: 'status', previous: prev.status, next: next.status });
  }
  if (next.expiry_date && prev.expiry_date !== next.expiry_date) {
    out.push({ field: 'expiry_date', previous: prev.expiry_date, next: next.expiry_date });
  }
  if (next.disciplinary_actions) {
    const seen = new Set((prev.disciplinary_actions ?? []).map((s) => s.trim().toLowerCase()));
    const added = next.disciplinary_actions.filter((s) => !seen.has(s.trim().toLowerCase()));
    if (added.length) {
      out.push({ field: 'disciplinary_actions', previous: prev.disciplinary_actions ? `${prev.disciplinary_actions.length} action(s)` : null, next: added.join(' | ') });
    }
  }
  if (next.number && prev.number && next.number !== prev.number) {
    out.push({ field: 'number', previous: prev.number, next: next.number });
  }
  return out;
}
