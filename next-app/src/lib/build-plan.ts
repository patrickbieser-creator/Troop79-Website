/**
 * Build a Plan (Plans/Build-A-Plan.md, B1): the plan of one meeting as rows and the meeting switcher's choice
 * (Suggestions mode's lenses are lib/build-plan-suggest). PURE and client-safe; the page and the actions shape their
 * reads with it and the tests read it without a database.
 *
 * One store, no new plan entity: a plan row is whatever the planner board counts as a class on that meeting (ready,
 * no teacher yet, or offered with no takers), so Build and the board never disagree about what is on the meeting.
 *   - Origin: Planner (seeded), Scouts asked (picked, not seeded) or Teacher offered (a teacher, nobody picked it).
 *   - State: Ready (a teacher and scouts), Needs a teacher, Needs scouts (a teacher, nobody picked it).
 *   - Only a seeded row can be removed, and removing it is an unseed: the picks and teachers on it stay, so the row
 *     stays as theirs. A row scouts picked or a teacher offered says why it can't be removed.
 */
import type { PlannerBoard } from '@/lib/meeting-planner-board';
import { assessTeacher, flagText, teacherName, topicSkill, type TeachContext, type TeacherPerson } from '@/lib/meeting-board-teach';
import { nextRankOf, rankOfKey } from '@/lib/meeting-board-picklist';
import { othersLabel } from '@/lib/meeting-board-shared';
import type { CatalogRank, CatalogRankRequirement } from '@/lib/advancement-catalog';
import type { ReqNode } from '@/lib/mb-helpers';
import { rankNodeSatisfied } from '@/lib/rank-calculus';

export type PlanOrigin = 'planner' | 'scouts' | 'teacher';
export type PlanState = 'ready' | 'needs-teacher' | 'needs-scouts';

export const ORIGIN_LABEL: Record<PlanOrigin, string> = { planner: 'Planner', scouts: 'Scouts asked', teacher: 'Teacher offered' };
export const STATE_LABEL: Record<PlanState, string> = { ready: 'Ready', 'needs-teacher': 'Needs a teacher', 'needs-scouts': 'Needs scouts' };

export interface PlanRow {
  key: string;
  /** 'Tenderfoot 4a', 'First Aid 2', 'Focus set'. */
  codeLabel: string;
  title: string;
  origin: PlanOrigin;
  /** Seeded by a planner (the only rows Remove applies to). */
  seeded: boolean;
  /** Who is teaching it ('Maria L'). */
  teachers: string[];
  /** Scouts who picked it for this meeting. */
  scouts: number;
  /** Needs a teacher: people qualified to teach it who can still come; null when added on this page and not counted yet. */
  canTeach: number | null;
  state: PlanState;
}

/** Each class on the board as a plan row: ready first, then the ones that need something, by code. */
export function planRows(board: Pick<PlannerBoard, 'ready' | 'noTeacher' | 'offered'>): PlanRow[] {
  const origin = (seeded: boolean, scouts: number): PlanOrigin => (seeded ? 'planner' : scouts ? 'scouts' : 'teacher');
  const rows: PlanRow[] = [
    ...board.ready.map((r) => {
      const seeded = r.seededBy != null;
      return { key: r.key, codeLabel: r.codeLabel, title: r.title, origin: origin(seeded, r.scouts.length), seeded, teachers: r.teachers.map((t) => t.name), scouts: r.scouts.length, canTeach: 0, state: 'ready' as const };
    }),
    ...board.noTeacher.map((r) => {
      const seeded = r.seededBy != null;
      return { key: r.key, codeLabel: r.codeLabel, title: r.title, origin: origin(seeded, r.waiting.length), seeded, teachers: [], scouts: r.waiting.length, canTeach: r.canTeach.total, state: 'needs-teacher' as const };
    }),
    ...board.offered.map((r) => {
      const seeded = r.seededBy != null;
      return { key: r.key, codeLabel: r.codeLabel, title: r.title, origin: origin(seeded, 0), seeded, teachers: r.teachers.map((t) => t.name), scouts: 0, canTeach: 0, state: 'needs-scouts' as const };
    })
  ];
  const order: Record<PlanState, number> = { ready: 0, 'needs-teacher': 1, 'needs-scouts': 2 };
  return rows.sort((a, b) => order[a.state] - order[b.state] || a.codeLabel.localeCompare(b.codeLabel) || a.title.localeCompare(b.title));
}

/** The row's teacher line: who teaches it, else how many could; nothing while a just-added row isn't counted yet. */
export function teacherLine(r: Pick<PlanRow, 'teachers' | 'canTeach'>): string | null {
  if (r.teachers.length) return r.teachers.join(', ');
  if (r.canTeach == null) return null;
  return r.canTeach ? `${r.canTeach} ${r.canTeach === 1 ? 'person' : 'people'} could teach it` : 'Nobody listed can teach it yet';
}

/** How many likely scouts a row names before "+N". */
export const LIKELY_SHOWN = 3;

/**
 * The row's scout line (Patrick, 2026-10-22): "3 signed up" once scouts picked it; otherwise the likely scouts by name
 * ("Likely: Finn P, Anjali S, Leo K +4"); nothing when there are neither.
 */
export function scoutLine(r: Pick<PlanRow, 'scouts'>, likely: readonly string[] | undefined): string | null {
  if (r.scouts) return `${r.scouts} signed up`;
  return likely?.length ? `Likely: ${othersLabel(likely, LIKELY_SHOWN)}` : null;
}

/** What the likely rule reads about one scout (B6): their rank, and for a mix or a badge what they still have open. */
export interface LikelyFacts {
  currentRank: string | null;
  /** A mix's members this scout hasn't finished (read only for an fg: key). */
  unfinished?: readonly string[];
  /** The badges this scout has in progress (started, not awarded). */
  badgesInProgress?: ReadonlySet<string>;
}

export interface LikelyFitResult {
  likely: boolean;
  /** A mix: the parts that make it likely ('4a', '5c', 'First Aid 9'), for the reason line. */
  covers: string[];
}

/**
 * The likely rule, one everywhere (B6; README:102, meeting-planner-board.ts): a scout is likely for an offering when
 * they are working on it, never just because nothing rules them out (the old `topic == null` shortcut is gone).
 *   - A rank requirement: its rank is the scout's next rank.
 *   - A focus group (a mix): at least one member they haven't finished is at their next rank, or is a requirement of
 *     a badge they have in progress.
 *   - A merit badge requirement (or a whole badge): the badge is in progress.
 *   - Anything else (a teacher's freeform offer): never likely; it sits under "Show all eligible".
 * The candidate list (scoutCandidatesMany) has already left out who picked, finished or can't reach it.
 */
export function likelyFit(f: LikelyFacts, key: string, ranks: readonly CatalogRank[], badges: readonly { id: string; name: string }[] = []): LikelyFitResult {
  const next = nextRankOf(f.currentRank, ranks);
  const started = (k: string) => {
    const b = badgeOf(k, badges);
    return b && f.badgesInProgress?.has(b.id) ? b : null;
  };
  if (key.startsWith('fg:')) {
    const covers: string[] = [];
    for (const m of f.unfinished ?? []) {
      const rank = rankOfKey(m, ranks);
      if (rank) {
        if (next != null && rank.id === next) covers.push(m.slice(rank.id.length + 1));
        continue;
      }
      const b = started(m);
      if (b) covers.push(`${b.name} ${m.slice(b.id.length + 1)}`);
    }
    return { likely: covers.length > 0, covers };
  }
  const rank = rankOfKey(key, ranks);
  if (rank) return { likely: next != null && next === rank.id, covers: [] };
  if (key.startsWith('ff:')) return { likely: false, covers: [] };
  return { likely: started(key) != null, covers: [] };
}

/**
 * A mix's members this scout hasn't finished (B6, for likelyFit): a rank member is finished when the scout is at or past
 * its rank or the ledger satisfies it (any level: 'tenderfoot-4a' or 'tenderfoot-4a.1'); a badge member when the badge
 * is awarded. Pure.
 */
export function unfinishedMembers(
  members: readonly string[],
  ctx: {
    currentRank: string | null;
    ranks: readonly CatalogRank[];
    trees: ReadonlyMap<string, ReqNode<CatalogRankRequirement>[]>;
    rankCodes: ReadonlySet<string>;
    awardedMbs: ReadonlySet<string>;
    badges: readonly { id: string; name: string }[];
  }
): string[] {
  const sortOf = new Map(ctx.ranks.map((r) => [r.id, r.sort_order]));
  const mine = ctx.currentRank ? sortOf.get(ctx.currentRank) : undefined;
  const find = (nodes: readonly ReqNode<CatalogRankRequirement>[], code: string): ReqNode<CatalogRankRequirement> | undefined => {
    for (const n of nodes) {
      if (n.code === code) return n;
      const hit = find(n.children, code);
      if (hit) return hit;
    }
    return undefined;
  };
  return members.filter((m) => {
    const rank = rankOfKey(m, ctx.ranks);
    if (!rank) {
      const b = badgeOf(m, ctx.badges);
      return !(b && ctx.awardedMbs.has(b.id));
    }
    if (mine != null && mine >= rank.sort_order) return false;
    const node = find(ctx.trees.get(rank.id) ?? [], m.slice(rank.id.length + 1));
    return node ? !rankNodeSatisfied(node, rank.id, ctx.rankCodes as Set<string>) : !ctx.rankCodes.has(m);
  });
}

export function isLikelyFit(f: LikelyFacts, key: string, ranks: readonly CatalogRank[], badges: readonly { id: string; name: string }[] = []): boolean {
  return likelyFit(f, key, ranks, badges).likely;
}

/** The likely scouts for one key, by name: candidates who haven't picked it and are likely (as the candidate list
 *  decided, or by rank alone when it didn't say). */
export function likelyNames(cands: readonly { name: string; ticked: boolean; currentRank?: string | null; likely?: boolean }[], key: string, ranks: readonly CatalogRank[]): string[] {
  return cands
    .filter((c) => c.ticked && (c.likely ?? isLikelyFit({ currentRank: c.currentRank ?? null }, key, ranks)))
    .map((c) => c.name)
    .sort((a, b) => a.localeCompare(b));
}

/** Why a row can't be removed, or null when it can (a seeded row). */
export function cannotRemoveReason(row: Pick<PlanRow, 'seeded' | 'origin'>): string | null {
  if (row.seeded) return null;
  return row.origin === 'scouts' ? 'Scouts picked this, so it stays on the plan.' : 'A teacher offered this, so it stays on the plan.';
}

/** What Remove does to a seeded row: the consequence the danger dialog names. */
export function removeConsequence(row: Pick<PlanRow, 'title' | 'scouts' | 'teachers'>): string {
  const n = row.scouts;
  if (n) return `“${row.title}” stays on the meeting for the ${n === 1 ? 'scout who picked it' : `${n} scouts who picked it`}, but no longer as the planner’s.`;
  if (row.teachers.length) return `“${row.title}” stays on the meeting for ${row.teachers.join(', ')}, who signed up to teach it, but no longer as the planner’s.`;
  return `“${row.title}” comes off the meeting. Scouts can no longer pick it.`;
}

/** The row after a successful Remove: gone, or kept for the picks or teachers on it. */
export function afterRemove(row: PlanRow, stays: boolean): PlanRow | null {
  if (!stays) return null;
  return { ...row, seeded: false, origin: row.scouts ? 'scouts' : 'teacher' };
}

/** B3's "N invited": the people asked to teach or offered a class on this meeting (each counted once). */
export function invitedCount(rows: readonly { invitee_person_id: number }[]): number {
  return new Set(rows.map((r) => r.invitee_person_id)).size;
}

/** The rail: "5 offerings · 3 with teachers · 14 scouts signed up" (B3 adds "· 6 invited", from invitedCount). */
export function planSummary(rows: readonly PlanRow[]): { offerings: number; withTeachers: number; scouts: number } {
  return { offerings: rows.length, withTeachers: rows.filter((r) => r.teachers.length).length, scouts: rows.reduce((n, r) => n + r.scouts, 0) };
}

/** How many meetings the switcher offers. */
export const PLAN_MEETINGS = 4;

/** The meeting the screen shows: the one in the URL when it is one of the choices, else the next one. */
export function pickMeeting<T extends { entryId: number }>(meetings: readonly T[], param: string | string[] | undefined): T | null {
  const wanted = Number(Array.isArray(param) ? param[0] : param);
  return meetings.find((m) => m.entryId === wanted) ?? meetings[0] ?? null;
}

/** What an Add needs to show a new row: its key and labels (a suggestion, a searched requirement, a set). */
export interface OfferingRef {
  key: string;
  codeLabel: string;
  title: string;
}

/** A row for an offering just added: the planner's, with whoever already teaches it (a matching skill offer). */
export function addedRow(s: OfferingRef, teachers: readonly string[] = []): PlanRow {
  return { key: s.key, codeLabel: s.codeLabel, title: s.title, origin: 'planner', seeded: true, teachers: [...teachers], scouts: 0, canTeach: null, state: teachers.length ? 'needs-scouts' : 'needs-teacher' };
}

/** An Add over the rows shown: a row already there becomes the planner's (and keeps its picks); a new one is added. */
export function withAdded(rows: readonly PlanRow[], s: OfferingRef, teachers: readonly string[] = []): PlanRow[] {
  if (rows.some((r) => r.key === s.key)) return rows.map((r) => (r.key === s.key ? { ...r, seeded: true, origin: 'planner' } : r));
  return [...rows, addedRow(s, teachers)];
}

/** A catalog requirement key as an Add or Remove may carry it: 'tenderfoot-4a', 'first-aid-9b', 'second-class-BoR'. */
export function isOfferingKey(key: unknown): key is string {
  return typeof key === 'string' && /^[a-z0-9][a-z0-9.-]{0,118}[a-z0-9]$/i.test(key);
}

/**
 * Whether the page may keep the stamp a write returned (qa-lead, 2026-10-22): only when the board was as the page last
 * saw it just before the write, so nothing but this write changed it. Otherwise someone else changed the board too and
 * the page must refresh to show it.
 */
export function keepWriteStamp(seen: string, prior: string): boolean {
  return prior !== '' && prior === seen;
}

// ── B2: the teacher picker ─────────────────────────────────────────────────────────────────────────────────────────

export interface TeacherChoice {
  personId: number;
  name: string;
  /** Why they fit, in one line ('Teaches First aid', 'Counselor for Camping'); for anyone else, what's missing. */
  reason: string | null;
  counselor: boolean;
  qualified: boolean;
  /** Teaching it now. */
  teaching: boolean;
}

/** The merit badge a requirement key belongs to ('first-aid-9' → first-aid): the longest badge id it starts with. */
function badgeOf<B extends { id: string }>(key: string, badges: readonly B[]): B | undefined {
  const id = key.startsWith('mb:') ? key.slice(3) : null;
  if (id) return badges.find((b) => b.id === id);
  return [...badges].sort((a, b) => b.id.length - a.id.length).find((b) => key.startsWith(`${b.id}-`));
}

/** The badge's name for a merit badge key ('first-aid-9' → 'First Aid'), or undefined. */
export function badgeName(key: string, badges: readonly { id: string; name: string }[]): string | undefined {
  return badgeOf(key, badges)?.name;
}

/**
 * Who could teach an offering (B2 Edit), qualified first, each with a one-line reason:
 *   - a rank requirement: holds its teaching skill (and, a Junior Leader, has finished it and the skill is youth-teachable);
 *   - a merit badge requirement or badge: a registered counselor for that badge (labelled);
 *   - a focus group (a mix): covers at least one of its parts, by skill or as a counselor.
 * Everyone else in the pool follows, adults only, with what is missing. Nobody the database would refuse (a Junior
 * Leader on an adults-only skill) is listed. Whoever teaches it now is listed first, even if they no longer qualify.
 */
export function teacherChoices(input: {
  people: readonly TeacherPerson[];
  key: string;
  members: readonly string[];
  ctx: TeachContext;
  skillNames: ReadonlyMap<string, string>;
  badges: readonly { id: string; name: string }[];
  teaching: ReadonlySet<number>;
}): TeacherChoice[] {
  const { key, ctx } = input;
  const skillName = (id: string) => input.skillNames.get(id) ?? id;
  const fit = (p: TeacherPerson, k: string): { skill: string | null; badge: string | null } | null => {
    if (rankOfKey(k, ctx.ranks)) {
      const skill = topicSkill(k, ctx.ranks, ctx.rankReqs);
      return skill && p.skills.has(skill) && assessTeacher(p, k, ctx).qualified ? { skill, badge: null } : null;
    }
    const b = badgeOf(k, input.badges);
    // A whole badge (mb:) is adults only, counselor or not (qa-lead B2 #6): assessTeacher decides, as for a requirement.
    return b && p.counselorFor.has(b.id) && assessTeacher(p, k, ctx).qualified ? { skill: null, badge: b.name } : null;
  };
  const out: TeacherChoice[] = [];
  for (const p of input.people) {
    const teaching = input.teaching.has(p.personId);
    if (p.eligible === false && !teaching) continue;
    const base = { personId: p.personId, name: teacherName(p, 'admin'), teaching };
    const fits = (key.startsWith('fg:') ? input.members : [key]).map((k) => fit(p, k)).filter((f): f is NonNullable<typeof f> => f != null);
    if (fits.length) {
      const skills = [...new Set(fits.flatMap((f) => (f.skill ? [skillName(f.skill)] : [])))];
      const badges = [...new Set(fits.flatMap((f) => (f.badge ? [f.badge] : [])))];
      const parts = [skills.length ? `Teaches ${skills.join(', ')}` : null, badges.length ? `Counselor for ${badges.join(', ')}` : null].filter(Boolean);
      out.push({ ...base, reason: parts.join(' · '), counselor: badges.length > 0, qualified: true });
      continue;
    }
    const a = key.startsWith('fg:') ? { flags: [], refused: false } : assessTeacher(p, key, ctx);
    if (a.refused || (p.kind !== 'adult' && !teaching)) continue;
    const missing = flagText(a.flags, 'admin');
    out.push({ ...base, reason: missing.length ? missing.join(' · ') : null, counselor: false, qualified: false });
  }
  return out.sort(
    (a, b) => Number(b.teaching) - Number(a.teaching) || Number(b.qualified) - Number(a.qualified) || Number(b.counselor) - Number(a.counselor) || a.name.localeCompare(b.name)
  );
}

/** The row after its teachers changed (B2 Edit): its teacher line and state follow; gone when nothing holds it. */
export function withTeachers(row: PlanRow, teachers: readonly string[], onBoard: boolean): PlanRow | null {
  if (!onBoard) return null;
  const state: PlanState = teachers.length ? (row.scouts ? 'ready' : 'needs-scouts') : 'needs-teacher';
  const origin: PlanOrigin = row.seeded ? 'planner' : row.scouts ? 'scouts' : 'teacher';
  return { ...row, teachers: [...teachers], state, origin };
}

/** "Mix for Oct 25": a new mix's name until the planner types one. */
export function mixName(dayLabel: string): string {
  return `Mix for ${dayLabel}`;
}
