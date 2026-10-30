/**
 * What This week shows of a scout who can't come (Patrick, 2026-10-30): nothing on the cards, nothing in the
 * checklist's Everyone / Nothing assigned / No answer, and a "Can't come" pill that lists only them, so a planner can
 * open one and undo a mistaken answer. Placement is untouched: this is display only. Pure; client-safe.
 */
import type { ThisWeek, TwRow } from '@/lib/this-week';

export type ChecklistFilter = 'all' | 'gaps' | 'noanswer' | 'cant';

const coming = <T extends { intent: string | null }>(xs: readonly T[]): T[] => xs.filter((x) => x.intent !== 'not_coming');

/** The view for the cards: every list of scouts without the ones who can't come. */
export function withoutCantCome(view: ThisWeek): ThisWeek {
  return {
    ...view,
    groups: view.groups.map((g) => ({ ...g, members: coming(g.members) })),
    older: coming(view.older),
    helpers: coming(view.helpers),
    extras: view.extras.map((x) => ({ ...x, scouts: coming(x.scouts) }))
  };
}

export function checklistKeeps(filter: ChecklistFilter, r: Pick<TwRow, 'intent' | 'gap'>): boolean {
  if (filter === 'cant') return r.intent === 'not_coming';
  if (r.intent === 'not_coming') return false;
  return filter === 'gaps' ? r.gap : filter === 'noanswer' ? r.intent == null : true;
}
