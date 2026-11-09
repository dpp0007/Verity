import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'], globalSetup: ['tests/globalSetup.ts'],
    fileParallelism: false, testTimeout: 20_000,
  },
});
