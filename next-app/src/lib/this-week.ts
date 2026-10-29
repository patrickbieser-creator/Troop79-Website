/**
 * Meeting Planner III, This week (Plans/Meeting-Planner-III.md): the screen's whole view model, shaped from the
 * placement (lib/focus-plan) plus the meeting's teachers, answers, picks and offers. Pure and serializable: the page
 * loads (lib/this-week-db), this shapes, the client renders. Live at the meeting (Decision 10) reads the same model.
 */
import type { AdvancementCatalog } from '@/lib/advancement-catalog';
import { buildFocusPlan, isGroupKey, type CellMark, type FocusProgress, type FocusRow, type RowStatus, type ScoutRole } from '@/lib/focus-plan';
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
  /** Teacher sign-ups on this meeting, lead first then sign-up order. */
  topicTeachers: readonly { key: string; personId: number }[];
  /** Freeform topics' titles. */
  titles: ReadonlyMap<string, string>;
}

export interface TwPerson {
  personId: number;
  name: string;
  /** The rank held (null = a new scout): the chip's colour. */
  rank: string | null;
  /** Spelled out, for the chip's accessible name: 'New scout', 'Tenderfoot'. */
  rankName: string;
  intent: Intent | null;
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
}

export { joinNames };

export interface TwColumn {
  key: string;
  code: string;
  label: string;
  /** Members of the group who still need it. */
  need: number;
  /** A rank column's sub-requirements: the checklist shows one cell for each. */
  subs: { key: string; code: string; label: string }[];
}

export interface TwGroup {
  key: string;
  kind: 'rank' | 'badge';
  refId: string;
  name: string;
  /** 'Working on Tenderfoot' / 'Merit badge'. */
  subtitle: string;
  columns: TwColumn[];
  members: TwPerson[];
  /** Who teaches it, by name (any number; none yet = an empty slot). */
  teachers: TwTeacher[];
  /** Who could teach it: qualified first (counselors first for a badge), then Merit badge group scouts set to Teach. */
  candidates: TwTeacher[];
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
  /** A planner placed this scout by hand (meeting_scout_roles): "Let placement decide" undoes it. */
  hand: boolean;
}

export interface TwSection {
  /** A group key; 'older' for Merit badge group scouts in no badge group (teaching, or no badge tonight); 'none' for
   *  counted scouts tonight has no group for. */
  key: string;
  kind: 'rank' | 'badge' | 'none';
  name: string;
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
  /** Scouts who picked it (not Can't make it) or were placed in it by hand. */
  scouts: TwPerson[];
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
    intent: s.intent
  });

  const focusKeys = input.focus.flatMap((f) => f.members);
  const picks = new Map(input.scouts.map((s) => [s.personId, s.picks.filter((p) => !p.later).map((p) => p.key)]));
  const plan = buildFocusPlan({
    ranks: catalog.ranks,
    rankReqs: catalog.rankRequirements,
    meritBadges: catalog.meritBadges,
    mbReqs: catalog.meritBadgeRequirements,
    scouts: input.scouts.map((s) => ({ personId: s.personId, scoutId: s.scoutId, name: s.name, currentRank: s.currentRank, intent: s.intent })),
    progress: input.progress,
    focusKeys,
    badgeIds: input.nightBadges,
    roles: input.roles,
    picks
  });

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
  const signedUp = (key: string): TwTeacher[] =>
    input.topicTeachers
      .filter((x) => x.key === key && !notComing(x.personId))
      .flatMap((t): TwTeacher[] => {
        const p = poolBy.get(t.personId);
        if (p) return [teacherOf(p)];
        const s = scoutBy.get(t.personId);
        return s ? [{ personId: s.personId, name: boardName(s.name), kind: 'junior', intent: s.intent, note: null, formal: boardName(s.name) }] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
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

  const groups: TwGroup[] = plan.groups.map((g) => {
    const members = g.members.map((id) => rowsBy.get(id)!).filter((r) => r);
    const columns = g.columns.map((c) => ({ ...c, need: members.filter((m) => m.open.includes(c.key)).length }));
    let qualified: TwTeacher[];
    if (g.kind === 'badge') {
      const counselors = pool.filter((p) => p.kind === 'adult' && p.counselorFor.has(g.refId)).map((p) => teacherOf(p, 'Counselor'));
      qualified = counselors.sort(byAnswer);
    } else {
      const tops = [...new Set(g.columns.map((c) => topKeyOf(c.key, catalog)))];
      qualified = pool.filter((p) => canTeachFocusGroup(p, tops, input.ctx)).map((p) => teacherOf(p, p.kind === 'junior' ? `Scout instructor · ${rankName.get(p.currentRank ?? '') ?? ''}` : null)).sort(byAnswer);
    }
    const seen = new Set(qualified.map((t) => t.personId));
    return {
      key: g.key,
      kind: g.kind,
      refId: g.refId,
      name: g.name,
      subtitle: g.kind === 'rank' ? `Working on ${g.name}` : 'Merit badge',
      columns,
      members: members.map((m) => person(scoutBy.get(m.personId)!)),
      teachers: signedUp(g.key),
      candidates: [...qualified, ...teachingScouts.filter((t) => !seen.has(t.personId))]
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
      if (r?.status === 'request') return r.requestKey === key;
      return s.intent !== 'not_coming' && (picks.get(s.personId) ?? []).includes(key);
    });
    const candidates = pool
      .filter((p) => (key.startsWith('mb:') ? p.counselorFor.has(key.slice(3)) : !rankOfKey(key, catalog.ranks) ? [...p.counselorFor].some((m) => key.startsWith(`${m}-`)) : assessTeacher(p, key, input.ctx).qualified && p.skills.size > 0))
      .map((p) => teacherOf(p))
      .sort(byAnswer);
    return { key, title: w?.label ?? key, codeLabel: w?.codeLabel ?? '', origin, teachers: signedUp(key), candidates, scouts: scouts.map(person) };
  });
  const extraTitle = new Map(extras.map((e) => [e.key, e.title]));

  // The checklist: one section per group, then the scouts tonight has no group for.
  const noteOf = (r: FocusRow): string => {
    if (r.status === 'teach') return r.counted ? 'Helps teach' : 'Teaching';
    if (r.status === 'request') return `From requests and offers${r.requestKey && extraTitle.get(r.requestKey) ? ` · ${extraTitle.get(r.requestKey)}` : ''}`;
    if (r.status === 'badge') return `${groupBy.get(r.groupKey ?? '')?.name ?? ''} merit badge`;
    if (r.status === 'placed') return 'Placed by hand';
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
    hand: input.roles.has(r.personId)
  });
  const byName = (a: TwRow, b: TwRow) => a.name.localeCompare(b.name);
  // An older scout in no badge group (teaching, or no badge tonight) is listed under "Not assigned & available".
  const sectionOf = (r: FocusRow) => r.groupKey ?? (r.counted ? (r.homeKey ?? 'none') : 'older');
  const sections: TwSection[] = groups.map((g) => {
    const rows = plan.rows.filter((r) => sectionOf(r) === g.key).map(toRow).sort(byName);
    return { key: g.key, kind: g.kind, name: g.name, columns: g.columns.flatMap(({ key, code, label, subs }) => (subs.length ? subs : [{ key, code, label }])), rows, gaps: rows.filter((r) => r.gap).length };
  });
  const olderRows = plan.rows.filter((r) => sectionOf(r) === 'older').map(toRow).sort(byName);
  if (olderRows.length) sections.push({ key: 'older', kind: 'none', name: 'Not assigned & available', columns: [], rows: olderRows, gaps: 0 });
  const loose = plan.rows.filter((r) => sectionOf(r) === 'none').map(toRow).sort(byName);
  if (loose.length) sections.push({ key: 'none', kind: 'none', name: 'Not in a group', columns: [], rows: loose, gaps: loose.filter((r) => r.gap).length });

  const older = plan.rows
    .filter((r) => !r.counted)
    .map((r) => ({ ...person(scoutBy.get(r.personId)!), role: r.status === 'teach' ? ('teach' as const) : ('badge' as const), badgeKey: r.status === 'badge' ? r.groupKey : null }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const helpers = plan.rows.filter((r) => r.status === 'teach').map((r) => person(scoutBy.get(r.personId)!)).sort((a, b) => a.name.localeCompare(b.name));

  const badges = groups
    .filter((g) => g.kind === 'badge')
    .map((g) => ({ mbId: g.refId, name: mbName.get(g.refId) ?? g.refId, direct: input.nightBadges.includes(g.refId) }));

  const adults = pool.filter((p) => p.kind === 'adult');
  const { counted, rankWork, nothing } = plan.coverage;
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
    answers: { scouts: countAnswers(input.scouts.map((s) => s.intent)), adults: countAnswers(adults.map((a) => input.intents.get(a.personId) ?? null)) },
    adultsNoAnswer: adults
      .filter((a) => !input.intents.has(a.personId) && (a.skills.size > 0 || a.counselorFor.size > 0))
      .map((a) => teacherOf(a))
      .sort((a, b) => a.name.localeCompare(b.name)),
    unplaced: plan.unplaced,
    everyone: pool.map((p) => teacherOf(p)).sort((a, b) => a.name.localeCompare(b.name))
  };
}
