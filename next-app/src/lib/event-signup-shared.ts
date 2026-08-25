/**
 * Signup helpers with NO server dependencies.
 *
 * Split out of lib/event-signup.ts on 2026-08-22: that module is a set of
 * LOADERS and imports the Supabase server client, which reaches for
 * next/headers. The signup builder is a client component, so importing these
 * from there dragged server-only code into the client bundle and broke the
 * production build. Pure rules live here; anything that touches the database
 * stays next door.
 */

/**
 * Every path a signup change has to flush.
 *
 * `/events/{id}/signup` — the slot-first form families actually sign up on —
 * was missing from this list: nothing in the codebase revalidated it. That is
 * latent rather than currently visible, because the page awaits searchParams
 * and is therefore rendered dynamically today; the gap would bite the moment
 * it stopped being, which is one `export const revalidate` away.
 *
 * Recorded honestly because it was found while chasing a DIFFERENT problem
 * (Patrick, 2026-08-22: a job showing Sep 2 on the public form after being
 * changed to Sep 16 in the builder). That turned out to be a duplicate job
 * still dated Sep 2, not staleness — the form was right. This list was
 * genuinely incomplete regardless, so it is fixed and tested rather than left
 * for a future reader to trip over.
 */
export function eventRevalidatePaths(calendarEntryId: number, signupId?: number): string[] {
  const paths = [
    '/admin/events',
    // The calendar list (status pill + Going count) and the entry workbench,
    // whose Signup tab hosts the builder (2026-08-25).
    '/admin/calendar',
    `/admin/calendar/${calendarEntryId}`,
    `/events/${calendarEntryId}`,
    // The slot-first signup form — the page that actually shows job dates.
    `/events/${calendarEntryId}/signup`,
    '/events'
  ];
  // signupId is accepted for callers that have it; the builder no longer has
  // a signup-keyed path of its own.
  void signupId;
  return paths;
}

export interface JobDateNote {
  direction: 'before' | 'after';
  days: number;
  text: string;
}

/**
 * A note when a job's date falls outside its event — never a block.
 *
 * A job OUTSIDE the event is often exactly right: the Thursday shopping run
 * before a Friday campout is the canonical case, and the clone deliberately
 * preserves that offset. So this states the relationship rather than
 * forbidding it.
 *
 * It exists because the difference was invisible. A stray Sep 2 job on a
 * Sep 16 service project read as "the clone didn't shift the dates", and then
 * made two otherwise-identical rows impossible to tell apart when deleting
 * one — the date was the only thing that differed, in a dense column (Patrick
 * and the troop's event coordinator, 2026-08-22).
 *
 * Measured from the NEAREST edge of a multi-day event: a Monday job on a
 * Fri–Sun campout is one day after it ends, not three after it starts. The
 * bigger number would read as a worse mistake than it is.
 */
export function jobDateNote(
  slotDate: string | null,
  entryDate: string,
  endDate: string | null
): JobDateNote | null {
  // An untimed task with no date means "anytime before the event" — a real
  // state, not a mistake.
  if (!slotDate || !entryDate) return null;
  const last = endDate && endDate > entryDate ? endDate : entryDate;
  if (slotDate >= entryDate && slotDate <= last) return null;

  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).getTime();
  const before = slotDate < entryDate;
  const days = Math.round(
    Math.abs(before ? day(entryDate) - day(slotDate) : day(slotDate) - day(last)) / 86_400_000
  );
  return {
    direction: before ? 'before' : 'after',
    days,
    text: `${days} day${days === 1 ? '' : 's'} ${before ? 'before' : 'after'} the event`
  };
}
