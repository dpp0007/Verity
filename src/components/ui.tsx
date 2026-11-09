'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

const TONE: Record<string, 'ok' | 'warn' | 'bad' | 'mute'> = {
  active: 'ok', verified: 'ok', high: 'ok', partially_verified: 'warn', pending: 'warn', medium: 'warn', ambiguous: 'warn', temporarily_unavailable: 'warn', paused: 'warn', creating: 'warn',
  expired: 'bad', suspended: 'bad', revoked: 'bad', failed: 'bad', low: 'bad',
  inactive: 'mute', unknown: 'mute', not_found: 'mute', unsupported: 'mute',
};
export const toneOf = (v: string | null | undefined) => TONE[v ?? 'unknown'] ?? 'mute';

export function Badge({ value, label }: { value: string | null | undefined; label?: string }) {
  const v = value ?? 'unknown';
  return (
    <span className={`tone-${toneOf(v)} inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-0.5 text-xs font-medium whitespace-nowrap`}>
      <span className="sq" style={{ background: 'var(--t)' }} aria-hidden />
      {label ?? v.replace(/_/g, ' ')}
    </span>
  );
}

/** Large state marker used on the result header. */
export function Stamp({ value, label }: { value: string | null | undefined; label?: string }) {
  return <span className={`stamp tone-${toneOf(value)}`}><span className="sq" aria-hidden />{label ?? (value ?? 'unknown').replace(/_/g, ' ')}</span>;
}

export function Meter({ level }: { level: 'high' | 'medium' | 'low' | null }) {
  const n = level === 'high' ? 3 : level === 'medium' ? 2 : level === 'low' ? 1 : 0;
  return (
    <span className={`meter tone-${toneOf(level)}`} role="img" aria-label={`Evidence strength ${level ?? 'none'}`}>
      {[0, 1, 2].map((i) => <i key={i} className={i < n ? 'on' : ''} />)}
    </span>
  );
}

export function SourceLink({ url, children }: { url: string | null; children?: ReactNode }) {
  if (!url) return <span className="text-mute">—</span>;
  return <a href={url} target="_blank" rel="noopener noreferrer" className="mono break-all underline decoration-line underline-offset-4 hover:bg-lime hover:text-lime-ink hover:decoration-transparent">{children ?? url} ↗</a>;
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="hint mt-1.5">{hint}</p>}
    </div>
  );
}

export function Notice({ tone = 'warn', title, children }: { tone?: 'warn' | 'bad' | 'ok' | 'info'; title?: string; children?: ReactNode }) {
  const t = tone === 'info' ? 'mute' : tone;
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={`tone-${t} flex min-w-0 gap-3 rounded-xl border border-line p-3.5`} style={{ background: 'var(--tb)', boxShadow: 'inset 3px 0 0 var(--t)' }}>
      <div className="min-w-0 break-words">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-[13.5px]">{children}</div>}
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card p-10 text-center">
      <span className="mx-auto mb-3 grid w-fit grid-cols-3 gap-[3px]" aria-hidden>
        {Array.from({ length: 9 }, (_, i) => <i key={i} className="block h-2 w-2" style={{ background: i === 4 ? 'var(--lime)' : 'var(--line)' }} />)}
      </span>
      <p className="font-semibold">{title}</p>
      {children && <div className="hint mt-1">{children}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return <div role="status" className="hint"><div className="scan mb-3 w-24" aria-hidden />{label}…</div>;
}

function highlight(json: string) {
  const esc = json.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return esc.replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g, (m, s, colon, lit, num) =>
    s ? (colon ? `<span class="j-k">${s}</span>${colon}` : `<span class="j-s">${s}</span>`) : `<span class="j-n">${lit ?? num}</span>`);
}

export function JsonViewer({ value, filename = 'verity.json' }: { value: unknown; filename?: string }) {
  const toast = useToast();
  const text = JSON.stringify(value, null, 2);
  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="hint mono">{filename}</span>
        <span className="flex gap-2">
          <button className="btn btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(text); toast('JSON copied'); } catch { toast('Copy failed: clipboard unavailable', 'bad'); } }}>Copy JSON</button>
          <button className="btn btn-sm" onClick={() => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
            a.download = filename; a.click(); URL.revokeObjectURL(a.href);
          }}>Download JSON</button>
        </span>
      </div>
      <pre className="mono max-h-[420px] overflow-auto bg-sunk p-3 whitespace-pre" tabIndex={0} dangerouslySetInnerHTML={{ __html: highlight(text) }} />
    </div>
  );
}

// ---- toast ----
type T = { id: number; msg: string; tone: 'ok' | 'bad' };
const ToastCtx = createContext<(msg: string, tone?: 'ok' | 'bad') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const n = useRef(0);
  const push = useCallback((msg: string, tone: 'ok' | 'bad' = 'ok') => {
    const id = ++n.current;
    setItems((x) => [...x, { id, msg, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`rise card-strong tone-${t.tone} px-3.5 py-2.5 text-sm`} style={{ borderLeft: '5px solid var(--t)' }}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Confirm({ open, title, body, confirmLabel, onConfirm, onCancel }: { open: boolean; title: string; body: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onCancel} className="card-strong w-[92vw] max-w-md p-0 text-ink backdrop:bg-black/50">
      <div className="p-5">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="mt-2 text-sm text-mute">{body}</div>
      </div>
      <div className="flex justify-end gap-2 border-t border-line p-3">
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </dialog>
  );
}

export const DISCLAIMER = 'Records reflect the source and the time checked. Verity does not guarantee identity, suitability for employment, or legal compliance. For consequential decisions, confirm with the relevant authority.';
