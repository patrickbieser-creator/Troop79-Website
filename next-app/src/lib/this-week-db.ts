/**
 * Meeting Planner III, This week: every read the screen needs for one meeting, shaped into lib/this-week's input.
 * Server-only (service-role client); the page gates with plannerAccess first. Reads run side by side; nothing here
 * loops per scout or per group (the query count is pinned by tests/this-week-db.test.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAdvancementCatalog, type AdvancementCatalog } from '@/lib/advancement-catalog';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { loadBoardStamp, loadBoardState, loadIntents, type BoardMeeting } from '@/lib/meeting-board';
import { loadSupplyRows, loadTeacherPeople, teachContext } from '@/lib/meeting-board-supply';
import { boardScoutsOf, type PlannerLists } from '@/lib/people-lists';
import type { FocusProgress, ScoutRole } from '@/lib/focus-plan';
import type { ThisWeekInput } from '@/lib/this-week';

/** Each scout's rank and merit badge requirement leaves on the ledger, and the badges they have earned (paginated: the
 *  ledger is far past 1000 rows). An earned badge counts as done even when its requirements were never logged one by
 *  one (most badges earned before the troop's requirement-level ledger). */
export async function loadLeafCodes(sb: SupabaseClient, scoutIds: readonly string[]): Promise<Map<string, FocusProgress>> {
  const out = new Map<string, { rankCodes: Set<string>; mbCodes: Set<string>; awardedMbs: Set<string> }>(
    scoutIds.map((id) => [id, { rankCodes: new Set(), mbCodes: new Set(), awardedMbs: new Set() }])
  );
  if (!scoutIds.length) return out;
  const [rows, awarded] = await Promise.all([
    fetchAllRows<{ scout_id: string; code: string; kind: string }>((from, to) =>
      sb.from('ledger_active').select('scout_id, code, kind').in('kind', ['rank_requirement', 'merit_badge_requirement']).in('scout_id', [...scoutIds]).order('id').range(from, to)
    ),
    fetchAllRows<{ scout_id: string; mb_id: string }>((from, to) =>
      sb.from('mb_progress').select('scout_id, mb_id').eq('awarded', true).in('scout_id', [...scoutIds]).order('scout_id').order('mb_id').range(from, to)
    )
  ]);
  for (const r of rows) {
    const p = out.get(r.scout_id);
    if (!p) continue;
    (r.kind === 'rank_requirement' ? p.rankCodes : p.mbCodes).add(r.code);
  }
  for (const a of awarded) out.get(a.scout_id)?.awardedMbs.add(a.mb_id);
  return out;
}

type TopicRow = {
  topic_key: string;
  kind: string;
  title: string | null;
  focus_set_id: number | null;
  seeded_at: string | null;
  meeting_topic_members: { item_key: string; position: number }[] | null;
};

/** The meeting's focus (seeded 'fg:' topics with their frozen items) and the single requirements seeded by hand. */
export async function loadMeetingFocus(sb: SupabaseClient, entryId: number): Promise<Pick<ThisWeekInput, 'focus' | 'seededSingles' | 'titles'>> {
  const { data, error } = await sb
    .from('meeting_topics')
    .select('topic_key, kind, title, focus_set_id, seeded_at, meeting_topic_members(item_key, position)')
    .eq('calendar_entry_id', entryId)
    .or('seeded_at.not.is.null,kind.eq.freeform')
    .order('seeded_at', { nullsFirst: false })
    .order('id');
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as TopicRow[];
  const seeded = rows.filter((r) => r.seeded_at);
  return {
    focus: seeded
      .filter((r) => r.kind === 'focus_group')
      .map((r) => ({
        key: r.topic_key,
        title: r.title ?? r.topic_key,
        setId: r.focus_set_id,
        members: [...(r.meeting_topic_members ?? [])].sort((a, b) => a.position - b.position).map((m) => m.item_key)
      })),
    seededSingles: seeded.filter((r) => r.kind === 'rank_req' || r.kind === 'mb_req').map((r) => r.topic_key),
    titles: new Map(rows.filter((r) => r.kind === 'freeform' && r.title).map((r) => [r.topic_key, r.title!]))
  };
}

export async function loadScoutRoles(sb: SupabaseClient, entryId: number): Promise<Map<number, ScoutRole>> {
  const { data, error } = await sb.from('meeting_scout_roles').select('person_id, role, ref_key').eq('calendar_entry_id', entryId);
  if (error) throw new Error(error.message);
  const out = new Map<number, ScoutRole>();
  for (const r of (data ?? []) as { person_id: number; role: ScoutRole['role']; ref_key: string | null }[]) {
    out.set(r.person_id, r.role === 'teach' ? { role: 'teach' } : { role: r.role, key: r.ref_key ?? '' });
  }
  return out;
}

export async function loadNightBadges(sb: SupabaseClient, entryId: number): Promise<string[]> {
  const { data, error } = await sb.from('meeting_night_badges').select('mb_id').eq('calendar_entry_id', entryId).order('created_at');
  if (error) throw new Error(error.message);
  return ((data ?? []) as { mb_id: string }[]).map((r) => r.mb_id);
}

/** "Can't make it" notes left on the family page (F3b), by person. */
async function loadIntentNotes(sb: SupabaseClient, entryId: number): Promise<Map<number, string>> {
  const { data, error } = await sb.from('meeting_intents').select('person_id, note').eq('calendar_entry_id', entryId).eq('intent', 'not_coming').not('note', 'is', null);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as { person_id: number; note: string }[]).map((r) => [r.person_id, r.note]));
}

/** A family's answers that change or flag the plan (Emails E2): unticks, helper answers and suggestions, by personId. */
export async function loadFamilyAnswers(sb: SupabaseClient, entryId: number): Promise<Pick<ThisWeekInput, 'exclusions' | 'helpers' | 'suggestions' | 'teacherNotes'>> {
  const [x, h, g, n] = await Promise.all([
    sb.from('meeting_scout_exclusions').select('person_id, topic_key').eq('calendar_entry_id', entryId),
    sb.from('meeting_scout_helpers').select('person_id, group_key').eq('calendar_entry_id', entryId),
    sb.from('meeting_scout_suggestions').select('person_id, topic_key').eq('calendar_entry_id', entryId).order('created_at'),
    sb.from('meeting_invites').select('topic_key, invitee_person_id, decline_note, responded_at').eq('calendar_entry_id', entryId).eq('kind', 'teach').eq('response', 'declined').not('decline_note', 'is', null).order('responded_at')
  ]);
  for (const r of [x, h, g, n]) if (r.error) throw new Error(r.error.message);
  const exclusions = new Map<number, Set<string>>();
  for (const r of (x.data ?? []) as { person_id: number; topic_key: string }[]) exclusions.set(r.person_id, (exclusions.get(r.person_id) ?? new Set()).add(r.topic_key));
  const suggestions = new Map<number, string[]>();
  for (const r of (g.data ?? []) as { person_id: number; topic_key: string }[]) suggestions.set(r.person_id, [...(suggestions.get(r.person_id) ?? []), r.topic_key]);
  return {
    exclusions,
    helpers: new Map(((h.data ?? []) as { person_id: number; group_key: string }[]).map((r) => [r.person_id, r.group_key])),
    suggestions,
    teacherNotes: ((n.data ?? []) as { topic_key: string; invitee_person_id: number; decline_note: string }[]).map((r) => ({ key: r.topic_key, personId: r.invitee_person_id, note: r.decline_note }))
  };
}

export interface ThisWeekData {
  input: ThisWeekInput;
  stamp: string;
  catalog: AdvancementCatalog;
}

/** `catalog`: pass one outside a Next request (tests): the cached loader needs Next's cache. */
export async function loadThisWeekData(
  sb: SupabaseClient,
  meeting: Pick<BoardMeeting, 'entryId' | 'date'>,
  lists: Pick<PlannerLists, 'pool'>,
  given?: AdvancementCatalog
): Promise<ThisWeekData> {
  const catalog = given ?? (await loadAdvancementCatalog());
  const scoutsIn = boardScoutsOf(lists);
  const [scouts, progress, teachers, intents, supply, focus, roles, nightBadges, stamp, answers, intentNotes] = await Promise.all([
    loadBoardState(sb, meeting, catalog, scoutsIn),
    loadLeafCodes(sb, scoutsIn.map((s) => s.scoutId)),
    loadTeacherPeople(sb, 'all', meeting.date, catalog, { pool: lists.pool }),
    loadIntents(sb, meeting.entryId),
    loadSupplyRows(sb, [meeting.entryId]),
    loadMeetingFocus(sb, meeting.entryId),
    loadScoutRoles(sb, meeting.entryId),
    loadNightBadges(sb, meeting.entryId),
    loadBoardStamp(sb, meeting.entryId),
    loadFamilyAnswers(sb, meeting.entryId),
    loadIntentNotes(sb, meeting.entryId)
  ]);
  // A family-page "Can't make it" note shows under each group the person was down to teach (F3b).
  const notesFromPage = supply.topicTeachers.flatMap((t) => (intentNotes.has(t.personId) ? [{ key: t.key, personId: t.personId, note: intentNotes.get(t.personId)! }] : []));
  return {
    catalog,
    stamp,
    input: {
      catalog,
      ctx: teachContext(catalog),
      scouts: scouts.map((s) => ({ personId: s.personId, scoutId: s.scoutId, name: s.name, currentRank: s.currentRank, intent: s.intent, picks: s.picks })),
      progress,
      ...focus,
      nightBadges,
      roles,
      teachers: [...teachers.values()].filter((p) => p.eligible !== false),
      intents,
      topicTeachers: supply.topicTeachers.map((t) => ({ key: t.key, personId: t.personId, note: t.note })),
      ...answers,
      teacherNotes: [...(answers.teacherNotes ?? []), ...notesFromPage]
    }
  };
}

/** The coming weeks strip: each meeting's focus names ('First aid + Citizenship'), one query for all of them. */
export async function loadFocusNames(sb: SupabaseClient, entryIds: readonly number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>(entryIds.map((id) => [id, []]));
  if (!entryIds.length) return out;
  const [topics, badges] = await Promise.all([
    sb.from('meeting_topics').select('calendar_entry_id, title').in('calendar_entry_id', [...entryIds]).eq('kind', 'focus_group').not('seeded_at', 'is', null).order('seeded_at'),
    sb.from('meeting_night_badges').select('calendar_entry_id, merit_badges(name)').in('calendar_entry_id', [...entryIds]).order('created_at')
  ]);
  const err = topics.error ?? badges.error;
  if (err) throw new Error(err.message);
  for (const t of (topics.data ?? []) as { calendar_entry_id: number; title: string | null }[]) if (t.title) out.get(t.calendar_entry_id)?.push(t.title);
  type B = { calendar_entry_id: number; merit_badges: { name: string } | { name: string }[] | null };
  for (const b of (badges.data ?? []) as unknown as B[]) {
    const name = Array.isArray(b.merit_badges) ? b.merit_badges[0]?.name : b.merit_badges?.name;
    if (name) out.get(b.calendar_entry_id)?.push(name);
  }
  return out;
}
