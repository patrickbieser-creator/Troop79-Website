/**
 * Wreath sale — the checkout's "give a scout credit" type-ahead. The matching happens HERE, on the server, so the
 * browser never receives the roster: it sends a few letters and gets back at most eight sellers of the open sale as
 * { id, name: "First L." }. Active sellers only, a prefix of the first name only, and a light per-IP limit.
 * (The surname is read to make the initial and dropped before anything leaves this file.)
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { scoutDisplayName } from './public';

export const MAX_MATCHES = 8;
export const MIN_LETTERS = 2;

export interface SellerMatch {
  id: number;
  name: string;
}

/** An in-memory sliding window per IP: light protection against scraping the roster one letter at a time. */
export function createSellerSearchLimiter(opts: { max?: number; windowMs?: number } = {}) {
  const max = opts.max ?? 30;
  const windowMs = opts.windowMs ?? 60_000;
  const hits = new Map<string, number[]>();
  return {
    allow(key: string, now: number): boolean {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
      return true;
    }
  };
}

export const sharedSellerSearchLimiter = createSellerSearchLimiter();

/** Letters (and the hyphen / apostrophe / space real first names carry); anything else, wildcards included, is dropped. */
export function cleanPrefix(raw: string): string {
  return raw.normalize('NFC').replace(/[^\p{L}'’ -]/gu, '').trim().slice(0, 20);
}

export async function searchSellers(
  sb: SupabaseClient,
  saleId: number,
  rawPrefix: string,
  opts: { ip: string | null; limiter?: ReturnType<typeof createSellerSearchLimiter>; now?: number }
): Promise<SellerMatch[]> {
  const prefix = cleanPrefix(rawPrefix);
  if (prefix.length < MIN_LETTERS) return [];
  if (!(opts.limiter ?? sharedSellerSearchLimiter).allow(opts.ip ?? 'unknown', opts.now ?? Date.now())) return [];
  const { data: sale } = await sb.from('wreath_sales').select('status').eq('id', saleId).maybeSingle();
  if (sale?.status !== 'open') return [];
  const { data } = await sb
    .from('wreath_sellers')
    .select('id, people:person_id!inner(first_name, last_name)')
    .eq('sale_id', saleId)
    .eq('active', true)
    .ilike('people.first_name', `${prefix}%`)
    .limit(MAX_MATCHES * 3);
  type P = { first_name: string | null; last_name: string | null };
  const rows = (data ?? []) as unknown as { id: number; people: P | P[] | null }[];
  return rows
    .map((r) => {
      const p = Array.isArray(r.people) ? r.people[0] : r.people;
      return { id: r.id, name: scoutDisplayName(p?.first_name ?? null, p?.last_name ?? null).name };
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_MATCHES);
}
