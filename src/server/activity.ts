import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

/** Only called alongside the persisted operation it describes. */
export async function activity(ownerId: string, type: string, message: string, refs: Record<string, string | null | undefined> = {}) {
  await db.activityEvent.create({ data: { id: newId('evt'), ownerId, type, message, refsJson: JSON.stringify(refs) } });
}
