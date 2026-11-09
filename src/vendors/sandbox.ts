/**
 * Sandbox (sandbox.co.in) MCA company-data API: a LICENSED THIRD-PARTY provider, not the official registry.
 * Contracts taken from developer.sandbox.co.in (read 2026-11-03); NOT yet exercised against a real account.
 */
import { z } from 'zod';
import { TinyFishError, kindFromStatus } from '@/tinyfish/errors';

const base = () => process.env.SANDBOX_API_URL || 'https://api.sandbox.co.in';
export const sandboxConfigured = () => !!(process.env.SANDBOX_API_KEY && process.env.SANDBOX_API_SECRET);

let token: { value: string; exp: number } | null = null;

async function raw(path: string, init: RequestInit = {}): Promise<{ status: number; json: any }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60_000) // multi-word searches took 10-26 s in live tests;
  try {
    const res = await fetch(new URL(path, base()), { ...init, signal: ctl.signal, cache: 'no-store' });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    return { status: res.status, json };
  } catch (e) {
    throw new TinyFishError((e as Error).name === 'AbortError' ? 'timeout' : 'unavailable', 'Could not reach the company-data provider');
  } finally { clearTimeout(timer); }
}

async function accessToken(force = false): Promise<string> {
  if (!force && token && token.exp > Date.now()) return token.value;
  const { status, json } = await raw('/authenticate', { method: 'POST', headers: { 'x-api-key': process.env.SANDBOX_API_KEY!, 'x-api-secret': process.env.SANDBOX_API_SECRET!, 'x-api-version': '1.0' } });
  const t = json?.access_token ?? json?.data?.access_token;
  if (status >= 400 || typeof t !== 'string') throw new TinyFishError([400, 401, 403].includes(status) ? 'auth' : 'unavailable', `The company-data provider (Sandbox) rejected the credentials or is unavailable${json?.message ? `: ${json.message}` : ''}`, { status });
  token = { value: t, exp: Date.now() + 23 * 3600_000 }; // docs: tokens last 24h
  return t;
}

async function call(path: string, method: 'GET' | 'POST', opts: { query?: Record<string, string>; body?: unknown; fresh?: boolean } = {}): Promise<any | null> {
  let transient = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const t = await accessToken(attempt > 0);
    const u = new URL(path, base());
    for (const [k, v] of Object.entries(opts.query ?? {})) u.searchParams.set(k, v);
    const { status, json } = await raw(u.toString(), {
      method, body: opts.body ? JSON.stringify(opts.body) : undefined,
      headers: { Authorization: t, 'x-api-key': process.env.SANDBOX_API_KEY!, 'x-api-version': '1.0', ...(opts.fresh ? { 'x-accept-cache': 'false' } : {}), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (status === 401 && attempt === 0) continue; // expired token: re-authenticate once
    if (status >= 500 && status !== 521 && transient++ < 1) continue; // Sandbox answers 5xx "Endpoint request timed out" intermittently; retry once
    if (status === 521 || status === 404) return null; // documented "Company master data not found"
    if (status >= 400) throw new TinyFishError(kindFromStatus(status), json?.message ?? `Company-data provider HTTP ${status}`, { status });
    return json?.data ?? json;
  }
  throw new TinyFishError('auth', 'The company-data provider rejected the credentials');
}

const Search = z.object({ records: z.array(z.object({ cin: z.string(), company_name: z.string() })).default([]) });
const Master = z.object({
  cin: z.string(), company_name: z.string(), company_status: z.string().nullable().optional(), company_registration_date: z.string().nullable().optional(),
  company_class: z.string().nullable().optional(), registered_office_address: z.string().nullable().optional(), updated_at: z.number().nullable().optional(),
});
export type SandboxCompany = z.infer<typeof Master>;

export async function sandboxSearch(name: string): Promise<Array<{ cin: string; company_name: string }>> {
  if (name.trim().length < 3) throw new TinyFishError('invalid', 'Company name must be at least 3 characters for this registry');
  const d = await call('/kyc/mca/company/master-data/search', 'GET', { query: { company_name: name.trim(), limit: '10' } });
  if (d === null) return [];
  const p = Search.safeParse(d);
  if (!p.success) throw new TinyFishError('malformed', 'Company search response failed validation');
  return p.data.records;
}

export async function sandboxLookup(cin: string): Promise<SandboxCompany | null> {
  const d = await call('/kyc/mca/company/master-data', 'POST', { body: { cin }, fresh: true });
  if (d === null) return null;
  const p = Master.safeParse(Array.isArray(d) ? d[0] : d); // docs show both an object schema and an array example
  if (!p.success) throw new TinyFishError('malformed', 'Company master-data response failed validation');
  return p.data;
}
