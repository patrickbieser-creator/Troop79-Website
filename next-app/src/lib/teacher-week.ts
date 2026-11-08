/**
 * Meeting Planner III, an adult's or Junior Leader's card on the family page (Plans/Meeting-Planner-III-Family.md, F3;
 * prototypes/meeting-plan-III/Family.dc.html): the classes on Sunday's plan as one teacher sees them. Server-only.
 *
 *   - A class is a group of the night (lib/this-week). Teaching it = a meeting_topic_teachers row on the group's key;
 *     the first row (lead, then sign-up order) teaches, later rows help teach (D6).
 *   - A row this person entered themself was signed up on this page; any other is pre-assigned by a planner (D7).
 *   - The Merit badge group's classes are adults only (D8).
 *   - Load = classes held (groups, other topics, skill offers on this meeting) and their minutes, against
 *     TEACH_MAX_CLASSES / TEACH_MAX_MIN.
 *   - Asked (Plans/Planner-Teacher-Email-To-Family-Card.md): the groups a sent teacher email asked them about, read
 *     from the emails (this-week-db loadTeacherAsks), never stored on a link. Not their own; out of needs/taught.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdvancementCatalog } from '@/lib/advancement-catalog';
import type { BoardMeeting } from '@/lib/meeting-board';
import { loadPlannerLists, type PeopleLists } from '@/lib/people-lists';
import { buildThisWeek, type ThisWeek, type TwGroup } from '@/lib/this-week';
import { loadThisWeekData } from '@/lib/this-week-db';
import { loadSupplyRows, loadTeacherPeople } from '@/lib/meeting-board-supply';
import { firstNameOf, type Intent } from '@/lib/meeting-board-shared';
import { DEFAULT_TEACH_MINUTES, topicWords } from '@/lib/meeting-board-picklist';
import { canonicalGroupKey, isGroupKey } from '@/lib/focus-plan';
import { groupMinutes } from '@/lib/family-week';
import { classMinutes, withMinutes } from '@/lib/family-week-shared';

export interface TeacherClass {
  key: string;
  /** 'Second Class group', 'First Aid merit badge'. */
  label: string;
  /** 'Second Class 6, 7 - 45 min · 9 scouts'. */
  line: string;
  min: number;
  scouts: number;
  /** What it covers: '6a · First aid for Second Class'. */
  parts: string[];
  /** Who else teaches it, as families see them. */
  teachers: string[];
  adultsOnly: boolean;
}

/** A group a teacher email asked them about: their No (with its note) stands until they're asked again. */
export interface AskedClass extends TeacherClass {
  saidNo: boolean;
  note: string | null;
}

export interface MyClass extends TeacherClass {
  role: 'teach' | 'help';
  /** Put there by a planner, not signed up on this page. */
  preassigned: boolean;
  /** Their yes to this group stands (plan-states 'confirmed'), whoever put them there. */
  confirmed?: boolean;
}

/** Something else this person holds on the meeting: a requirement or freeform topic, or a skill offer. */
export interface MyOther {
  kind: 'topic' | 'offer';
  key: string;
  label: string;
  line: string;
  min: number;
  preassigned: boolean;
}

export interface TeacherWeek {
  entryId: number;
  personId: number;
  firstName: string;
  junior: boolean;
  intent: Intent | null;
  /** Their note with Can't make it this week (F3b); null without one. */
  note: string | null;
  mine: MyClass[];
  other: MyOther[];
  /** Groups a teacher email asked them about, not theirs now (shown first; not repeated in needs/taught). */
  asked: AskedClass[];
  /** Classes on the plan with no teacher yet, then the ones that have one. Neither lists this person's own. */
  needs: TeacherClass[];
  taught: TeacherClass[];
  load: { classes: number; minutes: number };
}

type Catalog = AdvancementCatalog;

function classOf(g: TwGroup, catalog: Catalog, me: number | null): TeacherClass {
  const min = groupMinutes(g, catalog);
  const scouts = `${g.members.length} ${g.members.length === 1 ? 'scout' : 'scouts'}`;
  const parts = g.kind === 'rank' ? g.columns.flatMap((c) => (c.subs.length ? c.subs : [c]).map((s) => `${s.code} · ${s.label}`)) : [];
  const code = g.kind === 'rank' ? `${g.name} ${g.columns.map((c) => c.code).join(', ')}` : g.kind === 'station' ? 'Station' : 'Merit badge';
  return {
    key: g.key,
    label: g.title,
    line: `${withMinutes(code, min)} · ${scouts}`,
    min,
    scouts: g.members.length,
    parts,
    teachers: g.teachers.filter((t) => t.personId !== me).map((t) => t.formal),
    // A station is merit badge work (station rotations): adults teach it, as they do a badge group.
    adultsOnly: g.kind === 'badge' || g.kind === 'station'
  };
}

/** The pure part: what one teacher sees, from the night's plan and the meeting's teacher rows in sign-up order. */
export function buildTeacherWeek(
  tw: Pick<ThisWeek, 'groups'>,
  rows: { topicTeachers: readonly { key: string; personId: number; enteredByPersonId: number | null }[]; skillOffers: readonly { personId: number; skillId: string }[] },
  me: { personId: number; name: string; junior: boolean; intent: Intent | null; note?: string | null },
  catalog: Catalog,
  entryId: number,
  words: (key: string) => { label: string; codeLabel: string; minutes: number | null } | null,
  /** Merged split groups: a teacher of Group 2 or 3 teaches the one group (canonicalGroupKey). */
  mergedBases?: ReadonlySet<string>,
  /** The meeting's sent teacher emails and teacher answers (everyone's; this person's are picked out here). */
  confirm: { asks: readonly { personId: number; group: string; at: string }[]; answers: readonly { personId: number; key: string; answer: 'yes' | 'no'; answeredAt: string; note: string | null }[] } = { asks: [], answers: [] }
): TeacherWeek {
  const groups = new Map(tw.groups.map((g) => [g.key, g]));
  const canon = (key: string) => canonicalGroupKey(key, mergedBases);
  const seen = new Set<string>();
  const mineRows = rows.topicTeachers.filter((r) => r.personId === me.personId);
  const mine: MyClass[] = [];
  const other: MyOther[] = [];
  for (const r of mineRows) {
    const preassigned = r.enteredByPersonId != null && r.enteredByPersonId !== me.personId;
    const g = groups.get(canon(r.key));
    if (g) {
      if (seen.has(g.key)) continue;
      seen.add(g.key);
      const first = rows.topicTeachers.find((x) => canon(x.key) === g.key);
      mine.push({ ...classOf(g, catalog, me.personId), role: first?.personId === me.personId ? 'teach' : 'help', preassigned, confirmed: g.teachers.some((t) => t.personId === me.personId && t.state === 'confirmed') });
      continue;
    }
    // A group no longer on the plan holds nothing tonight.
    if (isGroupKey(r.key)) continue;
    const w = words(r.key);
    const min = classMinutes(w?.minutes ?? DEFAULT_TEACH_MINUTES);
    other.push({ kind: 'topic', key: r.key, label: w?.label ?? r.key, line: withMinutes(w?.codeLabel || 'Offered', min), min, preassigned });
  }
  for (const o of rows.skillOffers.filter((x) => x.personId === me.personId)) {
    other.push({ kind: 'offer', key: o.skillId, label: words(`skill:${o.skillId}`)?.label ?? o.skillId, line: withMinutes('Any requirement', DEFAULT_TEACH_MINUTES), min: DEFAULT_TEACH_MINUTES, preassigned: false });
  }
  const mineKeys = new Set(mine.map((m) => m.key));
  // The newest ask per group (merged split keys read as the one group).
  const askedAt = new Map<string, string>();
  for (const a of confirm.asks) {
    if (a.personId !== me.personId) continue;
    const key = canon(a.group);
    if (Date.parse(a.at) > Date.parse(askedAt.get(key) ?? '1970-01-01T00:00:00Z')) askedAt.set(key, a.at);
  }
  const lastNo = (key: string) =>
    confirm.answers
      .filter((a) => a.personId === me.personId && canon(a.key) === key)
      .sort((a, b) => Date.parse(b.answeredAt) - Date.parse(a.answeredAt))[0];
  const asked: AskedClass[] = tw.groups
    .filter((g) => askedAt.has(g.key) && !mineKeys.has(g.key))
    .map((g) => {
      const a = lastNo(g.key);
      const saidNo = a?.answer === 'no' && Date.parse(a.answeredAt) >= Date.parse(askedAt.get(g.key)!);
      return { ...classOf(g, catalog, me.personId), saidNo, note: saidNo ? a!.note : null };
    });
  const askedKeys = new Set(asked.map((c) => c.key));
  const open = tw.groups.filter((g) => !mineKeys.has(g.key) && !askedKeys.has(g.key)).map((g) => ({ g, c: classOf(g, catalog, me.personId) }));
  const held = [...mine, ...other];
  return {
    entryId,
    personId: me.personId,
    firstName: firstNameOf(me.name),
    junior: me.junior,
    intent: me.intent,
    note: me.note ?? null,
    mine,
    other,
    asked,
    needs: open.filter((x) => !x.g.teachers.length).map((x) => x.c),
    taught: open.filter((x) => x.g.teachers.length).map((x) => x.c),
    load: { classes: held.length, minutes: held.reduce((n, x) => n + x.min, 0) }
  };
}

/** One teacher's card for one meeting, or null when they can't teach. */
export async function loadTeacherWeek(
  sb: SupabaseClient,
  meeting: Pick<BoardMeeting, 'entryId' | 'date'>,
  catalog: Catalog,
  personId: number,
  deps: { lists?: Pick<PeopleLists, 'pool'> } = {}
): Promise<TeacherWeek | null> {
  const lists = deps.lists ?? (await loadPlannerLists());
  const [data, rows, people, noteRow] = await Promise.all([
    loadThisWeekData(sb, meeting, lists, catalog),
    loadSupplyRows(sb, [meeting.entryId]),
    loadTeacherPeople(sb, [personId], meeting.date, catalog, { evenIfIneligible: true }),
    sb.from('meeting_intents').select('note').eq('calendar_entry_id', meeting.entryId).eq('person_id', personId).maybeSingle()
  ]);
  if (noteRow.error) throw new Error(noteRow.error.message);
  const me = people.get(personId);
  if (!me) return null;
  const tw = buildThisWeek(data.input);
  const skillName = new Map(catalog.skills.map((s) => [s.id, s.name]));
  const titles = new Map(rows.freeform.map((f) => [f.key, f.title]));
  const words = (key: string) =>
    key.startsWith('skill:')
      ? { label: skillName.get(key.slice(6)) ?? key.slice(6), codeLabel: 'Any requirement', minutes: null }
      : topicWords(key, catalog.ranks, catalog.rankRequirements, catalog.meritBadges, titles, { mbReqs: catalog.meritBadgeRequirements });
  return buildTeacherWeek(tw, rows, { personId, name: me.displayName, junior: me.kind === 'junior', intent: data.input.intents.get(personId) ?? null, note: (noteRow.data as { note: string | null } | null)?.note ?? null }, catalog, meeting.entryId, words, data.input.mergedBases, {
    asks: data.input.teacherAsks ?? [],
    answers: data.input.teacherAnswers ?? []
  });
}

/** Minutes a key would add to someone's Sunday: a class of the night, else the catalog's time for it. */
export function minutesOf(week: TeacherWeek, key: string, catalog: Catalog): number {
  const c = [...week.asked, ...week.needs, ...week.taught].find((x) => x.key === key);
  if (c) return c.min;
  return classMinutes(topicWords(key, catalog.ranks, catalog.rankRequirements, catalog.meritBadges, undefined, { mbReqs: catalog.meritBadgeRequirements })?.minutes ?? DEFAULT_TEACH_MINUTES);
}
