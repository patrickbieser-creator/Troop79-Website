/**
 * Meeting Planner III, the Theme calendar (Plans/Meeting-Planner-III.md, P5): the focus for a run of coming meetings,
 * each week's coverage before anyone signs up, and "who the run covers" (each rank group × week). The same placement
 * as This week (lib/focus-plan), without picks or hand choices: the calendar plans ahead. Pure.
 */
import { buildFocusPlan, GROUP_RANKS, type FocusInput, type FocusScout } from '@/lib/focus-plan';

export interface CalendarWeekIn {
  entryId: number;
  date: string;
  focusNames: string[];
  focusKeys: string[];
  badgeIds: string[];
}

export interface CalendarWeek {
  entryId: number;
  date: string;
  focusNames: string[];
  planned: boolean;
  counted: number;
  rankWork: number;
  pct: number;
  /** Counted scouts who would have nothing open. */
  nothing: number;
}

export interface CalendarBand {
  /** The rank its scouts work on. */
  rankId: string;
  name: string;
  size: number;
  /** Per week, in week order: scouts of this band with rank work that week (null when the week has no focus). */
  withWork: (number | null)[];
}

export function buildThemeCalendar(
  base: Omit<FocusInput, 'focusKeys' | 'badgeIds' | 'roles' | 'picks' | 'scouts'> & { scouts: readonly FocusScout[] },
  weeks: readonly CalendarWeekIn[]
): { weeks: CalendarWeek[]; bands: CalendarBand[] } {
  const ranks = [...base.ranks].sort((a, b) => a.sort_order - b.sort_order);
  const groupRanks = ranks.filter((r) => GROUP_RANKS.includes(r.id));
  /** The rank a scout works on, Scout through First Class; null for the Merit badge group. */
  const bandOf = (s: FocusScout): string | null => {
    if (s.currentRank == null) return groupRanks[0]?.id ?? null;
    const i = groupRanks.findIndex((r) => r.id === s.currentRank);
    return i >= 0 ? (groupRanks[i + 1]?.id ?? null) : null;
  };
  const plans = weeks.map((w) => buildFocusPlan({ ...base, focusKeys: w.focusKeys, badgeIds: w.badgeIds }));
  const outWeeks = weeks.map((w, i) => {
    const c = plans[i].coverage;
    const planned = w.focusKeys.length > 0 || w.badgeIds.length > 0;
    return { entryId: w.entryId, date: w.date, focusNames: w.focusNames, planned, counted: c.counted, rankWork: c.rankWork, pct: c.counted ? Math.round((c.rankWork / c.counted) * 100) : 0, nothing: c.nothing };
  });
  const bands = groupRanks.map((r) => {
    const members = base.scouts.filter((s) => bandOf(s) === r.id).map((s) => s.personId);
    return {
      rankId: r.id,
      name: r.display_name,
      size: members.length,
      withWork: plans.map((p, i) => (outWeeks[i].planned ? p.rows.filter((row) => members.includes(row.personId) && row.status === 'rank-work').length : null))
    };
  });
  return { weeks: outWeeks, bands };
}
