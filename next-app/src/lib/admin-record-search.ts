/**
 * Search's records half (Plans/Completed/Admin-Portal-Nav.md decision 8, phase 5): people, calendar entries and articles whose
 * names match, at most five of each. Each kind is searched only when the person could open the result: people need
 * roster.manage (the record page's guard), calendar entries calendar.write, articles news.write. Nothing about health
 * or money is searched, so nothing behind those lists can leak through a name.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Capability } from '@/lib/capabilities';
import { fmtDate } from '@/lib/format-date';

export const RECORDS_PER_KIND = 5;
export const MIN_QUERY = 2;

export interface RecordHit {
  id: string;
  label: string;
  /** One quiet line: "Scout", the entry's date, "Draft". */
  meta: string | null;
  href: string;
}

export interface RecordResults {
  people: RecordHit[];
  calendar: RecordHit[];
  articles: RecordHit[];
}

export const NO_RECORDS: RecordResults = { people: [], calendar: [], articles: [] };

/** An ilike pattern that treats the query literally: % _ and \ are escaped, and commas or brackets (which PostgREST's
 *  filter grammar reads) are dropped. */
export function likePattern(q: string): string {
  const safe = q.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[,()]/g, ' ').trim();
  return `%${safe}%`;
}

export async function searchRecords(sb: SupabaseClient, query: string, capabilities: ReadonlySet<Capability>): Promise<RecordResults> {
  const q = query.trim().slice(0, 80);
  if (q.length < MIN_QUERY) return NO_RECORDS;
  const pat = likePattern(q);
  const [people, calendar, articles] = await Promise.all([
    capabilities.has('roster.manage')
      ? sb
          .from('people')
          .select('id, display_name, active')
          .ilike('display_name', pat)
          .is('merged_into_person_id', null)
          .is('guest_host_household_id', null)
          .eq('is_test', false)
          .order('active', { ascending: false })
          .order('display_name')
          .limit(RECORDS_PER_KIND)
      : null,
    capabilities.has('calendar.write')
      ? sb.from('calendar_entries').select('id, title, entry_date').ilike('title', pat).order('entry_date', { ascending: false }).limit(RECORDS_PER_KIND)
      : null,
    capabilities.has('news.write')
      ? sb.from('articles').select('id, title, status').ilike('title', pat).is('archived_at', null).order('id', { ascending: false }).limit(RECORDS_PER_KIND)
      : null
  ]);
  for (const r of [people, calendar, articles]) if (r?.error) throw new Error(`record search failed: ${r.error.message}`);
  return {
    people: ((people?.data ?? []) as { id: number; display_name: string; active: boolean }[]).map((p) => ({
      id: String(p.id),
      label: p.display_name,
      meta: p.active ? null : 'Inactive',
      href: `/admin/advancement/roster/${p.id}`
    })),
    calendar: ((calendar?.data ?? []) as { id: number; title: string; entry_date: string }[]).map((c) => ({
      id: String(c.id),
      label: c.title,
      meta: fmtDate(c.entry_date),
      href: `/admin/calendar/${c.id}`
    })),
    articles: ((articles?.data ?? []) as { id: number; title: string; status: string | null }[]).map((a) => ({
      id: String(a.id),
      label: a.title,
      meta: a.status && a.status !== 'published' ? a.status.charAt(0).toUpperCase() + a.status.slice(1) : null,
      href: `/admin/news/articles/${a.id}`
    }))
  };
}
