/**
 * SIMULATED PROVIDER for automated tests only. It implements the TinyFish contracts documented at
 * docs.tinyfish.ai so Verity's behaviour can be tested offline. Its output is never live registry data.
 */
import { vi } from 'vitest';

export interface Call { method: string; url: string; headers: Record<string, string>; body: any }

export class FakeTinyFish {
  calls: Call[] = [];
  searchHits: Array<{ url: string; title: string }> = [{ url: 'https://search.dca.ca.gov/', title: 'DCA License Search' }];
  searchResult: any = { search_performed: true, no_results: false, candidates: [] };
  detailResult: any = {};
  /** When set, the 2nd and later record reads return this instead (an array gives read 2, read 3, then repeats the last). */
  detailSecond: any | any[] | null = null;
  private detailReads = 0;
  agentFailure: { code: string; category: string; message: string } | null = null;
  agentMalformed = false;
  pageText = '# Record\nStatus: Active\nLicense number: A12345\nExpiration: 03/31/2027';
  fetchError: string | null = null;
  monitorCreate: 'ok' | 'fail' = 'ok';
  monitorStatus = 'active';
  providerMonitorMissing = false;
  runNow: { results: any[]; errors: any[] } = { results: [{ url: 'x', text: 'v1' }], errors: [] };
  sbxRecords: Array<{ cin: string; company_name: string }> = [];
  sbxMaster: any = null;
  sbxAuthFail = false;
  /** Companies House simulation (real page layouts captured 2026-11-03). null = not simulated. */
  chHtml: string | null = null;
  chPages: Record<string, string> | null = null;
  private runs = new Map<string, any>();
  private n = 0;

  install() {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | string, init: RequestInit = {}) => this.handle(new URL(String(input)), init)));
  }
  private nextDetail() {
    const n = ++this.detailReads;
    if (n === 1 || !this.detailSecond) return this.detailResult;
    return Array.isArray(this.detailSecond) ? this.detailSecond[Math.min(n - 2, this.detailSecond.length - 1)] : this.detailSecond;
  }
  reset() {
    this.calls = []; this.detailSecond = null; this.detailReads = 0; this.agentFailure = null; this.agentMalformed = false; this.fetchError = null; this.monitorCreate = 'ok';
    this.monitorStatus = 'active'; this.providerMonitorMissing = false; this.runs.clear();
    this.runNow = { results: [{ url: 'x', text: 'v1' }], errors: [] };
    this.sbxRecords = []; this.sbxMaster = null; this.sbxAuthFail = false; this.chHtml = null; this.chPages = null;
  }
  callsTo(path: string) { return this.calls.filter((c) => new URL(c.url).pathname.startsWith(path)); }

  private json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-request-id': 'req_test' } });
  }
  private monitorObj() {
    return { id: 'tf_mon_1', type: 'fetch', name: 'n', config: { url: 'u', format: 'markdown' }, schedule_cron: '0 6 * * *', status: this.monitorStatus, last_error: null, webhook_url: 'https://verity.test/hook', created_at: '2026-11-03 00:00:00' };
  }

  /** SIMULATED Sandbox MCA API following developer.sandbox.co.in. */
  private sandbox(u: URL, method: string, headers: Record<string, string>, body: any): Response {
    if (u.pathname === '/authenticate') {
      return this.sbxAuthFail || headers['x-api-secret'] !== 'sbx-secret' ? this.json({ message: 'bad credentials' }, 401) : this.json({ access_token: 'tok_1' });
    }
    if (this.sbxAuthFail || headers['Authorization'] !== 'tok_1') return this.json({ message: 'unauthorized' }, 401);
    if (u.pathname === '/kyc/mca/company/master-data/search') {
      if (!this.sbxRecords.length) return this.json({ message: 'Company master data not found' }, 521);
      return this.json({ code: 200, data: { records: this.sbxRecords, limit: 10, offset: 0, count: this.sbxRecords.length, has_more: false } });
    }
    if (u.pathname === '/kyc/mca/company/master-data' && method === 'POST') {
      return this.sbxMaster ? this.json({ code: 200, data: { ...this.sbxMaster, cin: body.cin } }) : this.json({ message: 'Company master data not found' }, 521);
    }
    return this.json({ message: 'unknown' }, 404);
  }

  private handle(u: URL, init: RequestInit): Response {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    const body = init.body ? JSON.parse(String(init.body)) : null;
    const method = init.method ?? 'GET';
    this.calls.push({ method, url: u.toString(), headers, body });
    if (u.hostname === 'api.sandbox.co.in') return this.sandbox(u, method, headers, body);
    if (headers['X-API-Key'] !== 'test-key') return this.json({ error: { code: 'INVALID_API_KEY', message: 'Invalid or expired API key' } }, 401);

    if (u.hostname === 'api.search.tinyfish.ai') {
      return this.json({ query: u.searchParams.get('query'), results: this.searchHits.map((h, i) => ({ position: i + 1, site_name: 'x', snippet: 's', ...h })), total_results: this.searchHits.length, page: 0 });
    }
    if (u.hostname === 'api.fetch.tinyfish.ai') {
      if (this.chPages) {
        const isSearch = body.format === 'html';
        const results: any[] = []; const errors: any[] = [];
        for (const url of body.urls as string[]) {
          if (isSearch) { results.push({ url, final_url: url, title: 't', text: this.chHtml ?? '', format: 'html' }); continue; }
          const n = url.split('/').pop()!;
          if (this.chPages[n]) results.push({ url, final_url: url, title: 't', text: this.chPages[n], format: 'markdown' });
          else errors.push({ url, error: 'page_not_found', status: 404 });
        }
        return this.json({ results, errors });
      }
      if (this.fetchError) return this.json({ results: [], errors: [{ url: body.urls[0], error: this.fetchError }] });
      return this.json({ results: body.urls.map((url: string) => ({ url, final_url: url, title: 't', text: this.pageText, format: 'markdown' })), errors: [] });
    }
    const p = u.pathname;
    if (p === '/v1/automation/run-async') {
      const id = `run_${++this.n}`;
      const isDetail = String(body.goal).includes('Open the single record');
      if (this.agentFailure) this.runs.set(id, { run_id: id, status: 'FAILED', result: null, error: this.agentFailure });
      else if (this.agentMalformed) this.runs.set(id, { run_id: id, status: 'COMPLETED', result: { nonsense: true } });
      else this.runs.set(id, { run_id: id, status: 'COMPLETED', result: isDetail ? this.nextDetail() : this.searchResult, error: null });
      return this.json({ run_id: id, error: null });
    }
    const runGet = p.match(/^\/v1\/runs\/([^/]+)$/);
    if (runGet) return this.json(this.runs.get(runGet[1]) ?? { error: { code: 'NOT_FOUND', message: 'nope' } }, this.runs.has(runGet[1]) ? 200 : 404);
    if (p === '/v1/monitors' && method === 'POST') {
      if (this.monitorCreate === 'fail') return this.json({ error: { code: 'INSUFFICIENT_CREDITS', message: 'wallet empty' } }, 402);
      return this.json({ monitor: this.monitorObj(), run: { id: 'mrun_base', is_baseline: true, results: [{ url: body.config.url, final_url: body.config.url, text: 'v1' }], errors: [] } }, 201);
    }
    if (p.startsWith('/v1/monitors/tf_mon_1')) {
      if (this.providerMonitorMissing) return this.json({ error: { code: 'NOT_FOUND', message: 'Monitor not found' } }, 404);
      if (p.endsWith('/runs')) return this.json({ run: { id: `mrun_${++this.n}`, is_baseline: false, ...this.runNow } }, 201);
      if (method === 'PATCH') { this.monitorStatus = body.status; return this.json(this.monitorObj()); }
      if (method === 'DELETE') return this.json({ deleted: true, id: 'tf_mon_1' });
      return this.json(this.monitorObj());
    }
    return this.json({ error: { code: 'NOT_FOUND', message: 'unknown route ' + p } }, 404);
  }
}
