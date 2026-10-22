/**
 * Build a Plan (Plans/Build-A-Plan.md, B1): the plan of one meeting as rows, the meeting switcher's choice, and the
 * engine's suggestions as the Suggested column shows them. PURE and client-safe; the page and the actions shape their
 * reads with it and the tests read it without a database.
 *
 * One store, no new plan entity: a plan row is whatever the planner board counts as a class on that meeting (ready,
 * no teacher yet, or offered with no takers), so Build and the board never disagree about what is on the meeting.
 *   - Origin: Planner (seeded), Scouts asked (picked, not seeded) or Teacher offered (a teacher, nobody picked it).
 *   - State: Ready (a teacher and scouts), Needs a teacher, Needs scouts (a teacher, nobody picked it).
 *   - Only a seeded row can be removed, and removing it is an unseed: the picks and teachers on it stay, so the row
 *     stays as theirs. A row scouts picked or a teacher offered says why it can't be removed.
 */
import type { MeetingPlanPayload } from '@/lib/meeting-plan-types';
import type { PlannerBoard } from '@/lib/meeting-planner-board';

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
  /** Needs scouts: scouts working on that rank who could take it and haven't picked it. */
  likely: number;
  /** Needs a teacher: people qualified to teach it who can still come. */
  canTeach: number;
  state: PlanState;
}

/** Each class on the board as a plan row: ready first, then the ones that need something, by code. */
export function planRows(board: Pick<PlannerBoard, 'ready' | 'noTeacher' | 'offered'>): PlanRow[] {
  const origin = (seeded: boolean, scouts: number): PlanOrigin => (seeded ? 'planner' : scouts ? 'scouts' : 'teacher');
  const rows: PlanRow[] = [
    ...board.ready.map((r) => {
      const seeded = r.seededBy != null;
      return { key: r.key, codeLabel: r.codeLabel, title: r.title, origin: origin(seeded, r.scouts.length), seeded, teachers: r.teachers.map((t) => t.name), scouts: r.scouts.length, likely: 0, canTeach: 0, state: 'ready' as const };
    }),
    ...board.noTeacher.map((r) => {
      const seeded = r.seededBy != null;
      return { key: r.key, codeLabel: r.codeLabel, title: r.title, origin: origin(seeded, r.waiting.length), seeded, teachers: [], scouts: r.waiting.length, likely: 0, canTeach: r.canTeach.total, state: 'needs-teacher' as const };
    }),
    ...board.offered.map((r) => {
      const seeded = r.seededBy != null;
      return { key: r.key, codeLabel: r.codeLabel, title: r.title, origin: origin(seeded, 0), seeded, teachers: r.teachers.map((t) => t.name), scouts: 0, likely: r.likelyFits.length, canTeach: 0, state: 'needs-scouts' as const };
    })
  ];
  const order: Record<PlanState, number> = { ready: 0, 'needs-teacher': 1, 'needs-scouts': 2 };
  return rows.sort((a, b) => order[a.state] - order[b.state] || a.codeLabel.localeCompare(b.codeLabel) || a.title.localeCompare(b.title));
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

/** The rail: "5 offerings · 3 with teachers · 14 scouts signed up" (invited counts arrive in B3). */
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

export interface SuggestionView {
  key: string;
  codeLabel: string;
  title: string;
  /** Scouts who still need it. */
  need: number;
  /** The engine's first teacher (an adult, a counselor, or a scout who may teach it); null when it found nobody. */
  bestTeacher: string | null;
}

export const SUGGESTION_LIMIT = 8;

/**
 * The engine's sessions as suggestions: one per board key (a cohort split by patrol counts once, its parts summed),
 * ranked by shared need, without anything already on the plan, at most `limit`.
 */
export function rankSuggestions(plan: Pick<MeetingPlanPayload, 'sessions'>, onPlan: ReadonlySet<string>, limit = SUGGESTION_LIMIT): SuggestionView[] {
  const byKey = new Map<string, SuggestionView>();
  for (const s of plan.sessions) {
    if (!s.key || onPlan.has(s.key)) continue;
    const have = byKey.get(s.key);
    if (have) {
      have.need += s.scouts.length;
      continue;
    }
    const best = s.adultTeachers[0]?.name ?? s.counselors[0]?.name ?? s.scoutTeachers[0]?.name ?? null;
    byKey.set(s.key, { key: s.key, codeLabel: s.codeLabel, title: s.title, need: s.scouts.length, bestTeacher: best });
  }
  return [...byKey.values()].sort((a, b) => b.need - a.need || a.codeLabel.localeCompare(b.codeLabel)).slice(0, limit);
}

/** A row for an offering just added from a suggestion: the planner's, nobody on it yet. */
export function addedRow(s: Pick<SuggestionView, 'key' | 'codeLabel' | 'title'>): PlanRow {
  return { key: s.key, codeLabel: s.codeLabel, title: s.title, origin: 'planner', seeded: true, teachers: [], scouts: 0, likely: 0, canTeach: 0, state: 'needs-teacher' };
}
