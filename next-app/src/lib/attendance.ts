/**
 * Roll Call — server loaders.
 *
 * The pure helpers and types live in `lib/attendance-shared.ts` because the
 * Roll Call sheet is a Client Component and must not pull the service-role
 * client into the browser bundle. Same split as calendar.ts / calendar-shared.ts.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { withOffDirectoryCandidates, type AttendanceRow, type AttendeeCandidate } from '@/lib/attendance-shared';

export * from '@/lib/attendance-shared';

/**
 * One entry's attendance. Not paginated on purpose: this is scoped to a single
 * event, and no troop event has 1,000 attendees. Unfiltered reads of this table
 * DO need `fetchAllRows` — it passed 1,000 rows the day the backfill landed —
 * see the Roll Call list and the reconciliation audit.
 */
export async function loadAttendance(entryId: number): Promise<AttendanceRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('event_attendance')
    .select('id, person_id, qty, source, note')
    .eq('calendar_entry_id', entryId);
  if (error) throw new Error(`Attendance failed to load: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as number,
    personId: r.person_id as number,
    qty: r.qty as number | null,
    source: r.source as AttendanceRow['source'],
    note: r.note as string | null
  }));
}

/**
 * Everyone who could be marked present, with the signup's "yes" list flagged.
 *
 * The signup is a SEED, not a source of truth: it pre-checks the list and is
 * then left alone forever. Unchecking someone in Roll Call never cancels their
 * signup — they still owe money and still hold their job claim.
 */
export async function loadCandidates(entryId: number): Promise<AttendeeCandidate[]> {
  const supabase = createAdminClient();

  const [{ data: people, error }, { data: signup }] = await Promise.all([
    supabase
      .from('person_directory')
      .select('person_id, display_name, scout_id, tab, active')
      .eq('active', true)
      .order('display_name'),
    supabase.from('event_signups').select('id').eq('calendar_entry_id', entryId).maybeSingle()
  ]);
  if (error) throw new Error(`Directory failed to load: ${error.message}`);

  const signedUp = new Set<number>();
  if (signup) {
    const { data: entries } = await supabase
      .from('signup_entries')
      .select('person_id')
      .eq('event_signup_id', signup.id)
      .eq('status', 'yes');
    for (const e of entries ?? []) {
      if (e.person_id != null) signedUp.add(e.person_id as number);
    }
  }

  const directory: AttendeeCandidate[] = (people ?? []).map((p) => ({
    personId: p.person_id as number,
    displayName: p.display_name as string,
    scoutId: (p.scout_id as string) ?? null,
    tab: p.tab as string,
    signedUp: signedUp.has(p.person_id as number)
  }));

  // Guests are not in the directory — anyone who signed up or already holds
  // an attendance row must still be on the sheet, or they can't be unmarked.
  const known = new Set(directory.map((c) => c.personId));
  const { data: marked } = await supabase
    .from('event_attendance')
    .select('person_id')
    .eq('calendar_entry_id', entryId);
  const offDirectory = [
    ...new Set([...signedUp, ...(marked ?? []).map((m) => m.person_id as number)])
  ].filter((id) => !known.has(id));
  if (offDirectory.length === 0) return directory;
  const { data: extras } = await supabase.from('people').select('id, display_name').in('id', offDirectory);
  return withOffDirectoryCandidates(
    directory,
    (extras ?? []) as { id: number; display_name: string }[],
    signedUp
  );
}
