import { z } from 'zod';
import { sleep, tfRequest, urls } from './client';
import { TinyFishError, kindFromRunError } from './errors';

export interface AgentRunOpts { url: string; goal: string; outputSchema: object; maxSeconds?: number; pollMs?: number; onStart?: (runId: string) => Promise<void> | void }

const Started = z.object({ run_id: z.string().nullable(), error: z.object({ code: z.string().optional(), message: z.string() }).nullable().optional() });
const Run = z.object({
  run_id: z.string(),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']),
  result: z.unknown().nullable().optional(),
  error: z.object({ code: z.string().optional(), message: z.string().optional(), category: z.string().optional() }).nullable().optional(),
});

/**
 * Starts an async run and polls it. We never hold a browser request open: this runs inside a background job.
 * Returns the raw result for the caller to validate with its own schema; run-level failures are thrown.
 */
export async function runAgent(o: AgentRunOpts): Promise<{ runId: string; result: unknown }> {
  const maxSeconds = o.maxSeconds ?? 240;
  const { data } = await tfRequest(urls().agent, '/v1/automation/run-async', {
    method: 'POST',
    body: {
      url: o.url, goal: o.goal, output_schema: o.outputSchema, browser_profile: 'lite',
      agent_config: { max_duration_seconds: maxSeconds },
    },
    timeoutMs: 30_000,
  });
  const started = Started.safeParse(data);
  if (!started.success || !started.data.run_id) {
    throw new TinyFishError('unavailable', started.success ? (started.data.error?.message ?? 'Agent run was not created') : 'Agent start response failed validation');
  }
  const runId = started.data.run_id;
  await o.onStart?.(runId); // persist the provider id immediately so abandoned/timed-out runs stay debuggable
  const deadline = Date.now() + (maxSeconds + 30) * 1000;

  while (Date.now() < deadline) {
    await sleep(o.pollMs ?? Number(process.env.VERITY_AGENT_POLL_MS ?? 3000));
    const { data: raw } = await tfRequest(urls().agent, `/v1/runs/${encodeURIComponent(runId)}`, { query: { screenshots: 'none', html: 'none' }, timeoutMs: 30_000 });
    const run = Run.safeParse(raw);
    if (!run.success) throw new TinyFishError('malformed', 'Agent run response failed validation', { providerRunId: runId });
    const r = run.data;
    if (r.status === 'COMPLETED') {
      if (r.result == null) throw new TinyFishError('malformed', 'Agent run completed without a result', { providerRunId: runId });
      return { runId, result: r.result };
    }
    if (r.status === 'FAILED') {
      throw new TinyFishError(kindFromRunError(r.error?.code, r.error?.category), r.error?.message ?? 'Agent run failed', { code: r.error?.code, providerRunId: runId });
    }
    if (r.status === 'CANCELLED') throw new TinyFishError('agent_failure', 'Agent run was cancelled', { providerRunId: runId });
  }
  // Best-effort cancel so an abandoned run stops consuming credits.
  await tfRequest(urls().agent, `/v1/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', retries: 0 }).catch(() => undefined);
  throw new TinyFishError('timeout', 'Agent run did not finish in time', { providerRunId: runId });
}
