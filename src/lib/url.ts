/**
 * Validates a URL against an allow-list of official domains. The backend never fetches
 * user-supplied URLs itself (TinyFish does), but anything that is not plain https on an approved
 * host is still refused: no credentials, no custom ports, no IP literals, no localhost.
 */
export function isOfficialUrl(raw: string, domains: string[]): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || /^[\d.]+$/.test(h) || h.includes(':')) return false;
  return domains.some((d) => h === d || h.endsWith('.' + d));
}
