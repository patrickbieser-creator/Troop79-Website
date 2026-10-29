/**
 * Meeting Planner III, the family side of a meeting (Plans/Meeting-Planner-III-Emails.md, E2): what one household
 * sees and may change for one meeting. Shared by /member/meeting (a verified sign-in) and /i/plan/<token> (the email's
 * scoped link). Server-only, service role; each caller decides WHICH scouts first.
 *
 *   - The plan is already set (N1): each scout's card shows the LIVE plan (lib/this-week), the planned requirements
 *     already ticked. Families accept it, change it, or say they can't come; they never build it.
 *   - One answer per scout, a radio of three (lib/family-week-shared FAMILY_CHOICES), saved as the scout's intent:
 *     every choice but Can't make it is Coming. "Help teach" (a Merit badge group scout) also writes a helper row.
 *   - Unticking a planned requirement applies at once (N2): an exclusion row, and placement leaves it out.
 *   - Anything added is a suggestion (N7), at most SUGGESTION_CAP per scout, counted again in the database under the
 *     scout's board lock. Suggestions only flag the scout for the planners; they never place anyone.
 *   - The selected choice isn't stored: it reads back from what was saved (out, help, a change, coming).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdvancementCatalog } from '@/lib/advancement-catalog';
import { loadBoardScouts, loadMeetingForWrite, loadScoutBoard, loadUpcomingMeetings, setMeetingIntent, type BoardMeeting } from '@/lib/meeting-board';
import { centralToday } from '@/lib/dates';
import { fetchMeetingLabels, fetchPeopleLists, loadPlannerLists, type PeopleLists } from '@/lib/people-lists';
import { buildThisWeek, PLANNER_WEEKS, type ThisWeek, type TwGroup, type TwRow } from '@/lib/this-week';
import { loadThisWeekData } from '@/lib/this-week-db';
import { firstNameOf, type Intent } from '@/lib/meeting-board-shared';
import type { PickRow } from '@/lib/meeting-board-picklist';
import { isGroupKey } from '@/lib/focus-plan';
import { SUGGESTION_CAP, type FamilyChoice } from '@/lib/family-week-shared';
import { sanitizeRpcError } from '@/lib/meeting-board-supply';

/** 'rank': a scout with planned rank work. 'done': a counted scout tonight has nothing left for. 'mb': the Merit badge
 *  group (First Class and up). */
export type FamilyScoutKind = 'rank' | 'done' | 'mb';

export interface FamilyItem {
  key: string;
  code: string;
  label: string;
  /** Still in the plan; false = the family unticked it. */
  on: boolean;
}

export interface FamilyOption {
  key: string;
  label: string;
  sub: string;
}

export interface FamilyScout {
  personId: number;
  firstName: string;
  rankName: string;
  kind: FamilyScoutKind;
  intent: Intent | null;
  /** The answer as saved; null = Needs an answer. */
  choice: FamilyChoice | null;
  /** The group placement put them in ('Second Class'), with its teachers as families see them. */
  group: { key: string; name: string; teachers: string[] } | null;
  /** The planned requirements of their group, ticked unless the family took one off. */
  items: FamilyItem[];
  /** A Merit badge group scout: the group they'd help teach. */
  helpGroup: { key: string; name: string; teachers: string[] } | null;
  /** "Also on Sunday": work ahead, the night's badges, helping teach. */
  also: FamilyOption[];
  suggestions: FamilyOption[];
  /** "Suggest something not on the list": the scout's own pick list. */
  requestable: Pick<PickRow, 'key' | 'label' | 'codeLabel'>[];
}

export interface FamilyWeek {
  entryId: number;
  date: string;
  focus: string[];
  scouts: FamilyScout[];
}

type Catalog = AdvancementCatalog;

/** A helper's group: the first rank group still short of a teacher, else the first rank group. */
function helpGroupOf(tw: ThisWeek): TwGroup | null {
  const ranks = tw.groups.filter((g) => g.kind === 'rank');
  return ranks.find((g) => !g.teachers.length) ?? ranks[0] ?? null;
}

const groupView = (g: TwGroup) => ({ key: g.key, name: g.name, teachers: g.teachers.map((t) => t.formal) });

function kindOf(row: TwRow | undefined): FamilyScoutKind {
  if (!row || !row.counted) return 'mb';
  return row.groupKey && row.open.length ? 'rank' : 'done';
}

interface Answers {
  exclusions: Map<number, Set<string>>;
  suggestions: Map<number, string[]>;
  helpers: Map<number, string>;
}

async function loadAnswers(sb: SupabaseClient, entryId: number, ids: readonly number[]): Promise<Answers> {
  const [x, g, h] = await Promise.all([
    sb.from('meeting_scout_exclusions').select('person_id, topic_key').eq('calendar_entry_id', entryId).in('person_id', [...ids]),
    sb.from('meeting_scout_suggestions').select('person_id, topic_key').eq('calendar_entry_id', entryId).in('person_id', [...ids]).order('created_at'),
    sb.from('meeting_scout_helpers').select('person_id, group_key').eq('calendar_entry_id', entryId).in('person_id', [...ids])
  ]);
  for (const r of [x, g, h]) if (r.error) throw new Error(r.error.message);
  const exclusions = new Map<number, Set<string>>();
  for (const r of (x.data ?? []) as { person_id: number; topic_key: string }[]) exclusions.set(r.person_id, (exclusions.get(r.person_id) ?? new Set()).add(r.topic_key));
  const suggestions = new Map<number, string[]>();
  for (const r of (g.data ?? []) as { person_id: number; topic_key: string }[]) suggestions.set(r.person_id, [...(suggestions.get(r.person_id) ?? []), r.topic_key]);
  return { exclusions, suggestions, helpers: new Map(((h.data ?? []) as { person_id: number; group_key: string }[]).map((r) => [r.person_id, r.group_key])) };
}

/** The plan as placement makes it BEFORE a family's unticks: what the card lists (ticked or not). */
async function planWithoutUnticks(sb: SupabaseClient, meeting: Pick<BoardMeeting, 'entryId' | 'date'>, catalog: Catalog, lists: Pick<PeopleLists, 'pool'>): Promise<ThisWeek> {
  const data = await loadThisWeekData(sb, meeting, lists, catalog);
  return buildThisWeek({ ...data.input, exclusions: undefined });
}

function alsoFor(kind: FamilyScoutKind, row: TwRow | undefined, tw: ThisWeek, firstName: string): FamilyOption[] {
  const out: FamilyOption[] = [];
  const ranks = tw.groups.filter((g) => g.kind === 'rank');
  if (kind === 'rank' && row?.groupKey) {
    const i = ranks.findIndex((g) => g.key === row.groupKey);
    const next = i >= 0 ? ranks[i + 1] : undefined;
    if (next) out.push({ key: next.key, label: `Work ahead: ${next.name}`, sub: `${next.columns.map((c) => c.code).join(', ')} with the ${next.name} group` });
  }
  if (kind === 'done' && ranks.length) out.push({ key: 'teach', label: 'Help teach', sub: `Show younger scouts what ${firstName} already knows` });
  if (kind !== 'mb') {
    for (const g of tw.groups.filter((x) => x.kind === 'badge')) out.push({ key: g.key, label: `${g.name} merit badge`, sub: 'Usually First Class and up · a leader will confirm' });
  }
  return out;
}

export async function loadFamilyWeek(
  sb: SupabaseClient,
  meeting: Pick<BoardMeeting, 'entryId' | 'date'>,
  scoutPersonIds: readonly number[],
  catalog: Catalog,
  viewerPersonId: number | null,
  deps: { lists?: Pick<PeopleLists, 'pool'> } = {}
): Promise<FamilyWeek> {
  const lists = deps.lists ?? (await loadPlannerLists());
  const [tw, answers, boards] = await Promise.all([
    planWithoutUnticks(sb, meeting, catalog, lists),
    loadAnswers(sb, meeting.entryId, scoutPersonIds),
    loadBoardScouts(sb, scoutPersonIds).then((scouts) => Promise.all(scouts.map(async (scout) => ({ scout, board: await loadScoutBoard(sb, meeting, scout, catalog, { viewerPersonId }) }))))
  ]);
  const rows = new Map(tw.sections.flatMap((s) => s.rows).map((r) => [r.personId, r]));
  const groups = new Map(tw.groups.map((g) => [g.key, g]));
  const help = helpGroupOf(tw);
  const rankName = new Map(catalog.ranks.map((r) => [r.id, r.display_name]));
  const scouts: FamilyScout[] = [];
  for (const { scout, board } of boards) {
    const row = rows.get(scout.personId);
    const kind = kindOf(row);
    const firstName = firstNameOf(scout.name);
    const intent = board.view.intent;
    const off = answers.exclusions.get(scout.personId) ?? new Set<string>();
    const g = row?.groupKey ? groups.get(row.groupKey) : undefined;
    const items: FamilyItem[] = kind === 'rank' && g ? g.columns.filter((c) => row!.open.includes(c.key)).map((c) => ({ key: c.key, code: c.code, label: c.label, on: !off.has(c.key) })) : [];
    const also = alsoFor(kind, row, tw, firstName);
    const pl = board.pickList;
    const next = pl.groups.find((x) => x.next)?.rows ?? [];
    const requestable = [...next, ...pl.working, ...pl.badges].map((r) => ({ key: r.key, label: r.label, codeLabel: r.codeLabel }));
    const wordsBy = new Map<string, FamilyOption>([...also.map((o) => [o.key, o] as const), ...requestable.map((r) => [r.key, { key: r.key, label: r.label, sub: r.codeLabel }] as const)]);
    const suggestions = (answers.suggestions.get(scout.personId) ?? []).map((k) => wordsBy.get(k) ?? { key: k, label: k, sub: '' });
    const helping = answers.helpers.has(scout.personId);
    const changed = items.some((i) => !i.on) || suggestions.length > 0;
    const choice: FamilyChoice | null =
      intent === 'not_coming' ? 'out' : intent !== 'coming' ? null : helping ? 'help' : changed ? 'change' : kind === 'mb' && g?.kind === 'badge' ? 'mb' : 'ok';
    scouts.push({
      personId: scout.personId,
      firstName,
      rankName: scout.currentRank ? (rankName.get(scout.currentRank) ?? scout.currentRank) : 'New scout',
      kind,
      intent,
      choice,
      group: g ? groupView(g) : null,
      items,
      helpGroup: kind === 'mb' && help ? groupView(help) : null,
      also,
      suggestions,
      requestable
    });
  }
  return { entryId: meeting.entryId, date: meeting.date, focus: tw.focus.map((f) => f.name), scouts };
}

export type FamilyWrite = { ok: true } | { ok: false; error: string };

export type FamilyOp =
  | { op: 'answer'; choice: FamilyChoice }
  /** on = false: take the planned requirement off; true: put it back. */
  | { op: 'item'; key: string; on: boolean }
  | { op: 'suggest'; key: string; on: boolean };

const CHOICES: readonly FamilyChoice[] = ['ok', 'change', 'out', 'mb', 'help'];

/**
 * One family write for one scout the caller has already allowed. An untick must name a requirement in the scout's
 * live plan; a suggestion must be one of the card's options or on the scout's own pick list; a sixth is refused.
 */
export async function familyWrite(
  sb: SupabaseClient,
  w: { meeting: Pick<BoardMeeting, 'entryId' | 'date'>; actorPersonId: number; scoutPersonId: number; catalog: Catalog },
  op: FamilyOp,
  deps: { lists?: Pick<PeopleLists, 'pool'> } = {}
): Promise<FamilyWrite> {
  const entry = w.meeting.entryId;
  const person = w.scoutPersonId;
  const writer = { entryId: entry, personId: person, actorPersonId: w.actorPersonId, leader: false };
  if (op?.op === 'answer') {
    if (!CHOICES.includes(op.choice)) return { ok: false, error: 'Malformed request' };
    if (op.choice === 'help') {
      const week = await loadFamilyWeek(sb, w.meeting, [person], w.catalog, w.actorPersonId, deps);
      const s = week.scouts[0];
      if (!s || s.kind !== 'mb' || !s.helpGroup) return { ok: false, error: 'There’s no group to help teach this week.' };
      const res = await setMeetingIntent(sb, writer, 'coming');
      if (!res.ok) return res;
      const { error } = await sb.from('meeting_scout_helpers').upsert({ calendar_entry_id: entry, person_id: person, group_key: s.helpGroup.key, set_by_person_id: w.actorPersonId, set_at: new Date().toISOString() });
      return error ? { ok: false, error: 'That didn’t save. Try again.' } : { ok: true };
    }
    const res = await setMeetingIntent(sb, writer, op.choice === 'out' ? 'not_coming' : 'coming');
    if (!res.ok) return res;
    const { error } = await sb.from('meeting_scout_helpers').delete().eq('calendar_entry_id', entry).eq('person_id', person);
    return error ? { ok: false, error: 'That didn’t save. Try again.' } : { ok: true };
  }
  if ((op?.op !== 'item' && op?.op !== 'suggest') || typeof op.key !== 'string' || typeof op.on !== 'boolean' || op.key.length > 200) return { ok: false, error: 'Malformed request' };

  if (op.op === 'item') {
    if (op.on) {
      const { error } = await sb.from('meeting_scout_exclusions').delete().eq('calendar_entry_id', entry).eq('person_id', person).eq('topic_key', op.key);
      return error ? { ok: false, error: 'That didn’t save. Try again.' } : { ok: true };
    }
    const week = await loadFamilyWeek(sb, w.meeting, [person], w.catalog, w.actorPersonId, deps);
    if (!week.scouts[0]?.items.some((i) => i.key === op.key)) return { ok: false, error: 'That isn’t in this scout’s plan.' };
    const { error } = await sb.from('meeting_scout_exclusions').upsert({ calendar_entry_id: entry, person_id: person, topic_key: op.key, set_by_person_id: w.actorPersonId }, { ignoreDuplicates: true });
    return error ? { ok: false, error: 'That didn’t save. Try again.' } : { ok: true };
  }

  if (!op.on) {
    const { error } = await sb.from('meeting_scout_suggestions').delete().eq('calendar_entry_id', entry).eq('person_id', person).eq('topic_key', op.key);
    return error ? { ok: false, error: 'That didn’t save. Try again.' } : { ok: true };
  }
  const week = await loadFamilyWeek(sb, w.meeting, [person], w.catalog, w.actorPersonId, deps);
  const s = week.scouts[0];
  if (!s) return { ok: false, error: 'Suggestions are for scouts.' };
  const allowed = s.also.some((o) => o.key === op.key) || (!isGroupKey(op.key) && s.requestable.some((r) => r.key === op.key));
  if (!allowed) return { ok: false, error: 'That isn’t something to suggest for this meeting.' };
  const { error } = await sb.rpc('meeting_add_suggestion_capped', { p_entry: entry, p_person: person, p_actor: w.actorPersonId, p_topic_key: op.key, p_cap: SUGGESTION_CAP });
  return error ? { ok: false, error: /^Suggest up to/.test(error.message) ? error.message : sanitizeRpcError(error.message) } : { ok: true };
}

/** For a test or a script, outside a Next request: the planner's lists without the cross-request cache. */
export const uncachedLists = (sb: SupabaseClient) => fetchPeopleLists(sb);

/**
 * The meeting a family write is for, or null (qa-lead 2026-10-28): a published troop meeting that takes sign-ups, today
 * or later, and one of the next PLANNER_WEEKS meetings the planner offers. Never a campout, a draft or a far-off entry.
 */
export async function loadOpenMeeting(sb: SupabaseClient, entryId: number): Promise<BoardMeeting | null> {
  const [meeting, labels] = await Promise.all([loadMeetingForWrite(sb, entryId), fetchMeetingLabels(sb)]);
  if (!meeting || !meeting.published || meeting.closed || meeting.date < centralToday()) return null;
  const upcoming = (await loadUpcomingMeetings(sb, PLANNER_WEEKS * 2, undefined, labels)).filter((m) => !m.closed).slice(0, PLANNER_WEEKS);
  return upcoming.some((m) => m.entryId === entryId) ? meeting : null;
}
