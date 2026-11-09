/**
 * Live proof that TinyFish Monitor sees real change. Points a monitor at a page that updates all day
 * (The Gazette's latest notices, the UK's official public record) and triggers several runs.
 *   npm run monitor-demo            (3 runs, 2 minutes apart)
 *   npm run monitor-demo -- 5 60    (5 runs, 60 seconds apart)
 *   npm run monitor-demo -- 3 60 https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.atom   (a feed that changes every minute)
 * Spends a few credits and deletes the monitor afterwards.
 */
import './loadEnv';
import { createHash } from 'node:crypto';
import { createPageMonitor, deleteMonitor, runMonitorNow } from '@/tinyfish/monitor';

const URL_ = process.argv[4] ?? 'https://www.thegazette.co.uk/all-notices/notice?service=all-notices&sort-by=latest-date';
const runs = Number(process.argv[2] ?? 3), gapSec = Number(process.argv[3] ?? 120);
const text = (r: { results: Array<{ text?: unknown }> }) => r.results.map((x) => (typeof x.text === 'string' ? x.text : '')).join('\n');
const hash = (t: string) => createHash('sha256').update(t.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12);
const head = (t: string) => (/\*\*Publication date\*\*:\s*([^\n]+)/.exec(t)?.[1] ?? '?').trim();

(async () => {
  const { monitor, baseline } = await createPageMonitor({ name: 'Verity demo: live page', url: URL_, scheduleCron: '0 * * * *', purpose: 'Report when the content of this page changes.' });
  let prev = hash(text(baseline));
  console.log(`monitor ${monitor.id} created; baseline ${prev}; newest notice dated ${head(text(baseline))}`);
  try {
    for (let i = 1; i <= runs; i++) {
      await new Promise((r) => setTimeout(r, gapSec * 1000));
      const run = await runMonitorNow(monitor.id);
      const h = hash(text(run));
      console.log(`run ${i}: ${run.errors.length ? `ERROR ${run.errors[0].error}` : h === prev ? 'unchanged' : `CHANGED ${prev} -> ${h}`}  (newest notice ${head(text(run))})`);
      if (!run.errors.length) prev = h;
    }
  } finally {
    await deleteMonitor(monitor.id);
    console.log('monitor deleted');
  }
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
