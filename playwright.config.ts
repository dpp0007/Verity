import { defineConfig } from '@playwright/test';

const provider = 'http://127.0.0.1:4010';
const env = {
  DATABASE_URL: 'file:./e2e.db', TINYFISH_API_KEY: 'test-key', WEBHOOK_SECRET: 'e2e-secret-123', APP_URL: 'https://verity.e2e.test',
  TINYFISH_SEARCH_URL: provider, TINYFISH_FETCH_URL: provider, TINYFISH_AGENT_URL: provider, VERITY_AGENT_POLL_MS: '100', VERITY_E2E: '1', VERITY_IGNORE_BLOCKED_REGISTRIES: '1',
};

// The e2e suite runs the real app against a SIMULATED TinyFish provider (scripts/mock-tinyfish.ts).
export default defineConfig({
  testDir: 'e2e', timeout: 90_000, expect: { timeout: 20_000 }, fullyParallel: false, workers: 1, retries: 0,
  use: { baseURL: 'http://127.0.0.1:3100', channel: process.env.PW_CHANNEL || 'chrome', permissions: ['clipboard-read', 'clipboard-write'] },
  webServer: [
    { command: 'npx tsx scripts/mock-tinyfish.ts', port: 4010, env: { ...process.env, ...env } as Record<string, string>, reuseExistingServer: false },
    {
      command: 'node scripts/e2e-prepare.mjs && npx next dev -p 3100 -H 127.0.0.1', port: 3100, timeout: 120_000,
      env: { ...process.env, ...env } as Record<string, string>, reuseExistingServer: false,
    },
  ],
});
