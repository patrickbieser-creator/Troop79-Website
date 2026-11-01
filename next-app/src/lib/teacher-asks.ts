/**
 * What one person teaches on This week, with where their answer stands (Patrick, 2026-11-01: a teacher texts "I'll be
 * there" and a planner records it for them in their drawer). Pure; reads a built This week view. Client-safe.
 */
import type { PlanState } from '@/lib/plan-states';
import type { TwTeacher } from '@/lib/this-week';

export interface DrawerAsk {
  /** The card's key (a group, canonical; or a class from requests and offers). */
  key: string;
  title: string;
  state: PlanState;
  /** Who entered their standing answer for them; null when they answered themselves or haven't. */
  enteredBy: string | null;
}

type Card = { key: string; title: string; teachers: readonly TwTeacher[] };

/** Each card this person is a teacher on, groups first, then classes. A card where they can't come is left out. */
export function teacherAsksOf(view: { groups: readonly Card[]; extras: readonly Card[] }, personId: number): DrawerAsk[] {
  return [...view.groups, ...view.extras].flatMap((c) => {
    const t = c.teachers.find((x) => x.personId === personId);
    return t?.state && t.state !== 'hidden' ? [{ key: c.key, title: c.title, state: t.state, enteredBy: t.enteredBy ?? null }] : [];
  });
}
