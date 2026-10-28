/**
 * Meeting Planner P3: seeding and focus sets (Plans/Meeting-Planner-II.md, Decision 10; migration
 * 20261204100000_meeting_planner_focus_sets.sql). Server-only: every function takes the service-role client. The
 * caller gates: every write here is for a meeting_planner.seed holder, checked by the planner's server actions first.
 *
 *   - A seeded topic is a meeting_topics row with seeded_at set: one top-level requirement (rank or merit badge), or a
 *     focus group ('fg:<set id>', one pick, one class) whose items were snapshot at seeding.
 *   - A focus set is a planner's labelled list of requirement keys (any level). "Last used" is the latest seeding.
 *   - The requirement search runs on the server, 50 rows a page.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdvancementCatalog } from '@/lib/advancement-catalog';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { boardName } from '@/lib/meeting-board-shared';
import { topicWords, type FocusPickIn } from '@/lib/meeting-board-picklist';
import type { FocusSearchRow, FocusSetView, FocusSource } from '@/lib/meeting-focus';

export interface FocusTopic {
  key: string;
  kind: 'rank_req' | 'mb_req' | 'focus_group' | 'merit_badge' | 'freeform';
  /** A focus group's title (the set's name when it was seeded). */
  title: string | null;
  seededByPersonId: number | null;
  seededBy: string | null;
  /** A focus group's items, in order. */
  members: string[];
  /** On the meeting's focus now (false: unseeded, kept for the picks or teachers on it). */
  seeded: boolean;
}

type TopicRow = {
  topic_key: string;
  kind: FocusTopic['kind'];
  title: string | null;
  seeded_by_person_id: number | null;
  seeded_at: string | null;
  people: { display_name: string } | { display_name: string }[] | null;
  meeting_topic_members: { item_key: string; position: number }[] | null;
};
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * What a planner seeded on this meeting, plus every focus group and merit badge requirement on it that was unseeded but
 * kept for its picks or teachers (seeded: false), so their words never fall back to the raw key. Callers that want
 * the focus itself filter on `seeded`.
 */
export async function loadFocusTopics(sb: SupabaseClient, entryId: number): Promise<FocusTopic[]> {
  const { data, error } = await sb
    .from('meeting_topics')
    .select('topic_key, kind, title, seeded_by_person_id, seeded_at, people:seeded_by_person_id(display_name), meeting_topic_members(item_key, position)')
    .eq('calendar_entry_id', entryId)
    .or('seeded_at.not.is.null,kind.in.(focus_group,mb_req)')
    .order('seeded_at', { nullsFirst: false })
    .order('id');
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as TopicRow[]).map((r) => ({
    key: r.topic_key,
    kind: r.kind,
    title: r.title,
    seededByPersonId: r.seeded_by_person_id,
    seededBy: one(r.people) ? boardName(one(r.people)!.display_name) : null,
    members: [...(r.meeting_topic_members ?? [])].sort((a, b) => a.position - b.position).map((m) => m.item_key),
    seeded: r.seeded_at != null
  }));
}

type Catalog = Pick<AdvancementCatalog, 'ranks' | 'rankRequirements' | 'meritBadges' | 'meritBadgeRequirements'>;

/** The titles and members topicWords needs for seeded keys. */
export function focusWordsMore(topics: readonly FocusTopic[], catalog: Catalog) {
  return {
    titles: new Map(topics.filter((t) => t.title).map((t) => [t.key, t.title!])),
    more: { mbReqs: catalog.meritBadgeRequirements, members: new Map(topics.map((t) => [t.key, t.members])) }
  };
}

/**
 * The titles and members topicWords needs for ONE key on a meeting (the invite senders and the /i/ page): a focus
 * group's or freeform topic's own meeting_topics row. A catalog key needs neither, so it costs no query. Build a Plan B0.
 */
export async function loadTopicWordsFor(sb: SupabaseClient, entryId: number, key: string): Promise<{ titles: Map<string, string>; members: Map<string, string[]> }> {
  const out = { titles: new Map<string, string>(), members: new Map<string, string[]>() };
  if (!key.startsWith('fg:') && !key.startsWith('ff:')) return out;
  const { data, error } = await sb
    .from('meeting_topics')
    .select('title, meeting_topic_members(item_key, position)')
    .eq('calendar_entry_id', entryId)
    .eq('topic_key', key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as Pick<TopicRow, 'title' | 'meeting_topic_members'> | null;
  if (!row) return out;
  if (row.title) out.titles.set(key, row.title);
  out.members.set(key, [...(row.meeting_topic_members ?? [])].sort((x, y) => x.position - y.position).map((m) => m.item_key));
  return out;
}

/** Seeded topics as the scout's pick list takes them (a catalog key that no longer resolves is left out). */
export function focusPicks(topics: readonly FocusTopic[], catalog: Catalog): FocusPickIn[] {
  const { titles, more } = focusWordsMore(topics, catalog);
  return topics.filter((t) => t.seeded).flatMap((t) => {
    const w = topicWords(t.key, catalog.ranks, catalog.rankRequirements, catalog.meritBadges, titles, more);
    return w ? [{ key: t.key, label: w.label, codeLabel: w.codeLabel, parts: w.parts }] : [];
  });
}

// ── focus sets ───────────────────────────────────────────────────────────────────────────────────────────────────

type SetRow = {
  id: number;
  name: string;
  created_by_person_id: number | null;
  updated_at: string;
  merit_badge_id: string | null;
  focus_set_labels: { label: string }[] | null;
  focus_set_items: { topic_key: string; position: number }[] | null;
};

/** Every focus set with its labels, items (with words) and when it was last seeded, newest-edited first. */
export async function loadFocusSets(sb: SupabaseClient, catalog: Catalog): Promise<FocusSetView[]> {
  const [sets, used] = await Promise.all([
    fetchAllRows<SetRow>((from, to) =>
      sb.from('focus_sets').select('id, name, created_by_person_id, updated_at, merit_badge_id, focus_set_labels(label), focus_set_items(topic_key, position)').order('id').range(from, to)
    ),
    fetchAllRows<{ focus_set_id: number; seeded_at: string }>((from, to) =>
      sb.from('meeting_topics').select('focus_set_id, seeded_at').not('focus_set_id', 'is', null).not('seeded_at', 'is', null).order('id').range(from, to)
    )
  ]);
  const last = new Map<number, string>();
  for (const u of used) if (!last.has(u.focus_set_id) || u.seeded_at > last.get(u.focus_set_id)!) last.set(u.focus_set_id, u.seeded_at);
  return sets
    .map((s) => ({
      id: s.id,
      name: s.name,
      createdBy: s.created_by_person_id,
      labels: (s.focus_set_labels ?? []).map((l) => l.label).sort(),
      items: [...(s.focus_set_items ?? [])].sort((a, b) => a.position - b.position).map((i) => itemView(i.topic_key, catalog)),
      lastUsed: last.get(s.id) ?? null,
      updatedAt: s.updated_at,
      mbId: s.merit_badge_id
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id);
}

/** A set item's words: its source ('Tenderfoot', 'First Aid'), code and label. */
export function itemView(key: string, catalog: Catalog): FocusSetView['items'][number] {
  const rank = [...catalog.ranks].sort((a, b) => b.id.length - a.id.length).find((r) => key.startsWith(`${r.id}-`));
  if (rank) {
    const code = key.slice(rank.id.length + 1);
    const row = catalog.rankRequirements.find((q) => q.rank_id === rank.id && q.code === code);
    if (row) return { key, kind: 'rank', sourceId: rank.id, sourceName: rank.display_name, code, label: row.label };
  }
  const row = catalog.meritBadgeRequirements.find((q) => `${q.mb_id}-${q.code}` === key);
  const mb = row ? catalog.meritBadges.find((m) => m.id === row.mb_id) : undefined;
  if (row && mb) return { key, kind: 'mb', sourceId: mb.id, sourceName: mb.name, code: row.code, label: row.label };
  return { key, kind: 'rank', sourceId: '', sourceName: '', code: key, label: 'No longer in the catalog' };
}

/** The RPCs' own messages are written for people; anything else is not shown raw. */
const KNOWN = /^(Add up to|Tick at least|Give the set|That isn’t a requirement|Keep labels|Keep a set|That set|That meeting|Seed one|Seed a whole)/;
const said = (message: string) => (KNOWN.test(message) ? message : 'Couldn’t save that. Try again.');
export type FocusWrite<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function saveFocusSet(sb: SupabaseClient, actorPersonId: number, set: { id: number | null; name: string; labels: string[]; items: string[] }): Promise<FocusWrite<{ id: number }>> {
  const { data, error } = await sb.rpc('focus_set_save', { p_actor: actorPersonId, p_set: set.id, p_name: set.name, p_labels: set.labels, p_items: set.items });
  return error ? { ok: false, error: said(error.message) } : { ok: true, id: Number(data) };
}

export async function deleteFocusSet(sb: SupabaseClient, id: number): Promise<FocusWrite> {
  const { error } = await sb.rpc('focus_set_delete', { p_set: id });
  return error ? { ok: false, error: said(error.message) } : { ok: true };
}

export async function seedFocusSet(sb: SupabaseClient, entryId: number, setId: number, actorPersonId: number): Promise<FocusWrite<{ count: number }>> {
  const { data, error } = await sb.rpc('meeting_seed_focus_set', { p_entry: entryId, p_set: setId, p_actor: actorPersonId });
  return error ? { ok: false, error: said(error.message) } : { ok: true, count: Number(data) };
}

/** Build a Plan B1: seed several top-level requirements in one call (one lock, idempotent per key). The keys this
 *  call newly seeded come back; a key already seeded is left as it was. B4 (one add path): the ONE seed of a
 *  requirement; every "add an offering without a teacher" reaches it through plannerAddOfferingAction. */
export async function seedMany(sb: SupabaseClient, entryId: number, keys: readonly string[], actorPersonId: number): Promise<FocusWrite<{ seeded: string[] }>> {
  const { data, error } = await sb.rpc('meeting_seed_many', { p_entry: entryId, p_keys: keys, p_actor: actorPersonId });
  return error ? { ok: false, error: said(error.message) } : { ok: true, seeded: (data ?? []) as string[] };
}

/** Build a Plan B2: save a new focus set and seed it on the meeting as one class, in one transaction. The set's id. */
export async function newMix(sb: SupabaseClient, entryId: number, name: string, items: readonly string[], actorPersonId: number): Promise<FocusWrite<{ setId: number }>> {
  const { data, error } = await sb.rpc('meeting_new_mix', { p_entry: entryId, p_name: name, p_items: [...items], p_actor: actorPersonId });
  return error ? { ok: false, error: said(error.message) } : { ok: true, setId: Number(data) };
}

/**
 * Build a Plan B2/B5b: change a mix's name and requirements on this meeting's class only; with `updateSet`, the focus
 * set too (one transaction). Other meetings keep their copy either way.
 */
export async function editMix(sb: SupabaseClient, entryId: number, setId: number, name: string, items: readonly string[], actorPersonId: number, updateSet = false): Promise<FocusWrite<{ count: number }>> {
  const { data, error } = await sb.rpc('meeting_edit_mix', { p_entry: entryId, p_set: setId, p_name: name, p_items: [...items], p_actor: actorPersonId, p_update_set: updateSet });
  return error ? { ok: false, error: said(error.message) } : { ok: true, count: Number(data) };
}

export async function unseedTopic(sb: SupabaseClient, entryId: number, key: string): Promise<FocusWrite> {
  const { error } = await sb.rpc('meeting_unseed_topic', { p_entry: entryId, p_key: key });
  return error ? { ok: false, error: said(error.message) } : { ok: true };
}

// ── the requirement search ───────────────────────────────────────────────────────────────────────────────────────

export const SEARCH_PAGE = 50;

type SearchDbRow = { kind: 'rank' | 'mb'; source_id: string; source_name: string; code: string; label: string; parent_code: string | null; parent_label: string | null; topic_key: string; top_level: boolean };

/** One page of requirements matching every typed word; `hasMore` when another page follows. */
export async function searchRequirements(sb: SupabaseClient, q: { text: string; kind: 'all' | 'rank' | 'mb'; source: string | null; offset: number }): Promise<{ rows: FocusSearchRow[]; hasMore: boolean }> {
  const { data, error } = await sb.rpc('focus_requirement_search', { p_q: q.text, p_kind: q.kind, p_source: q.source, p_offset: q.offset, p_limit: SEARCH_PAGE + 1 });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SearchDbRow[];
  return {
    rows: rows.slice(0, SEARCH_PAGE).map((r) => ({
      key: r.topic_key,
      kind: r.kind,
      sourceId: r.source_id,
      sourceName: r.source_name,
      code: r.code,
      label: r.label,
      parent: r.parent_code ? `${r.parent_code} · ${r.parent_label ?? ''}`.trim() : null,
      topLevel: r.top_level
    })),
    hasMore: rows.length > SEARCH_PAGE
  };
}

/** How many requirements match in each rank and badge. */
export async function searchCounts(sb: SupabaseClient, q: { text: string; kind: 'all' | 'rank' | 'mb' }): Promise<FocusSource[]> {
  const { data, error } = await sb.rpc('focus_requirement_counts', { p_q: q.text, p_kind: q.kind });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { kind: 'rank' | 'mb'; source_id: string; source_name: string; n: number }[]).map((r) => ({ kind: r.kind, id: r.source_id, name: r.source_name, n: Number(r.n) }));
}
