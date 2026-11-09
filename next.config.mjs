import { existsSync, readFileSync } from 'node:fs';

// Dev only: let .env win over variables already exported in the OS/shell. Next.js normally does the opposite,
// so a stale TINYFISH_API_KEY set in Windows user variables silently overrides the key in .env.
if (process.env.NODE_ENV !== 'production' && process.env.VERITY_E2E !== '1' && existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#')) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

/** @type {import('next').NextConfig} */
export default {
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-libsql', '@libsql/client', 'libsql'], // native / server-only: not bundled
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ] }];
  },
};
