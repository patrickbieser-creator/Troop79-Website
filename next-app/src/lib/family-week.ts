/**
 * Meeting Planner III, the family side of a meeting (Plans/Meeting-Planner-III-Emails.md, E2): what one household
 * sees and may change for one meeting. Shared by /member/meeting (a verified sign-in) and /i/plan/<token> (the email's
 * scoped link). Server-only, service role; each caller decides WHICH scouts first.
 *
 *   - The plan is already set (N1): each scout's card shows the LIVE plan (lib/this-week), the planned requirements
 *     already ticked. Families accept it, change it, or say they can't come; they never build it.
 *   - One answer per scout (Plans/Meeting-Planner-III-Family.md): This plan looks good / Change my plan / Can't make
 *     it, saved as the scout's intent (the first two are coming).
 *   - Unticking a planned requirement applies at once (N2): an exclusion row, and placement leaves it out.
 *   - Anything added is a request (N7) that only flags the scout for the planners; it never places anyone. A Merit
 *     badge group scout's "Help teach" is the exception: it writes a helper row (D5).
 *   - The plan holds at most PLAN_MAX things and PLAN_MAX_MIN minutes (D1, D3): ticked items, requests and helping,
 *     checked here on every add; the request count again in the database under the scout's board lock.
 *   - The selected choice isn't stored: it reads back from what was saved (out, a change, coming).
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
import { classMinutes, HELP_KEY, HELP_TEACH_MIN, MB_CLASS_MIN, PLAN_MAX, planLoad, planRefusal, type FamilyChoice } from '@/lib/family-week-shared';
import { DEFAULT_TEACH_MINUTES, itemPart } from '@/lib/meeting-board-picklist';
import { sanitizeRpcError } from '@/lib/meeting-board-supply';

/** 'rank': a scout with planned rank work. 'done': a counted scout tonight has nothing left for. 'mb': the Merit badge
 *  group (First Class and up). */
export type FamilyScoutKind = 'rank' | 'done' | 'mb';

export interface FamilyItem {
  key: string;
  /** 'Second Class 6a', 'Merit badge'. */
  code: string;
  label: string;
  /** Still in the plan; false = the family unticked it. */
  on: boolean;
  /** Expected minutes (D4). */
  min: number;
  /** The Merit badge group's badge: on the plan, not for the family to take off. */
  fixed?: boolean;
}

export interface FamilyOption {
  key: string;
  label: string;
  sub: string;
  min: number;
  /** 'Merit badge', 'Second Class 2f': leads the second line (optionLine). */
  code?: string;
}

export interface FamilyScout {
  personId: number;
  firstName: string;
  /** The full display name: the signed-in page heads a card with it; the email's link page keeps the first name. */
  name: string;
  rankName: string;
  kind: FamilyScoutKind;
  intent: Intent | null;
  /** The answer as saved; null = Needs an answer. */
  choice: FamilyChoice | null;
  /** The group placement put them in ('Second Class'), with its teachers as families see them. */
  group: { key: string; name: string; teachers: string[] } | null;
  /** The planned requirements of their group, ticked unless the family took one off. */
  items: FamilyItem[];
  /** A Merit badge group scout helping teach (a helper row). */
  helping: boolean;
  /** A Merit badge group scout: the group they'd help teach. */
  helpGroup: { key: string; name: string; teachers: string[] } | null;
  /** "Also on Sunday": work ahead, the night's badges, helping teach. */
  also: FamilyOption[];
  suggestions: FamilyOption[];
  /** "Suggest something not on the list": the scout's own pick list. */
  requestable: (Pick<PickRow, 'key' | 'label' | 'codeLabel'> & { min: number })[];
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

export const partMinutes = (key: string, catalog: Catalog) =>
  classMinutes(itemPart(key, catalog.ranks, catalog.rankRequirements, catalog.meritBadges, catalog.meritBadgeRequirements)?.minutes ?? DEFAULT_TEACH_MINUTES);

/** A group column's minutes for one scout: its sub-requirements still open for them (all of them when the row has no
 *  marks), else the column's own time (D4). */
export function columnMinutes(c: TwGroup['columns'][number], catalog: Catalog, marks?: Record<string, unknown>): number {
  if (!c.subs.length) return partMinutes(c.key, catalog);
  const open = marks ? c.subs.filter((s) => marks[s.key] != null) : [];
  return classMinutes((open.length ? open : c.subs).reduce((n, s) => n + partMinutes(s.key, catalog), 0));
}

export const groupMinutes = (g: TwGroup, catalog: Catalog) => (g.kind === 'badge' ? MB_CLASS_MIN : classMinutes(g.columns.reduce((n, c) => n + columnMinutes(c, catalog), 0)));

function alsoFor(kind: FamilyScoutKind, row: TwRow | undefined, tw: ThisWeek, firstName: string, help: TwGroup | null, catalog: Catalog): FamilyOption[] {
  const out: FamilyOption[] = [];
  const ranks = tw.groups.filter((g) => g.kind === 'rank');
  if (kind === 'rank' && row?.groupKey) {
    const i = ranks.findIndex((g) => g.key === row.groupKey);
    const next = i >= 0 ? ranks[i + 1] : undefined;
    if (next) out.push({ key: next.key, label: `Work ahead: ${next.name}`, sub: `with the ${next.name} group`, min: groupMinutes(next, catalog) });
  }
  if (kind === 'done' && ranks.length) out.push({ key: 'teach', label: 'Help teach', sub: `show younger scouts what ${firstName} already knows`, min: HELP_TEACH_MIN });
  if (kind === 'mb' && help) {
    const who = help.teachers.length ? ` and ${help.teachers.map((t) => t.formal).join(' and ')}` : '';
    out.push({ key: HELP_KEY, label: 'Help teach', sub: `with the ${help.name} group${who}`, min: HELP_TEACH_MIN });
  }
  // A Merit badge group scout is offered the OTHER badges on Sunday; a younger scout every badge, with the caveat.
  for (const g of tw.groups.filter((x) => x.kind === 'badge' && !(kind === 'mb' && x.key === row?.groupKey))) {
    out.push({ key: g.key, label: `${g.name} merit badge`, code: 'Merit badge', sub: kind === 'mb' ? 'with a merit badge counselor' : 'usually First Class and up · a leader will confirm', min: MB_CLASS_MIN });
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
    const items: FamilyItem[] =
      kind === 'rank' && g
        ? g.columns.filter((c) => row!.open.includes(c.key)).map((c) => ({ key: c.key, code: `${g.name} ${c.code}`, label: c.label, on: !off.has(c.key), min: columnMinutes(c, catalog, row!.marks) }))
        : kind === 'mb' && g?.kind === 'badge'
          ? [{ key: g.key, code: 'Merit badge', label: `${g.name} merit badge`, on: true, min: MB_CLASS_MIN, fixed: true }]
          : [];
    const also = alsoFor(kind, row, tw, firstName, help, catalog);
    const pl = board.pickList;
    const next = pl.groups.find((x) => x.next)?.rows ?? [];
    const requestable = [...next, ...pl.working, ...pl.badges].map((r) => ({
      key: r.key,
      label: r.label,
      codeLabel: r.codeLabel,
      min: r.parts?.length ? classMinutes(r.parts.reduce((n, p) => n + p.minutes, 0)) : r.key.startsWith('mb:') ? MB_CLASS_MIN : partMinutes(r.key, catalog)
    }));
    const wordsBy = new Map<string, FamilyOption>([
      ...also.map((o) => [o.key, o] as const),
      ...requestable.map((r) => [r.key, { key: r.key, label: r.label, sub: '', code: r.codeLabel, min: r.min }] as const)
    ]);
    const suggestions = (answers.suggestions.get(scout.personId) ?? []).map((k) => wordsBy.get(k) ?? { key: k, label: k, sub: '', min: DEFAULT_TEACH_MINUTES });
    const helping = answers.helpers.has(scout.personId);
    const changed = items.some((i) => !i.on) || suggestions.length > 0 || helping;
    const choice: FamilyChoice | null = intent === 'not_coming' ? 'out' : intent !== 'coming' ? null : changed ? 'change' : 'ok';
    scouts.push({
      personId: scout.personId,
      firstName,
      name: scout.name,
      rankName: scout.currentRank ? (rankName.get(scout.currentRank) ?? scout.currentRank) : 'New scout',
      kind,
      intent,
      choice,
      group: g ? groupView(g) : null,
      items,
      helping,
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
  /** "Not sure yet": the undo for a nervous tap. Saved as undecided, which reads back as no answer. */
  | { op: 'unsure' }
  /** on = false: take the planned requirement off; true: put it back. */
  | { op: 'item'; key: string; on: boolean }
  | { op: 'suggest'; key: string; on: boolean }
  /** A Merit badge group scout's "Help teach" in Also on Sunday: the helper row (D5). */
  | { op: 'help'; on: boolean };

const CHOICES: readonly FamilyChoice[] = ['ok', 'change', 'out', 'mb', 'help'];

/** What the scout's plan holds now: ticked items, requests and helping (D3). */
export function scoutLoad(s: Pick<FamilyScout, 'items' | 'suggestions' | 'helping'>) {
  return planLoad(s.items, [...s.suggestions, ...(s.helping ? [{ min: HELP_TEACH_MIN }] : [])]);
}

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
  // Not sure yet clears only the answer: the plan's edits stay saved.
  if (op?.op === 'unsure') return setMeetingIntent(sb, writer, 'undecided');
  if (op?.op === 'help') {
    if (typeof op.on !== 'boolean') return { ok: false, error: 'Malformed request' };
    if (!op.on) {
      const { error } = await sb.from('meeting_scout_helpers').delete().eq('calendar_entry_id', entry).eq('person_id', person);
      return error ? { ok: false, error: 'That didn’t save. Try again.' } : { ok: true };
    }
    const s = (await loadFamilyWeek(sb, w.meeting, [person], w.catalog, w.actorPersonId, deps)).scouts[0];
    if (!s || !s.helpGroup || !s.also.some((o) => o.key === HELP_KEY)) return { ok: false, error: 'There’s no group to help teach this week.' };
    if (s.helping) return { ok: true };
    const no = planRefusal(s.firstName, scoutLoad(s), HELP_TEACH_MIN);
    if (no) return { ok: false, error: no };
    const { error } = await sb.from('meeting_scout_helpers').upsert({ calendar_entry_id: entry, person_id: person, group_key: s.helpGroup.key, set_by_person_id: w.actorPersonId, set_at: new Date().toISOString() });
    return error ? { ok: false, error: 'That didn’t save. Try again.' } : { ok: true };
  }
  if (op?.op === 'answer') {
    if (!CHOICES.includes(op.choice)) return { ok: false, error: 'Malformed request' };
    // An older email's "I'd like to teach" button.
    // Same limit as the Also on Sunday tap (qa-lead 2026-10-30): the helper row first, then coming.
    if (op.choice === 'help') {
      const res = await familyWrite(sb, w, { op: 'help', on: true }, deps);
      return res.ok ? setMeetingIntent(sb, writer, 'coming') : res;
    }
    const res = await setMeetingIntent(sb, writer, op.choice === 'out' ? 'not_coming' : 'coming');
    if (!res.ok || op.choice !== 'out') return res;
    // A scout who can't come can't help teach.
    const { error } = await sb.from('meeting_scout_helpers').delete().eq('calendar_entry_id', entry).eq('person_id', person);
    return error ? { ok: false, error: 'That didn’t save. Try again.' } : { ok: true };
  }
  if ((op?.op !== 'item' && op?.op !== 'suggest') || typeof op.key !== 'string' || typeof op.on !== 'boolean' || op.key.length > 200) return { ok: false, error: 'Malformed request' };

  if (op.op === 'item') {
    const s = (await loadFamilyWeek(sb, w.meeting, [person], w.catalog, w.actorPersonId, deps)).scouts[0];
    const item = s?.items.find((i) => i.key === op.key && !i.fixed);
    if (op.on) {
      // Putting one back has to fit the plan's limits like any add.
      if (s && item && !item.on) {
        const no = planRefusal(s.firstName, scoutLoad(s), item.min);
        if (no) return { ok: false, error: no };
      }
      const { error } = await sb.from('meeting_scout_exclusions').delete().eq('calendar_entry_id', entry).eq('person_id', person).eq('topic_key', op.key);
      return error ? { ok: false, error: 'That didn’t save. Try again.' } : { ok: true };
    }
    if (!item) return { ok: false, error: 'That isn’t in this scout’s plan.' };
    const { error } = await sb.from('meeting_scout_exclusions').upsert({ calendar_entry_id: entry, person_id: person, topic_key: op.key, set_by_person_id: w.actorPersonId }, { ignoreDuplicates: true });
    return error ? { ok: false, error: 'That didn’t save. Try again.' } : { ok: true };
  }

  if (!op.on) {
    const { error } = await sb.from('meeting_scout_suggestions').delete().eq('calendar_entry_id', entry).eq('person_id', person).eq('topic_key', op.key);
    return error ? { ok: false, error: 'That didn’t save. Try again.' } : { ok: true };
  }
  const week = await loadFamilyWeek(sb, w.meeting, [person], w.catalog, w.actorPersonId, deps);
  const s = week.scouts[0];
  if (!s) return { ok: false, error: 'Requests are for scouts.' };
  const option = (op.key !== HELP_KEY ? s.also.find((o) => o.key === op.key) : undefined) ?? (!isGroupKey(op.key) ? s.requestable.find((r) => r.key === op.key) : undefined);
  if (!option) return { ok: false, error: 'That isn’t something to request for this meeting.' };
  if (s.suggestions.some((x) => x.key === op.key)) return { ok: true };
  const load = scoutLoad(s);
  const no = planRefusal(s.firstName, load, option.min);
  if (no) return { ok: false, error: no };
  // The database holds the request count under the scout's lock: whatever room the ticked items and helping leave.
  const cap = PLAN_MAX - (load.things - s.suggestions.length);
  const { error } = await sb.rpc('meeting_add_suggestion_capped', { p_entry: entry, p_person: person, p_actor: w.actorPersonId, p_topic_key: op.key, p_cap: cap });
  if (!error) return { ok: true };
  return { ok: false, error: /^Suggest up to/.test(error.message) ? planRefusal(s.firstName, { things: PLAN_MAX, minutes: 0 }, 0)! : sanitizeRpcError(error.message) };
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
