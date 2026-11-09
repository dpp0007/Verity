export function log(level: 'info' | 'warn' | 'error', msg: string, ctx: Record<string, unknown> = {}) {
  // Structured JSON line; never put secrets in ctx.
  console[level === 'info' ? 'log' : level](JSON.stringify({ t: new Date().toISOString(), level, msg, ...ctx }));
}
