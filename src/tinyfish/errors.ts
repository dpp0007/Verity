export type TFErrorKind = 'auth' | 'billing' | 'rate_limit' | 'invalid' | 'not_found' | 'conflict' | 'unavailable' | 'timeout' | 'malformed' | 'blocked' | 'agent_failure';

export class TinyFishError extends Error {
  constructor(
    public kind: TFErrorKind,
    message: string,
    public opts: { status?: number; code?: string; requestId?: string; retryAfterMs?: number; providerRunId?: string } = {},
  ) {
    super(message);
  }
  /** Whether repeating the same request may succeed. Billing/auth/invalid are never retryable. */
  get retryable() {
    return ['rate_limit', 'unavailable', 'timeout', 'conflict'].includes(this.kind);
  }
  /** Source-side problems should read as "temporarily unavailable", not as a verification result. */
  get userFacingOutcome(): 'temporarily_unavailable' | 'failed' {
    return ['rate_limit', 'unavailable', 'timeout', 'blocked'].includes(this.kind) ? 'temporarily_unavailable' : 'failed';
  }
}

export function kindFromStatus(status: number, code?: string): TFErrorKind {
  if (status === 401 || (status === 403 && code !== 'FEATURE_NOT_AVAILABLE')) return 'auth';
  if (status === 402) return 'billing';
  if (status === 429) return 'rate_limit';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 422) return 'invalid';
  if (status >= 500) return 'unavailable';
  return 'invalid';
}

/** Maps a run-level error object (HTTP 200 run with status FAILED) to a kind. Matching is case-insensitive. */
export function kindFromRunError(code: string | undefined, category: string | undefined): TFErrorKind {
  const c = (code ?? '').toUpperCase();
  if (c === 'SITE_BLOCKED') return 'blocked';
  if (c === 'TIMEOUT' || c === 'SERVICE_BUSY') return 'timeout';
  if ((category ?? '').toUpperCase() === 'BILLING_FAILURE' || c === 'BILLING_REJECTED') return 'billing';
  if ((category ?? '').toUpperCase() === 'SYSTEM_FAILURE' || (category ?? '').toUpperCase() === 'UNKNOWN') return 'unavailable';
  return 'agent_failure';
}
