import { z } from 'zod';

const blank = (v: unknown) => (v === '' ? undefined : v);
const Env = z.object({
  TINYFISH_API_KEY: z.string().min(1, 'TINYFISH_API_KEY is required'),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url(),
  WEBHOOK_SECRET: z.preprocess(blank, z.string().min(8, 'WEBHOOK_SECRET must be at least 8 characters').optional()),
  VERITY_API_KEYS: z.preprocess(blank, z.string().optional()),
  SANDBOX_API_KEY: z.preprocess(blank, z.string().optional()),
  SANDBOX_API_SECRET: z.preprocess(blank, z.string().optional()),
  SANDBOX_API_URL: z.preprocess(blank, z.string().url().optional()),
  TINYFISH_SEARCH_URL: z.preprocess(blank, z.string().url().optional()),
  TINYFISH_FETCH_URL: z.preprocess(blank, z.string().url().optional()),
  TINYFISH_AGENT_URL: z.preprocess(blank, z.string().url().optional()),
});

export function env() {
  const r = Env.safeParse(process.env);
  if (!r.success) throw new Error('Invalid environment: ' + r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}
export const envIssues = (): string[] => {
  const r = Env.safeParse(process.env);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};
export const isSimulatedProvider = () => !!(process.env.TINYFISH_SEARCH_URL || process.env.TINYFISH_FETCH_URL || process.env.TINYFISH_AGENT_URL);
