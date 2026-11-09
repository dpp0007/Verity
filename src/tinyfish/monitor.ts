import { z } from 'zod';
import { tfRequest, urls } from './client';
import { TinyFishError } from './errors';

const MonitorObj = z.object({
  id: z.string(),
  type: z.enum(['fetch', 'search']),
  status: z.enum(['creating', 'active', 'paused', 'failed', 'cancelled']),
  schedule_cron: z.string(),
  config: z.record(z.unknown()),
  webhook_url: z.string().nullable().optional(),
  last_error: z.string().nullable().optional(),
});
export type ProviderMonitor = z.infer<typeof MonitorObj>;

const PageResult = z.object({ url: z.string(), final_url: z.string().optional(), text: z.unknown().nullable().optional() });
export const MonitorRunSchema = z.object({
  id: z.string(),
  is_baseline: z.boolean().optional(),
  results: z.array(PageResult).default([]),
  errors: z.array(z.object({ url: z.string(), error: z.string(), status: z.number().optional() })).default([]),
});
export type ProviderRun = z.infer<typeof MonitorRunSchema>;

const parse = <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, v: unknown, what: string): T => {
  const r = schema.safeParse(v);
  if (!r.success) throw new TinyFishError('malformed', `${what} response failed validation`);
  return r.data;
};
// The docs do not show the PATCH/GET body explicitly; accept either a bare monitor or { monitor }.
const unwrap = (v: unknown) => (v && typeof v === 'object' && 'monitor' in v ? (v as { monitor: unknown }).monitor : v);

export interface CreatePageMonitor { name: string; url: string; scheduleCron: string; purpose: string; webhookUrl?: string }

export async function createPageMonitor(c: CreatePageMonitor): Promise<{ monitor: ProviderMonitor; baseline: ProviderRun }> {
  // retries: 0 - a retried POST could create a second monitor if the first response was lost.
  const { data } = await tfRequest(urls().agent, '/v1/monitors', {
    method: 'POST', retries: 0, timeoutMs: 120_000,
    body: {
      type: 'fetch', name: c.name.slice(0, 100), config: { url: c.url, format: 'markdown' },
      schedule_cron: c.scheduleCron, purpose: c.purpose.slice(0, 2000), ...(c.webhookUrl ? { webhook_url: c.webhookUrl } : {}),
    },
  });
  const d = parse(z.object({ monitor: MonitorObj, run: MonitorRunSchema }), data, 'Monitor create');
  return { monitor: d.monitor, baseline: d.run };
}

export const getMonitor = async (id: string) => parse(MonitorObj, unwrap((await tfRequest(urls().agent, `/v1/monitors/${encodeURIComponent(id)}`)).data), 'Monitor get');

export async function setMonitorStatus(id: string, status: 'active' | 'paused'): Promise<ProviderMonitor> {
  // Status is sent alone; the docs warn against combining it with other fields.
  const { data } = await tfRequest(urls().agent, `/v1/monitors/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status }, retries: 1 });
  return parse(MonitorObj, unwrap(data), 'Monitor update');
}

export async function deleteMonitor(id: string): Promise<void> {
  try {
    await tfRequest(urls().agent, `/v1/monitors/${encodeURIComponent(id)}`, { method: 'DELETE', retries: 1 });
  } catch (e) {
    if (e instanceof TinyFishError && e.kind === 'not_found') return; // already gone at the provider
    throw e;
  }
}

export async function runMonitorNow(id: string): Promise<ProviderRun> {
  const { data } = await tfRequest(urls().agent, `/v1/monitors/${encodeURIComponent(id)}/runs`, { method: 'POST', retries: 1, timeoutMs: 120_000 });
  return parse(z.object({ run: MonitorRunSchema }), data, 'Monitor run').run;
}
