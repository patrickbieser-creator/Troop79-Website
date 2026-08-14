/**
 * Roll Call — server loaders.
 *
 * The pure helpers and types live in `lib/attendance-shared.ts` because the
 * Roll Call sheet is a Client Component and must not pull the service-role
 * client into the browser bundle. Same split as calendar.ts / calendar-shared.ts.
 */

import { createAdminClient } from '@/lib/supabase/server';
import type { AttendanceRow, AttendeeCandidate } from '@/lib/attendance-shared';

export * from '@/lib/attendance-shared';

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

  return (people ?? []).map((p) => ({
    personId: p.person_id as number,
    displayName: p.display_name as string,
    scoutId: (p.scout_id as string) ?? null,
    tab: p.tab as string,
    signedUp: signedUp.has(p.person_id as number)
  }));
}
