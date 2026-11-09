'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Verify' },
  { href: '/results', label: 'Results' },
  { href: '/watchlist', label: 'Watchlist' },
  { href: '/developers', label: 'API & Activity' },
];

/** 3x3 pixel mark: one lime square, like a verified cell on a grid. */
function Mark() {
  const on = new Set([4, 2, 6]);
  return (
    <span className="grid grid-cols-3 gap-[2px]" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} className="block h-[6px] w-[6px]" style={{ background: i === 4 ? 'var(--lime)' : on.has(i) ? 'var(--ink)' : 'var(--line)', outline: i === 4 ? '1px solid var(--ink)' : undefined }} />
      ))}
    </span>
  );
}

export function Nav() {
  const path = usePathname();
  const active = (h: string) => (h === '/' ? path === '/' : path.startsWith(h));
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-panel/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-5 px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight">
          <Mark />
          <span className="text-[15px]">Verity</span>
        </Link>
        <nav aria-label="Primary" className="-mx-1 flex flex-1 gap-0.5 overflow-x-auto">
          {ITEMS.map((i) => (
            <Link key={i.href} href={i.href} aria-current={active(i.href) ? 'page' : undefined}
              className={`whitespace-nowrap px-3 py-1.5 text-[13px] font-medium ${active(i.href) ? 'bg-ink text-paper' : 'text-mute hover:bg-sunk hover:text-ink'}`}>{i.label}</Link>
          ))}
        </nav>
        <span className="hidden items-center gap-2 text-xs text-mute md:flex"><span className="sq" style={{ background: 'var(--ok)' }} aria-hidden />Live from official sources</span>
      </div>
    </header>
  );
}
