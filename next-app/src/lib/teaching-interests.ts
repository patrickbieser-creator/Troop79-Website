/**
 * Build a Plan B10c/B10d (Plans/Build-A-Plan.md "B10 spec"): talent discovery. "What else would you enjoy teaching,
 * now or in the future?" Interests live in teaching_interests (20261222100000_teaching_interests.sql), NEVER in
 * teaching_skills, so a forwarded answer-page link can't edit anyone's qualifications. Patrick: interests don't expire
 * (the adult removes them on /member/teaching); the engine and matcher ignore them; the Invite tab shows only a
 * collapsed "New talent (n)" list (last 30 days, by adult).
 *
 * Server only, service role. The SQL holds the rules (catalog check, 15 per submit, 40 active, the page's caps); this
 * is its edge. From the answer page everything is TOKEN-scoped: the person is the page's recipient, never a parameter.
 * "Also this Sunday" signs the adult up through teachTopic (meeting_teach_topic) as themself, so Build shows
 * "Teacher offered"; at most 5 per submit, requirements only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { hashSecret } from '@/lib/identity-challenge';
import { teachTopic } from '@/lib/meeting-board-supply';

export * from '@/lib/teaching-interests-shared';
import { interestShort, INTEREST_NOTE_MAX, INTEREST_SEARCH_MAX, NEW_TALENT_DAYS, type InterestHit, type InterestKind, type InterestPick, type TalentGroup, canSeeNewTalent } from '@/lib/teaching-interests-shared';
import type { PlannerAccess } from '@/lib/meeting-planner-access';

type HitRow = { topic_key: string; kind: InterestKind; source_name: string; code: string | null; label: string };
const toHit = (r: HitRow): InterestHit => ({ key: r.topic_key, kind: r.kind, sourceName: r.source_name, code: r.code, label: r.label });

/** Picks as the RPCs take them: trimmed notes (≤ 140), blanks as null; anything malformed dropped. */
export function cleanPicks(raw: unknown): InterestPick[] | null {
  if (!Array.isArray(raw)) return null;
  const out: InterestPick[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') return null;
    const { key, note } = p as { key?: unknown; note?: unknown };
    if (typeof key !== 'string' || key.length < 3 || key.length > 120) return null;
    if (note != null && typeof note !== 'string') return null;
    const n = typeof note === 'string' ? note.trim().slice(0, INTEREST_NOTE_MAX) : '';
    out.push({ key, note: n || null });
  }
  return out;
}

/** The RPCs' own messages are written for people; anything else stays private. */
const KNOWN = /^(Pick up to|That isn’t a requirement|You can keep up to|Offer up to|Only a requirement)/;
const said = (message: string) => (KNOWN.test(message) ? message : 'That didn’t save. Please try again.');

// ── the answer page (token-scoped) ───────────────────────────────────────────────────────────────────────────────

const TOKEN = /^[0-9a-f]{64}$/i;

export type PageSearchResult = { ok: true; rows: InterestHit[] } | { ok: false; state: 'unknown' | 'expired' | 'superseded' | 'void' | 'limit' | 'error' };

/** One search from an answer page: counted against the page's 60; q ≤ 80; 20 rows. */
export async function searchInterestsFromPage(sb: SupabaseClient, token: string, q: string): Promise<PageSearchResult> {
  if (!TOKEN.test(token)) return { ok: false, state: 'unknown' };
  const { data, error } = await sb.rpc('teaching_interest_search_page', { p_token_hash: await hashSecret(token.toLowerCase()), p_q: q.slice(0, INTEREST_SEARCH_MAX) });
  if (error) return { ok: false, state: 'error' };
  const res = data as { state: 'ok' | 'unknown' | 'expired' | 'superseded' | 'void' | 'limit'; rows?: HitRow[] };
  if (res.state !== 'ok') return { ok: false, state: res.state };
  return { ok: true, rows: (res.rows ?? []).map(toHit) };
}

export interface NowOutcome {
  key: string;
  ok: boolean;
  error: string | null;
}

export type PageAddResult =
  | { ok: true; pageId: number; entryId: number; recipientId: number; added: string[]; now: NowOutcome[] }
  | { ok: false; state: 'unknown' | 'expired' | 'superseded' | 'void' | 'busy' | 'refused' | 'save'; error?: string };

/** "Save interests" on an answer page: the interests, then each "Also this Sunday" through teachTopic as the adult. */
export async function addInterestsFromPage(sb: SupabaseClient, token: string, picks: readonly InterestPick[], nowKeys: readonly string[]): Promise<PageAddResult> {
  if (!TOKEN.test(token)) return { ok: false, state: 'unknown' };
  const { data, error } = await sb.rpc('teaching_interest_add_from_page', {
    p_token_hash: await hashSecret(token.toLowerCase()),
    p_items: picks.map((p) => ({ key: p.key, note: p.note })),
    p_now_keys: [...nowKeys]
  });
  if (error) return KNOWN.test(error.message) ? { ok: false, state: 'refused', error: error.message } : { ok: false, state: 'save' };
  const res = data as { state: string; page_id?: number; entry?: number; recipient?: number; added?: string[]; now?: string[] };
  if (res.state !== 'saved') return { ok: false, state: res.state as 'unknown' | 'expired' | 'superseded' | 'void' | 'busy' };
  const w = { personId: res.recipient!, actorPersonId: res.recipient!, leader: false };
  const now: NowOutcome[] = [];
  for (const key of res.now ?? []) {
    const r = await teachTopic(sb, w, [res.entry!], { key }, null);
    now.push({ key, ok: r.ok, error: r.ok ? null : r.error });
  }
  return { ok: true, pageId: res.page_id!, entryId: res.entry!, recipientId: res.recipient!, added: res.added ?? [], now };
}

// ── signed in (/member/teaching) ─────────────────────────────────────────────────────────────────────────────────

export async function searchInterestCatalog(sb: SupabaseClient, q: string): Promise<InterestHit[]> {
  const { data, error } = await sb.rpc('teaching_interest_catalog_search', { p_q: q.slice(0, INTEREST_SEARCH_MAX), p_limit: 20 });
  if (error) throw new Error(error.message);
  return ((data ?? []) as HitRow[]).map(toHit);
}

export async function addMemberInterests(sb: SupabaseClient, personId: number, picks: readonly InterestPick[]): Promise<{ ok: true; added: string[] } | { ok: false; error: string }> {
  const { data, error } = await sb.rpc('teaching_interest_add_member', { p_person: personId, p_items: picks.map((p) => ({ key: p.key, note: p.note })) });
  if (error) return { ok: false, error: said(error.message) };
  return { ok: true, added: ((data as { added?: string[] }).added ?? []) as string[] };
}

/** Removes one of the person's own interests; the key it was, or null when it wasn't theirs or was already gone. */
export async function removeInterest(sb: SupabaseClient, personId: number, id: number): Promise<string | null> {
  const { data, error } = await sb.rpc('teaching_interest_remove', { p_person: personId, p_id: id });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

type DescribeRow = HitRow & { skill_id: string | null };

/** Words for keys (one round trip). */
export async function describeInterests(sb: SupabaseClient, keys: readonly string[]): Promise<Map<string, InterestHit & { skillId: string | null }>> {
  if (!keys.length) return new Map();
  const { data, error } = await sb.rpc('teaching_interest_describe', { p_keys: [...new Set(keys)] });
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as DescribeRow[]).map((r) => [r.topic_key, { ...toHit(r), skillId: r.skill_id }]));
}

export interface MyInterest extends InterestHit {
  id: number;
  short: string;
  note: string | null;
  createdAt: string;
  /** A rank requirement's skill: "Add to what I can teach" offers it. */
  skillId: string | null;
}

type InterestRow = { id: number; person_id: number; topic_key: string; note: string | null; created_at: string };

export async function loadMyInterests(sb: SupabaseClient, personId: number): Promise<MyInterest[]> {
  const { data, error } = await sb.from('teaching_interests').select('id, person_id, topic_key, note, created_at').eq('person_id', personId).is('removed_at', null).order('created_at', { ascending: false }).order('id', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as InterestRow[];
  const words = await describeInterests(sb, rows.map((r) => r.topic_key));
  return rows.map((r) => {
    const w = words.get(r.topic_key) ?? { key: r.topic_key, kind: 'rank' as const, sourceName: '', code: null, label: 'No longer in the catalog', skillId: null };
    return { ...w, key: r.topic_key, id: r.id, short: interestShort(w), note: r.note, createdAt: r.created_at };
  });
}

// ── the Invite tab's "New talent" ────────────────────────────────────────────────────────────────────────────────

/**
 * Interests added in the last 30 days, grouped by adult (newest adult first, their items newest first). Patrick
 * (qa-lead B10c #1): only a planner editor who is an adult sees them, so a View-only or scout viewer gets nothing
 * here, at the load; and only adults' interests are listed (never an active scout's, Junior Leaders included).
 */
export async function loadNewTalent(sb: SupabaseClient, viewer: Pick<PlannerAccess, 'canEdit' | 'canEmail'>, now: Date = new Date(), days = NEW_TALENT_DAYS): Promise<TalentGroup[]> {
  if (!canSeeNewTalent(viewer)) return [];
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const { data, error } = await sb
    .from('teaching_interests')
    .select('id, person_id, topic_key, note, created_at, people!inner(display_name, active)')
    .is('removed_at', null)
    .gte('created_at', since)
    .eq('people.active', true)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  type Row = InterestRow & { people: { display_name: string } | { display_name: string }[] | null };
  const all = (data ?? []) as unknown as Row[];
  const owners = [...new Set(all.map((r) => r.person_id))];
  const { data: youth, error: youthErr } = owners.length ? await sb.from('scouts').select('person_id').eq('active', true).in('person_id', owners) : { data: [], error: null };
  if (youthErr) throw new Error(youthErr.message);
  const scouts = new Set(((youth ?? []) as { person_id: number }[]).map((y) => y.person_id));
  const rows = all.filter((r) => !scouts.has(r.person_id));
  const words = await describeInterests(sb, rows.map((r) => r.topic_key));
  const groups = new Map<number, TalentGroup>();
  for (const r of rows) {
    const who = Array.isArray(r.people) ? r.people[0] : r.people;
    const g = groups.get(r.person_id) ?? { personId: r.person_id, name: who?.display_name ?? `Person ${r.person_id}`, items: [] };
    const w = words.get(r.topic_key);
    g.items.push({ id: r.id, short: w ? interestShort(w) : r.topic_key, note: r.note, createdAt: r.created_at });
    groups.set(r.person_id, g);
  }
  return [...groups.values()];
}
