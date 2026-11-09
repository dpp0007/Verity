import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';

const g = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Vercel has no persistent disk, so production uses a hosted libSQL (Turso) database, which is SQLite-compatible.
 * With TURSO_DATABASE_URL set the client talks to it through the driver adapter; otherwise it uses the local SQLite file
 * in DATABASE_URL (development and tests).
 */
function create() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) return new PrismaClient();
  process.env.DATABASE_URL ??= 'file:./unused.db'; // the schema requires the variable to exist; the adapter ignores it
  return new PrismaClient({ adapter: new PrismaLibSQL({ url, authToken: process.env.TURSO_AUTH_TOKEN }) });
}

export const db = g.prisma ?? create();
if (process.env.NODE_ENV !== 'production') g.prisma = db;
