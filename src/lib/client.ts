'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiFail extends Error {
  constructor(public code: string, message: string, public retryable: boolean, public status: number) { super(message); }
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined, cache: 'no-store' });
  } catch {
    throw new ApiFail('network_error', 'Could not reach the server. Check your connection and retry.', true, 0);
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiFail(body?.error?.code ?? 'error', body?.error?.message ?? `Request failed (${res.status})`, !!body?.error?.retryable, res.status);
  return body as T;
}

/** Polls `fn` until `done(value)` is true. Stops on unmount. */
export function usePoll<T>(fn: () => Promise<T>, done: (v: T) => boolean, ms = 2500) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiFail | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const stop = useRef(false);
  const [epoch, setEpoch] = useState(0);
  const load = useCallback(async () => {
    try { const v = await fnRef.current(); setData(v); setError(null); return v; }
    catch (e) { setError(e as ApiFail); return null; }
  }, []);
  useEffect(() => {
    stop.current = false;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const v = await load();
      if (!stop.current && !(v && done(v))) t = setTimeout(tick, ms);
    };
    tick();
    return () => { stop.current = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ms, epoch]);
  /** Restart polling after an action moved the record back into a running state. */
  return { data, error, reload: load, resume: () => setEpoch((e) => e + 1) };
}

export const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
