import { registryById, type Registry } from '@/lib/registries';

/** Resolves the registry for a stored verification: configured by id, or the discovered one saved on the row. */
export function registryOf(v: { registryId: string | null; registryJson: string | null }): Registry | null {
  if (!v.registryId) return null;
  if (v.registryId.startsWith('dyn-')) return v.registryJson ? (JSON.parse(v.registryJson) as Registry) : null;
  return registryById(v.registryId) ?? null;
}
