/**
 * Meeting Planner III, This week (Plans/Meeting-Planner-III.md): the screen's whole view model, shaped from the
 * placement (lib/focus-plan) plus the meeting's teachers, answers, picks and offers. Pure and serializable: the page
 * loads (lib/this-week-db), this shapes, the client renders. Live at the meeting (Decision 10) reads the same model.
 */
import type { AdvancementCatalog } from '@/lib/advancement-catalog';
import { buildFocusPlan, canonicalGroupKey, isGroupKey, type CellMark, type FocusInput, type FocusProgress, type FocusRow, type RowStatus, type ScoutRole } from '@/lib/focus-plan';
import { splitOffer } from '@/lib/group-split-proposal';
import { theGroup } from '@/lib/family-week-shared';
import { askedAtOf, scoutSnapOf, scoutState, teacherSnapOf, teacherState, type PlanState, type ScoutAnswer, type ScoutSnap, type TeacherAnswer, type TeacherSnap } from '@/lib/plan-states';
import { boardName, joinNames, type BoardPick, type Intent } from '@/lib/meeting-board-shared';
import { rankOfKey, topicWords } from '@/lib/meeting-board-picklist';
import { assessTeacher, canTeachFocusGroup, teacherName, type TeachContext, type TeacherPerson } from '@/lib/meeting-board-teach';

/** How many coming meetings the planner works on: This week's switcher and the Theme calendar (Planner III). */
export const PLANNER_WEEKS = 8;

type Catalog = Pick<AdvancementCatalog, 'ranks' | 'rankRequirements' | 'meritBadges' | 'meritBadgeRequirements'>;

export interface TwScoutIn {
  personId: number;
  scoutId: string;
  name: string;
  currentRank: string | null;
  intent: Intent | null;
  picks: readonly Pick<BoardPick, 'key' | 'later'>[];
}

export interface ThisWeekInput {
  catalog: Catalog;
  ctx: TeachContext;
  scouts: readonly TwScoutIn[];
  /** Keyed by scoutId. */
  progress: ReadonlyMap<string, FocusProgress>;
  /** The seeded focus sets ('fg:' topics), in the order they were added. */
  focus: readonly { key: string; title: string; setId: number | null; members: readonly string[] }[];
  /** Single requirements a planner put on the plan by hand (seeded rank or merit badge requirement topics). */
  seededSingles: readonly string[];
  /** Badges added to the night directly. */
  nightBadges: readonly string[];
  roles: ReadonlyMap<number, ScoutRole>;
  /** Everyone who may teach (adults and Junior Leaders), eligible only. */
  teachers: readonly TeacherPerson[];
  /** Explicit answers, adults and scouts alike, keyed by personId. */
  intents: ReadonlyMap<number, Intent>;
  /** Teacher sign-ups on this meeting, lead first then sign-up order; `note` is what they wrote with an offer. */
  topicTeachers: readonly { key: string; personId: number; note?: string | null; createdAt?: string }[];
  /** Confirmations: each teacher's answers (meeting_teacher_answers) and when they were asked about each card. */
  teacherAnswers?: readonly (TeacherAnswer & { personId: number; key: string })[];
  teacherAsks?: readonly { personId: number; group: string; at: string }[];
  /** A family's "This plan looks good", by scout, and when each scout's plan email went out. */
  scoutAnswers?: ReadonlyMap<number, ScoutAnswer>;
  scoutAsks?: ReadonlyMap<number, string>;
  /** Freeform topics' titles. */
  titles: ReadonlyMap<string, string>;
  /** A family's unticks (Emails E2), column keys by personId: off the plan at once. */
  exclusions?: ReadonlyMap<number, ReadonlySet<string>>;
  /** Merit badge group scouts helping teach a group (a family's answer), group key by personId. */
  helpers?: ReadonlyMap<number, string>;
  /** What a family suggested, by personId: a flag for the planners, never a placement. */
  suggestions?: ReadonlyMap<number, readonly string[]>;
  /** A teacher's note with "Not this week", by the topic (group) they were asked to teach. */
  teacherNotes?: readonly { key: string; personId: number; note: string }[];
  /** Split groups (lib/group-splits-db): sections by base key, and the merged bases. */
  splits?: ReadonlyMap<string, readonly (readonly string[])[]>;
  splitLevels?: ReadonlyMap<string, readonly number[]>;
  mergedBases?: ReadonlySet<string>;
  /** Directory adults' names, by personId (lib/people-lists pool): who an adult's answer on Responses this week is. */
  adultNames?: ReadonlyMap<number, string>;
}

export interface TwPerson {
  personId: number;
  name: string;
  /** The rank held (null = a new scout): the chip's colour. */
  rank: string | null;
  /** Spelled out, for the chip's accessible name: 'New scout', 'Tenderfoot'. */
  rankName: string;
  intent: Intent | null;
  /** A scout's plan (Confirmations C-D5): planned, asked, confirmed by the family, or changed since their yes. */
  state?: PlanState;
}

export interface TwTeacher {
  personId: number;
  name: string;
  kind: 'adult' | 'junior';
  intent: Intent | null;
  /** 'Counselor', 'Scout instructor · Star'. */
  note: string | null;
  /** As families see them: adults formally ('Mr. Vest'), scouts first name + last initial. */
  formal: string;
  /** On a card's teacher list (Confirmations): planned, asked, confirmed or changed since their yes. Absent in a pool. */
  state?: PlanState;
  /** Who entered their standing answer for them on the planner (a text, a call). Absent when they answered themselves. */
  enteredBy?: string;
}

export { joinNames };

/** Who answered one way, scouts then adults (Responses this week). */
export interface TwResponders {
  scouts: TwPerson[];
  adults: { personId: number; name: string }[];
}
export type TwResponses = Record<Intent, TwResponders>;

/**
 * Responses this week (Patrick, 2026-11-01): everyone who has answered, by their answer, each list by name. Scouts with
 * no answer aren't listed (the summary counts them); an answer from someone in neither list (a visitor) is left out.
 */
export function responsesOf(scouts: readonly TwPerson[], intents: ReadonlyMap<number, Intent>, adultNames: ReadonlyMap<number, string>): TwResponses {
  const out: TwResponses = { coming: { scouts: [], adults: [] }, undecided: { scouts: [], adults: [] }, not_coming: { scouts: [], adults: [] } };
  const scoutIds = new Set(scouts.map((x) => x.personId));
  for (const x of scouts) if (x.intent) out[x.intent].scouts.push(x);
  for (const [id, intent] of intents) {
    const name = adultNames.get(id);
    if (!scoutIds.has(id) && name) out[intent].adults.push({ personId: id, name: boardName(name) });
  }
  for (const g of Object.values(out)) {
    g.scouts.sort((a, b) => a.name.localeCompare(b.name));
    g.adults.sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}

export interface TwColumn {
  key: string;
  code: string;
  label: string;
  /** Members of the group who still need it. */
  need: number;
  /** A rank column's sub-requirements: the checklist shows one cell for each, the group card lists them on a click. */
  subs: { key: string; code: string; label: string; need: number }[];
}

export interface TwGroup {
  key: string;
  kind: 'rank' | 'badge';
  refId: string;
  /** The rank's or badge's own name ('Tenderfoot'): code labels build on it. */
  name: string;
  /** What the card and checklist call it: 'Tenderfoot group', 'First Aid merit badge', 'Tenderfoot Group 2'. */
  title: string;
  /** Split groups (Plans/Meeting-Planner-III-Split-Groups.md): Group 1's key, this group's number, how many, and its
   *  level (requirements done to start here; 0 for Group 1 and unsplit). */
  base: string;
  section: number;
  sections: number;
  fromDone: number;
  /** Group 1 only: the split is merged (Split or merge… offers "Split again as it was"). */
  merged: boolean;
  /** Group 1 of an unsplit rank group over the offer size: "Split into 2 groups?" (D1, D2). */
  offer: { placed: number } | null;
  /** Group 1 only: the saved split (active or merged), so the panel opens on it and "Split again" restores it. */
  stored: { sections: string[][]; levels: number[] } | null;
  /** 'Working on Tenderfoot' / 'Merit badge'. */
  subtitle: string;
  /** What's taught, very short ('First Aid', 'Knots & Lashings · Woods Tools'); '' when nothing names it. */
  summary: string;
  columns: TwColumn[];
  members: TwPerson[];
  /** Who teaches it, by name (any number; none yet = an empty slot). */
  teachers: TwTeacher[];
  /** Who could teach it: qualified first (counselors first for a badge), then Merit badge group scouts set to Teach. */
  candidates: TwTeacher[];
  /** Notes from people who said "Not this week" to teaching it. */
  declineNotes: { name: string; note: string }[];
  /** Confirmations C-D2: who said No to this card (now off it), with their note: the card needs a teacher. */
  saidNo: { personId: number; name: string; note: string | null; enteredBy?: string }[];
}

export interface TwRow extends TwPerson {
  counted: boolean;
  groupKey: string | null;
  open: string[];
  /** The home group (where the checklist lists a scout who sits in no group) and what is still open there. */
  homeKey: string | null;
  homeOpen: string[];
  /** The checklist cells that aren't done ('open' white, 'part' half green), for the group and for the home group. */
  marks: Record<string, CellMark>;
  homeMarks: Record<string, CellMark>;
  status: RowStatus;
  allDone: boolean;
  /** What the row's last cell says: '', 'Teaching', 'First Aid merit badge', 'From requests and offers', … */
  note: string;
  /** A counted scout with nothing assigned: the tinted row. */
  gap: boolean;
  /** The extra class a 'request' row was placed in. */
  requestKey: string | null;
  suggested: string[];
  /** Placed by hand: a planner (meeting_scout_roles) or the family's "help teach" (meeting_scout_helpers). "Let
   *  placement decide" / Unassign undoes both. */
  hand: boolean;
  /** What the family suggested, in words: a flag for the planners. */
  familySuggestions: string[];
  /** The planned requirements the family unticked, by code ('6a'). */
  familyUnticked: string[];
}

export interface TwSection {
  /** A group key; 'older' for Merit badge group scouts in no badge group (teaching, or no badge tonight); 'none' for
   *  counted scouts tonight has no group for. */
  key: string;
  kind: 'rank' | 'badge' | 'none';
  name: string;
  /** The heading: the group's title, or the name for the two loose lists. */
  title: string;
  columns: { key: string; code: string; label: string }[];
  rows: TwRow[];
  gaps: number;
}

export interface TwExtra {
  key: string;
  title: string;
  codeLabel: string;
  /** How it got here. */
  origin: 'picked' | 'offered' | 'planner';
  teachers: TwTeacher[];
  candidates: TwTeacher[];
  /** Scouts who picked it (not Can't make it) or were placed in it by hand; a placed scout also under what they picked. */
  scouts: TwPerson[];
  /** What a teacher wrote with their offer ("I can teach bottle caps"), with who wrote it (Patrick, 2026-10-30). */
  offerNotes: { name: string; note: string }[];
  /** Confirmations C-D2: who said No to this class (now off it). */
  saidNo: { personId: number; name: string; note: string | null; enteredBy?: string }[];
}

export interface AnswerCounts {
  coming: number;
  undecided: number;
  notComing: number;
  none: number;
}

export interface ThisWeek {
  focus: { key: string; setId: number | null; name: string }[];
  /** Every badge of the night: from the focus, or added directly. */
  badges: { mbId: string; name: string; direct: boolean }[];
  groups: TwGroup[];
  sections: TwSection[];
  /** The Merit badge group: First Class and up, each teaching or taking a badge. */
  older: (TwPerson & { role: 'teach' | 'badge'; badgeKey: string | null })[];
  extras: TwExtra[];
  /** Scouts helping teach: older scouts set to Teach, and gap scouts sent to help. */
  helpers: TwPerson[];
  coverage: { counted: number; rankWork: number; nothing: number; pct: number; groupsWithoutTeacher: number };
  answers: { scouts: AnswerCounts; adults: AnswerCounts };
  /** Adults who could teach tonight and haven't answered (Who's coming's "Haven't answered"). */
  adultsNoAnswer: TwTeacher[];
  /** Everyone who has answered, by answer (Responses this week). */
  responses: TwResponses;
  /** Focus items no group can hold (Star/Life/Eagle rank requirements, or gone from the catalog). */
  unplaced: string[];
  /** Everyone who may teach: the "someone else" list. */
  everyone: TwTeacher[];
}

const NEW_SCOUT = 'New scout';

function countAnswers(intents: readonly (Intent | null)[]): AnswerCounts {
  return {
    coming: intents.filter((i) => i === 'coming').length,
    undecided: intents.filter((i) => i === 'undecided').length,
    notComing: intents.filter((i) => i === 'not_coming').length,
    none: intents.filter((i) => i == null).length
  };
}

/** A requirement key's top-level requirement key ('first-class-7a.2' -> 'first-class-7a'), for its skill. */
function topKeyOf(key: string, catalog: Catalog): string {
  const rank = rankOfKey(key, catalog.ranks);
  if (rank) {
    const byId = new Map(catalog.rankRequirements.filter((r) => r.rank_id === rank.id).map((r) => [r.id, r]));
    let row = [...byId.values()].find((r) => r.code === key.slice(rank.id.length + 1));
    while (row?.parent_id != null) row = byId.get(row.parent_id);
    return row ? `${rank.id}-${row.code}` : key;
  }
  const byId = new Map(catalog.meritBadgeRequirements.map((r) => [r.id, r]));
  let row = catalog.meritBadgeRequirements.find((r) => `${r.mb_id}-${r.code}` === key);
  while (row?.parent_id != null) row = byId.get(row.parent_id);
  return row ? `${row.mb_id}-${row.code}` : key;
}

/**
 * A group's "what's taught", very short (Live's card corner, Patrick 2026-10-30): the names of the focus sets that
 * cover any of its requirements, in focus order; a group no focus covers gets its requirements' skills instead.
 */
export function groupSummary(keys: readonly string[], focus: readonly { title: string; members: readonly string[] }[], catalog: Catalog & Partial<Pick<AdvancementCatalog, 'skills'>>): string {
  const have = new Set(keys);
  const named = focus.filter((f) => f.members.some((k) => have.has(k))).map((f) => f.title);
  if (named.length) return [...new Set(named)].join(' · ');
  const skillName = new Map((catalog.skills ?? []).map((s) => [s.id, s.name]));
  const reqByKey = new Map(catalog.rankRequirements.map((r) => [`${r.rank_id}-${r.code}`, r]));
  const skills = keys.map((k) => reqByKey.get(topKeyOf(k, catalog))?.skill_id).flatMap((id) => (id && skillName.has(id) ? [skillName.get(id)!] : []));
  return [...new Set(skills)].join(' · ');
}

/** The placement's input from This week's (also what the split preview runs on). */
export function focusInputOf(input: ThisWeekInput): FocusInput {
  const { catalog } = input;
  return {
    ranks: catalog.ranks,
    rankReqs: catalog.rankRequirements,
    meritBadges: catalog.meritBadges,
    mbReqs: catalog.meritBadgeRequirements,
    scouts: input.scouts.map((s) => ({ personId: s.personId, scoutId: s.scoutId, name: s.name, currentRank: s.currentRank, intent: s.intent })),
    progress: input.progress,
    focusKeys: input.focus.flatMap((f) => f.members),
    badgeIds: input.nightBadges,
    roles: input.roles,
    picks: new Map(input.scouts.map((s) => [s.personId, s.picks.filter((p) => !p.later).map((p) => p.key)])),
    exclusions: input.exclusions,
    helpers: input.helpers,
    splits: input.splits,
    splitLevels: input.splitLevels,
    mergedBases: input.mergedBases
  };
}

/**
 * A scout's plan as the family page shows it (lib/family-week kindOf): the group, and on rank work the requirements open
 * for them there; a badge group or nothing left to do, the group alone.
 */
export const scoutPlanOfRow = (r: Pick<FocusRow, 'counted' | 'groupKey' | 'open'>): ScoutSnap =>
  scoutSnapOf(r.groupKey ?? null, r.counted && r.groupKey && r.open.length ? r.open : []);

export function buildThisWeek(input: ThisWeekInput): ThisWeek {
  const { catalog } = input;
  const rankName = new Map(catalog.ranks.map((r) => [r.id, r.display_name]));
  const mbName = new Map(catalog.meritBadges.map((m) => [m.id, m.name]));
  const scoutBy = new Map(input.scouts.map((s) => [s.personId, s]));
  const person = (s: Pick<TwScoutIn, 'personId' | 'name' | 'currentRank' | 'intent'>): TwPerson => ({
    personId: s.personId,
    name: boardName(s.name),
    rank: s.currentRank,
    rankName: s.currentRank ? (rankName.get(s.currentRank) ?? s.currentRank) : NEW_SCOUT,
    intent: s.intent,
    state: scoutStateBy.get(s.personId)
  });

  const picks = new Map(input.scouts.map((s) => [s.personId, s.picks.filter((p) => !p.later).map((p) => p.key)]));
  const plan = buildFocusPlan(focusInputOf(input));
  // Each scout's plan state (Confirmations C-D5): the snapshot is their group and the requirements open for them there.
  const scoutStateBy = new Map(
    plan.rows.map((r) => [
      r.personId,
      scoutState({
        intent: input.scouts.find((x) => x.personId === r.personId)?.intent ?? null,
        answer: input.scoutAnswers?.get(r.personId) ?? null,
        askedAt: input.scoutAsks?.get(r.personId) ?? null,
        now: scoutPlanOfRow(r)
      })
    ])
  );

  // Teachers.
  const notComing = (id: number) => input.intents.get(id) === 'not_coming';
  const teacherOf = (p: TeacherPerson, note: string | null = null): TwTeacher => ({
    personId: p.personId,
    name: teacherName(p, 'admin'),
    kind: p.kind,
    intent: input.intents.get(p.personId) ?? null,
    note,
    formal: teacherName(p, 'scout')
  });
  const pool = input.teachers;
  const poolBy = new Map(pool.map((p) => [p.personId, p]));
  // A merged split's Group 2/3 teachers count for the one group (canonicalGroupKey), so a merge never loses one.
  // Confirmations: each person's newest answer about a card (merged keys read as one).
  const answerOf = (personId: number, key: string) =>
    (input.teacherAnswers ?? [])
      .filter((a) => a.personId === personId && canonicalGroupKey(a.key, input.mergedBases) === key)
      .sort((a, b) => b.answeredAt.localeCompare(a.answeredAt))[0] ?? null;
  const signedUp = (key: string, now: TeacherSnap): TwTeacher[] =>
    input.topicTeachers
      .filter((x, i, all) => canonicalGroupKey(x.key, input.mergedBases) === key && !notComing(x.personId) && all.findIndex((y) => y.personId === x.personId && canonicalGroupKey(y.key, input.mergedBases) === key) === i)
      .flatMap((t): TwTeacher[] => {
        const answer = answerOf(t.personId, key);
        const state = teacherState({
          onCard: true,
          hiddenByIntent: false,
          answer,
          askedAt: askedAtOf(input.teacherAsks ?? [], { personId: t.personId, groupKey: key, merged: input.mergedBases }),
          slotSince: t.createdAt ?? null,
          now
        });
        // Who entered it counts only while that answer is what the state reads (a stale yes, re-asked, isn't theirs).
        const by = answer?.enteredBy && (state === 'confirmed' || state === 'changed') ? { enteredBy: answer.enteredBy } : {};
        const p = poolBy.get(t.personId);
        if (p) return [{ ...teacherOf(p), state, ...by }];
        const s = scoutBy.get(t.personId);
        return s ? [{ personId: s.personId, name: boardName(s.name), kind: 'junior', intent: s.intent, note: null, formal: boardName(s.name), state, ...by }] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  /** Who said No to this card and is off it now (C-D2). */
  const saidNoTo = (key: string, on: readonly TwTeacher[]) =>
    (input.teacherAnswers ?? [])
      .filter((a) => a.answer === 'no' && canonicalGroupKey(a.key, input.mergedBases) === key && !on.some((t) => t.personId === a.personId))
      .map((a) => {
        const p = poolBy.get(a.personId);
        const s = scoutBy.get(a.personId);
        return { personId: a.personId, name: p ? teacherName(p, 'admin') : s ? boardName(s.name) : 'Someone', note: a.note, ...(a.enteredBy ? { enteredBy: a.enteredBy } : {}) };
      });
  const byAnswer = (a: TwTeacher, b: TwTeacher) => {
    const rank = (t: TwTeacher) => (t.intent === 'coming' ? 0 : t.intent == null || t.intent === 'undecided' ? 1 : 2);
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  };
  const rowsBy = new Map(plan.rows.map((r) => [r.personId, r]));
  const teachingScouts: TwTeacher[] = plan.rows
    .filter((r) => !r.counted && r.status === 'teach')
    .map((r) => {
      const s = scoutBy.get(r.personId)!;
      return { personId: r.personId, name: boardName(s.name), kind: 'junior' as const, intent: s.intent, note: `Scout instructor · ${rankName.get(s.currentRank ?? '') ?? ''}`, formal: boardName(s.name) };
    });

  const offerOf = (base: string) => {
    const o = splitOffer(focusInputOf(input), base);
    return o ? { placed: o.placed } : null;
  };
  const groups: TwGroup[] = plan.groups.map((g) => {
    const members = g.members.map((id) => rowsBy.get(id)!).filter((r) => r);
    // Can't make it takes a scout out of the group's work (Emails): their chip stays, greyed, but they need nothing.
    const working = members.filter((m) => m.intent !== 'not_coming');
    const columns = g.columns.map((c) => ({
      ...c,
      need: working.filter((m) => m.open.includes(c.key)).length,
      subs: c.subs.map((x) => ({ ...x, need: working.filter((m) => m.marks[x.key] === 'open').length }))
    }));
    let qualified: TwTeacher[];
    if (g.kind === 'badge') {
      const counselors = pool.filter((p) => p.kind === 'adult' && p.counselorFor.has(g.refId)).map((p) => teacherOf(p, 'Counselor'));
      qualified = counselors.sort(byAnswer);
    } else {
      const tops = [...new Set(g.columns.map((c) => topKeyOf(c.key, catalog)))];
      qualified = pool.filter((p) => canTeachFocusGroup(p, tops, input.ctx)).map((p) => teacherOf(p, p.kind === 'junior' ? `Scout instructor · ${rankName.get(p.currentRank ?? '') ?? ''}` : null)).sort(byAnswer);
    }
    const seen = new Set(qualified.map((t) => t.personId));
    const onCard = signedUp(g.key, teacherSnapOf({ key: g.key, title: g.label, columns: g.columns }, input.mergedBases));
    return {
      key: g.key,
      kind: g.kind,
      refId: g.refId,
      name: g.name,
      title: g.sections > 1 ? g.label : g.kind === 'rank' ? `${g.name} group` : `${g.name} merit badge`,
      base: g.base,
      section: g.section,
      sections: g.sections,
      fromDone: g.fromDone,
      merged: g.section === 1 && !!input.mergedBases?.has(g.base),
      offer: g.kind === 'rank' && g.sections === 1 && !input.mergedBases?.has(g.base) ? offerOf(g.base) : null,
      stored: g.section === 1 && input.splits?.get(g.base) ? { sections: input.splits.get(g.base)!.map((x) => [...x]), levels: [...(input.splitLevels?.get(g.base) ?? [])] } : null,
      subtitle: g.kind === 'rank' ? (g.fromDone ? `Working on ${g.name} · ${g.fromDone}+ requirements done` : `Working on ${g.name}`) : 'Merit badge',
      summary: groupSummary(columns.flatMap((c) => [c.key, ...c.subs.map((x) => x.key)]), input.focus, catalog),
      columns,
      members: members.map((m) => person(scoutBy.get(m.personId)!)),
      teachers: onCard,
      saidNo: saidNoTo(g.key, onCard),
      candidates: [...qualified, ...teachingScouts.filter((t) => !seen.has(t.personId))],
      declineNotes: (input.teacherNotes ?? [])
        .filter((n) => n.key === g.key)
        .map((n) => {
          const p = poolBy.get(n.personId);
          const s = scoutBy.get(n.personId);
          return { name: p ? teacherName(p, 'admin') : s ? boardName(s.name) : 'Someone', note: n.note };
        })
    };
  });
  const groupBy = new Map(groups.map((g) => [g.key, g]));

  // Extra classes: what scouts picked or adults offered outside the groups, and what a planner put on by hand.
  const extraKeys = new Map<string, TwExtra['origin']>();
  for (const k of input.seededSingles) extraKeys.set(k, 'planner');
  for (const t of input.topicTeachers) if (!isGroupKey(t.key) && !t.key.startsWith('fg:') && !extraKeys.has(t.key) && !notComing(t.personId)) extraKeys.set(t.key, 'offered');
  for (const s of input.scouts) {
    if (s.intent === 'not_coming') continue;
    for (const k of picks.get(s.personId) ?? []) if (!isGroupKey(k) && !k.startsWith('fg:') && !extraKeys.has(k)) extraKeys.set(k, 'picked');
  }
  for (const r of plan.rows) if (r.status === 'request' && r.requestKey && !extraKeys.has(r.requestKey)) extraKeys.set(r.requestKey, 'picked');
  const more = { mbReqs: catalog.meritBadgeRequirements };
  const extras: TwExtra[] = [...extraKeys].map(([key, origin]) => {
    const w = topicWords(key, catalog.ranks, catalog.rankRequirements, catalog.meritBadges, input.titles, more);
    const scouts = input.scouts.filter((s) => {
      const r = rowsBy.get(s.personId);
      // Placed in a class by hand: listed there, and under any other class they picked too (a scout's Scoutmaster
      // conference and board of review, the same evening).
      if (r?.status === 'request' && r.requestKey === key) return true;
      return s.intent !== 'not_coming' && (picks.get(s.personId) ?? []).includes(key);
    });
    const candidates = pool
      .filter((p) => (key.startsWith('mb:') ? p.counselorFor.has(key.slice(3)) : !rankOfKey(key, catalog.ranks) ? [...p.counselorFor].some((m) => key.startsWith(`${m}-`)) : assessTeacher(p, key, input.ctx).qualified && p.skills.size > 0))
      .map((p) => teacherOf(p))
      .sort(byAnswer);
    const offerNotes = input.topicTeachers
      .filter((t) => t.key === key && t.note && !notComing(t.personId))
      .map((t) => {
        const p = poolBy.get(t.personId);
        const sc = scoutBy.get(t.personId);
        return { name: p ? teacherName(p, 'admin') : sc ? boardName(sc.name) : 'Someone', note: t.note! };
      });
    const now = { group: key, itemKeys: [key], title: w?.label ?? key };
    const teachers = signedUp(key, now);
    return { key, title: w?.label ?? key, codeLabel: w?.codeLabel ?? '', origin, teachers, saidNo: saidNoTo(key, teachers), candidates, scouts: scouts.map(person), offerNotes };
  });
  const extraTitle = new Map(extras.map((e) => [e.key, e.title]));

  const wordsOf = (k: string) => {
    const w = topicWords(k, catalog.ranks, catalog.rankRequirements, catalog.meritBadges, input.titles, more);
    return w ? (w.codeLabel ? `${w.codeLabel} ${w.label}` : w.label) : k;
  };
  const columnCode = new Map(plan.groups.flatMap((g) => g.columns.map((c) => [c.key, c.code] as const)));

  // The checklist: one section per group, then the scouts tonight has no group for.
  // What each scout is signed up to teach tonight (a card's teacher slot), by the card's title (Patrick, 2026-10-31: an
  // older scout teaching the First Class group is not "Not assigned & available").
  const slotTitle = new Map<string, string>([...groups.map((g) => [g.key, g.title] as const), ...extraTitle]);
  const teaches = new Map<number, string[]>();
  for (const t of input.topicTeachers) {
    if (notComing(t.personId) || !scoutBy.has(t.personId)) continue;
    const title = slotTitle.get(canonicalGroupKey(t.key, input.mergedBases));
    if (title && !(teaches.get(t.personId) ?? []).includes(title)) teaches.set(t.personId, [...(teaches.get(t.personId) ?? []), title]);
  }
  const noteOf = (r: FocusRow): string => {
    if (r.status === 'teach' && !r.counted && teaches.has(r.personId)) return `Teaching ${joinNames(teaches.get(r.personId)!.map(theGroup))}`;
    if (r.status === 'teach') return r.counted ? 'Helps teach' : 'Teaching';
    if (r.status === 'request') return `From requests and offers${r.requestKey && extraTitle.get(r.requestKey) ? ` · ${extraTitle.get(r.requestKey)}` : ''}`;
    if (r.status === 'badge') return `${groupBy.get(r.groupKey ?? '')?.name ?? ''} merit badge`;
    if (r.status === 'placed') return 'Placed by hand';
    if (r.status === 'unassigned') return 'Unassigned';
    if (r.status === 'nothing') return r.allDone ? 'Nothing assigned · every offered requirement is done' : 'Nothing assigned';
    return '';
  };
  const toRow = (r: FocusRow): TwRow => ({
    ...person(scoutBy.get(r.personId)!),
    counted: r.counted,
    groupKey: r.groupKey,
    open: r.open,
    homeKey: r.homeKey,
    homeOpen: r.homeOpen,
    marks: r.marks,
    homeMarks: r.homeMarks,
    status: r.status,
    allDone: r.allDone,
    note: noteOf(r),
    gap: r.status === 'nothing',
    requestKey: r.requestKey ?? null,
    suggested: r.suggested,
    hand: input.roles.has(r.personId) || !!input.helpers?.has(r.personId),
    familySuggestions: (input.suggestions?.get(r.personId) ?? []).map((k) => wordsOf(k)),
    familyUnticked: [...(input.exclusions?.get(r.personId) ?? [])].filter((k) => columnCode.has(k)).map((k) => columnCode.get(k)!)
  });
  const byName = (a: TwRow, b: TwRow) => a.name.localeCompare(b.name);
  // An older scout in no badge group (teaching, or no badge tonight) is listed under "Not assigned & available".
  const sectionOf = (r: FocusRow) => r.groupKey ?? (r.counted ? (r.homeKey ?? 'none') : 'older');
  const sections: TwSection[] = groups.map((g) => {
    const rows = plan.rows.filter((r) => sectionOf(r) === g.key).map(toRow).sort(byName);
    return { key: g.key, kind: g.kind, name: g.name, title: g.title, columns: g.columns.flatMap(({ key, code, label, subs }) => (subs.length ? subs : [{ key, code, label }])), rows, gaps: rows.filter((r) => r.gap).length };
  });
  const olderAll = plan.rows.filter((r) => sectionOf(r) === 'older');
  const teachingRows = olderAll.filter((r) => teaches.has(r.personId)).map(toRow).sort(byName);
  const olderRows = olderAll.filter((r) => !teaches.has(r.personId)).map(toRow).sort(byName);
  if (teachingRows.length) sections.push({ key: 'teaching', kind: 'none', name: 'Teaching tonight', title: 'Teaching tonight', columns: [], rows: teachingRows, gaps: 0 });
  if (olderRows.length) sections.push({ key: 'older', kind: 'none', name: 'Not assigned & available', title: 'Not assigned & available', columns: [], rows: olderRows, gaps: 0 });
  const loose = plan.rows.filter((r) => sectionOf(r) === 'none').map(toRow).sort(byName);
  if (loose.length) sections.push({ key: 'none', kind: 'none', name: 'Not in a group', title: 'Not in a group', columns: [], rows: loose, gaps: loose.filter((r) => r.gap).length });

  const older = plan.rows
    .filter((r) => !r.counted)
    .map((r) => ({ ...person(scoutBy.get(r.personId)!), role: r.status === 'teach' ? ('teach' as const) : ('badge' as const), badgeKey: r.status === 'badge' ? r.groupKey : null }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const helpers = plan.rows.filter((r) => r.status === 'teach').map((r) => person(scoutBy.get(r.personId)!)).sort((a, b) => a.name.localeCompare(b.name));

  const badges = groups
    .filter((g) => g.kind === 'badge')
    .map((g) => ({ mbId: g.refId, name: mbName.get(g.refId) ?? g.refId, direct: input.nightBadges.includes(g.refId) }));

  const adults = pool.filter((p) => p.kind === 'adult');
  // Coverage counts the scouts who may come: Can't make it is out of it.
  const may = plan.rows.filter((r) => r.counted && r.intent !== 'not_coming');
  const counted = may.length;
  const responses = responsesOf(input.scouts.map(person), input.intents, input.adultNames ?? new Map(adults.map((a) => [a.personId, a.displayName])));
  const rankWork = may.filter((r) => r.status === 'rank-work').length;
  const nothing = may.filter((r) => r.status === 'nothing').length;
  return {
    focus: input.focus.map((f) => ({ key: f.key, setId: f.setId, name: f.title })),
    badges,
    groups,
    sections,
    older,
    extras,
    helpers,
    coverage: {
      counted,
      rankWork,
      nothing,
      pct: counted ? Math.round((rankWork / counted) * 100) : 0,
      groupsWithoutTeacher: groups.filter((g) => !g.teachers.length && g.members.length > 0).length
    },
    answers: {
      scouts: countAnswers(input.scouts.map((s) => s.intent)),
      // The adults Responses this week lists (every directory adult who answered), so the two never disagree.
      adults: {
        coming: responses.coming.adults.length,
        undecided: responses.undecided.adults.length,
        notComing: responses.not_coming.adults.length,
        none: adults.filter((a) => !input.intents.has(a.personId)).length
      }
    },
    responses,
    adultsNoAnswer: adults
      .filter((a) => !input.intents.has(a.personId) && (a.skills.size > 0 || a.counselorFor.size > 0))
      .map((a) => teacherOf(a))
      .sort((a, b) => a.name.localeCompare(b.name)),
    unplaced: plan.unplaced,
    everyone: pool.map((p) => teacherOf(p)).sort((a, b) => a.name.localeCompare(b.name))
  };
}
