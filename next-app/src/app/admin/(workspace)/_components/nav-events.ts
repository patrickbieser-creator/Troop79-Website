/**
 * Shortcut tracking (Plans/Completed/Admin-Portal-Nav.md decision 12): one `admin_nav_events` row each time a person opens a
 * registered item from the rail, a menu, search or A–Z. Home's shortcuts read the past 30 days. The caller passes the
 * signed-in actor's own person id; nothing here takes one from a browser.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { featureByKey } from './feature-registry';

export const SHORTCUT_WINDOW_DAYS = 30;
export const KEEP_DAYS = 90;
/** A repeat of the same open within this many seconds is one open (double clicks, a looping client). */
export const DEDUPE_SECONDS = 5;

const daysAgo = (n: number, now: Date) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

/**
 * Logs one open and prunes this person's rows older than KEEP_DAYS. An unknown key logs nothing; the same key again
 * within DEDUPE_SECONDS logs nothing.
 */
export async function logNavOpen(sb: SupabaseClient, personId: number, key: string, now: Date = new Date()): Promise<boolean> {
  if (!featureByKey(key)) return false;
  const { data: recent, error: recentErr } = await sb
    .from('admin_nav_events')
    .select('id')
    .eq('person_id', personId)
    .eq('feature_key', key)
    .gte('at', new Date(now.getTime() - DEDUPE_SECONDS * 1000).toISOString())
    .limit(1);
  if (recentErr) throw new Error(`admin_nav_events read failed: ${recentErr.message}`);
  if ((recent ?? []).length > 0) return false;
  const [ins, prune] = await Promise.all([
    sb.from('admin_nav_events').insert({ person_id: personId, feature_key: key }),
    sb.from('admin_nav_events').delete().eq('person_id', personId).lt('at', daysAgo(KEEP_DAYS, now))
  ]);
  if (ins.error) throw new Error(`admin_nav_events insert failed: ${ins.error.message}`);
  if (prune.error) throw new Error(`admin_nav_events prune failed: ${prune.error.message}`);
  return true;
}

export interface OpenCount {
  key: string;
  count: number;
}

/** The person's opens in the window, most first (ties: most recent first). Keys no longer registered are dropped. */
export async function mostOpened(sb: SupabaseClient, personId: number, now: Date = new Date()): Promise<OpenCount[]> {
  // A person opens perhaps a few hundred items a month; 2000 rows is far past that and under the per-request cap
  // a single select is allowed to assume (the 1000-row cap applies per page, so read two pages at most).
  const since = daysAgo(SHORTCUT_WINDOW_DAYS, now);
  const rows: { feature_key: string; at: string }[] = [];
  for (let from = 0; from < 2000; from += 1000) {
    const { data, error } = await sb
      .from('admin_nav_events')
      .select('feature_key, at')
      .eq('person_id', personId)
      .gte('at', since)
      .order('at', { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(`admin_nav_events read failed: ${error.message}`);
    rows.push(...((data ?? []) as { feature_key: string; at: string }[]));
    if ((data ?? []).length < 1000) break;
  }
  return rankOpens(rows);
}

/** Pure: count per key, most first, ties broken by the most recent open. */
export function rankOpens(rows: readonly { feature_key: string; at: string }[]): OpenCount[] {
  const counts = new Map<string, { count: number; last: string }>();
  for (const r of rows) {
    if (!featureByKey(r.feature_key)) continue;
    const c = counts.get(r.feature_key) ?? { count: 0, last: r.at };
    c.count += 1;
    if (r.at > c.last) c.last = r.at;
    counts.set(r.feature_key, c);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].last.localeCompare(a[1].last))
    .map(([key, c]) => ({ key, count: c.count }));
}
