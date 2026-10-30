/** Meeting Planner III, client-safe constants and types for the family page. */

/** Family page (Plans/Meeting-Planner-III-Family.md, D1): a scout's plan holds at most PLAN_MAX things and PLAN_MAX_MIN
 *  minutes for one meeting (90 minutes, 30 of them for other things): planned items still ticked, requests, and
 *  helping teach. Checked again by lib/family-week's familyWrite; the request count also under the scout's board lock
 *  (meeting_add_suggestion_capped). */
export const PLAN_MAX = 4;
export const PLAN_MAX_MIN = 60;

/** No one class counts for more than one meeting's teaching time (Patrick, 2026-10-30, D11): the catalog's times are
 *  15 minutes per part for now, so a first-aid class with eight parts would read as 120. */
export const CLASS_MAX_MIN = 60;
export const classMinutes = (min: number) => Math.min(min, CLASS_MAX_MIN);

/** Minutes for what the catalog has no time for (D4): a whole merit badge class, and helping teach. */
export const MB_CLASS_MIN = 45;
export const HELP_TEACH_MIN = 15;

/** "Also on Sunday" key of a Merit badge group scout's help teach (a helper row, not a request). */
export const HELP_KEY = 'help';

/** A scout's one answer on the family page: 'ok' = this plan looks good; 'change' = change my plan; 'out' = can't make
 *  it this week. 'mb' and 'help' are older emails' buttons: 'mb' reads as 'ok', 'help' opens the change area. */
export type FamilyChoice = 'ok' | 'change' | 'out' | 'mb' | 'help';

/** "Second Class 6b - 15 min"; just the code when there's no time. */
export const withMinutes = (code: string, min: number | null | undefined) => (min ? `${code} - ${min} min` : code);

export interface PlanLoad {
  things: number;
  minutes: number;
}

export function planLoad(items: readonly { on: boolean; min: number }[], requests: readonly { min: number }[]): PlanLoad {
  const on = items.filter((i) => i.on);
  return { things: on.length + requests.length, minutes: [...on, ...requests].reduce((n, x) => n + x.min, 0) };
}

/** Why adding `min` more minutes doesn't fit, in the page's words; null when it fits. */
export function planRefusal(firstName: string, load: PlanLoad, min: number): string | null {
  if (load.things >= PLAN_MAX) return `${firstName}’s plan is full: ${PLAN_MAX} things is the most for one meeting. Untick one to add something else.`;
  if (load.minutes + min > PLAN_MAX_MIN) return `That needs ${min} min, and ${firstName}’s plan has ${Math.max(0, PLAN_MAX_MIN - load.minutes)} left.`;
  return null;
}

/** An option's second line (prototype): "Merit badge - 45 min · usually First Class and up", "15 min · with the
 *  Tenderfoot group", "Second Class 2f - 10 min". */
export const optionLine = (o: { code?: string; sub: string; min: number }) =>
  o.code ? [withMinutes(o.code, o.min), o.sub].filter(Boolean).join(' · ') : [`${o.min} min`, o.sub].filter(Boolean).join(' · ');

/** The family page's opening line: a scout answering for themself, or a household. */
export function familyLede(firstNames: readonly string[], self: boolean): string {
  if (self) return 'Here’s what’s planned for you Sunday. One tap tells us whether the plan works.';
  const names = firstNames.length > 1 ? `${firstNames.slice(0, -1).join(', ')} and ${firstNames[firstNames.length - 1]}` : (firstNames[0] ?? '');
  return `Here’s what’s planned for ${names} Sunday. One tap per card tells us whether the plan works.`;
}

/** Teaching on one Sunday (Plans/Meeting-Planner-III-Family.md, D1): at most this many classes and minutes, for adults
 *  and Junior Leaders alike, so nobody signs up for more than they can deliver. Checked by teach-actions on every add. */
export const TEACH_MAX_CLASSES = 3;
export const TEACH_MAX_MIN = 60;

/** Why taking on `min` more minutes of teaching doesn't fit; null when it fits. `who` is 'You' or a first name. */
export function teachRefusal(who: string, load: { classes: number; minutes: number }, min: number): string | null {
  if (load.classes >= TEACH_MAX_CLASSES) return `${who === 'You' ? 'You’re' : `${who} is`} at ${TEACH_MAX_CLASSES} classes, the most for one Sunday. Drop one to take this.`;
  if (load.minutes + min > TEACH_MAX_MIN) return `This would make ${load.minutes + min} minutes. Teaching is capped at ${TEACH_MAX_MIN} minutes on a Sunday.`;
  return null;
}
