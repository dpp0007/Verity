'use client';
// Layout adapted from "Edge Infrastructure Dashboard" by Augustas (@augustasdesign) via lookap — see globals.css for credit.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

const I = (d: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;
const ICONS = {
  verify: I(<><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" /></>),
  results: I(<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h8M8 17h5" /></>),
  watch: I(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  api: I(<><path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" /></>),
};
const ITEMS = [
  { href: '/', label: 'Verify', icon: ICONS.verify, crumb: 'Verify a record' },
  { href: '/results', label: 'Results', icon: ICONS.results, crumb: 'Results' },
  { href: '/watchlist', label: 'Watchlist', icon: ICONS.watch, crumb: 'Watchlist' },
  { href: '/developers', label: 'API & Activity', icon: ICONS.api, crumb: 'API & Activity' },
];

interface Reg { id: string; name: string; country: string; regions: string[]; live_tested: boolean; blocked: string | null; method: string; available?: boolean }

function useRegistries() {
  const [regs, setRegs] = useState<Reg[] | null>(null);
  useEffect(() => {
    let off = false;
    fetch('/api/v1/registries').then((r) => (r.ok ? r.json() : null)).then((j) => { if (!off && j?.registries) setRegs(j.registries); }).catch(() => undefined);
    return () => { off = true; };
  }, []);
  return regs;
}

const short = (n: string) => n.split(' — ')[0].replace(/ \(.*\)/, '');

export function Sidebar() {
  const path = usePathname();
  const regs = useRegistries();
  const active = (h: string) => (h === '/' ? path === '/' : path.startsWith(h));
  const shown = (regs ?? []).filter((r) => r.available !== false);
  const tested = shown.filter((r) => r.live_tested).length;
  return (
    <aside className="side" aria-label="Verity">
      <Link href="/" className="flex items-center gap-3 rounded-xl px-1.5 py-1.5">
        <span className="tile" aria-hidden>V</span>
        <span className="min-w-0 leading-tight"><b className="block text-[16px]">Verity</b><span className="hint">Official-source checks</span></span>
      </Link>
      <nav aria-label="Primary" className="mt-3 grid gap-0.5">
        {ITEMS.map((i) => (
          <Link key={i.href} href={i.href} aria-current={active(i.href) ? 'page' : undefined} className="navlink">{i.icon}{i.label}</Link>
        ))}
      </nav>
      <p className="side-h">Registries</p>
      <ul className="regs grid gap-0.5">
        {(regs ?? []).filter((r) => r.available !== false).map((r) => (
          <li key={r.id} className="regrow" title={r.blocked ?? (r.live_tested ? 'Passed the live test' : 'Runs end to end; not yet fully live-tested')}>
            <span className="d" style={{ background: r.live_tested ? 'var(--accent)' : r.blocked ? 'var(--warn)' : 'var(--mute)' }} aria-hidden />
            <span className="min-w-0 truncate"><span className="mono text-mute">{r.country}</span> {short(r.name)}</span>
          </li>
        ))}
        {!regs && <li className="regrow text-mute">Loading…</li>}
      </ul>
      <div className="usage">
        <div className="flex items-baseline justify-between text-[13.5px]"><span className="text-mute">Live-tested</span></div>
        <p className="mt-1 text-[18px] font-semibold">{tested}<span className="text-mute"> / {regs ? shown.length : '…'}</span> <span className="text-[13px] font-normal text-mute">registries</span></p>
        <div className="bar" role="img" aria-label={`${tested} of ${shown.length} registries live-tested`}><i style={{ width: shown.length ? `${(tested / shown.length) * 100}%` : '0%' }} /></div>
      </div>
    </aside>
  );
}

export function Crumbs() {
  const path = usePathname();
  const here = ITEMS.find((i) => (i.href === '/' ? path === '/' : path.startsWith(i.href)));
  const detail = path.startsWith('/results/') ? path.split('/')[2] : null;
  return (
    <div className="crumbs" aria-label="Breadcrumb">
      <Link href="/" className="hover:text-ink">Verity</Link><span aria-hidden>/</span>
      {detail ? (<><Link href="/results" className="hover:text-ink">Results</Link><span aria-hidden>/</span><b className="mono">{detail}</b></>) : <b>{here?.crumb ?? 'Verity'}</b>}
      <span className="pill live ml-auto"><i />Live from official sources</span>
    </div>
  );
}
