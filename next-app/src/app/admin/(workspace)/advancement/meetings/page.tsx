/**
 * /admin/advancement/meetings — the Roll Call work list, for EVERY event.
 *
 * It used to list `meetings` rows only, which meant the one screen that
 * answered "who was at what" could only answer it for Sunday nights. Campouts,
 * service projects and fundraisers had attendance too — scattered across
 * ledger rows entered days later — and no screen showed it.
 *
 * Rows are now calendar ENTRIES, so every event with attendance appears in one
 * place, with its count and a way in. Agendas remain a meeting-only layer and
 * show as a column rather than as the thing the list is made of.
 *
 * Entries whose category tracks nothing at all — "No Meeting" — are left out:
 * a cancelled week has no attendance to take, and listing it would only pad the
 * screen.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/require-role';
import { AttendanceList, type AttendanceListRow } from './meetings-list';
import { deleteMeeting } from './actions';
import styles from './meetings.module.css';

export const metadata = {
  title: 'Roll Call — Troop 79'
};

async function loadRows(): Promise<AttendanceListRow[]> {
  const supabase = createAdminClient();

  const [{ data: entries, error }, { data: categories }, { data: meetings }, { data: attendance }] =
    await Promise.all([
      supabase
        .from('calendar_entries')
        .select('id, title, entry_date, category')
        .order('entry_date', { ascending: false }),
      supabase.from('calendar_categories').select('label, credit_kind, counts_as_activity'),
      supabase.from('meetings').select('id, status, calendar_entry_id').is('archived_at', null),
      supabase.from('event_attendance').select('calendar_entry_id, person_id')
    ]);
  if (error) throw new Error(`Calendar entries failed to load: ${error.message}`);

  // Which people are scouts — the split the roll call list reports.
  const { data: scouts } = await supabase.from('scouts').select('person_id').not('person_id', 'is', null);
  const scoutPeople = new Set(
    ((scouts ?? []) as { person_id: number }[]).map((s) => s.person_id)
  );

  const trackable = new Set(
    ((categories ?? []) as { label: string; credit_kind: string | null; counts_as_activity: boolean }[])
      .filter((c) => c.credit_kind !== null || c.counts_as_activity)
      .map((c) => c.label)
  );

  const meetingByEntry = new Map(
    ((meetings ?? []) as { id: number; status: string; calendar_entry_id: number }[]).map((m) => [
      m.calendar_entry_id,
      m
    ])
  );

  const counts = new Map<number, { scouts: number; adults: number }>();
  for (const a of (attendance ?? []) as { calendar_entry_id: number; person_id: number }[]) {
    const c = counts.get(a.calendar_entry_id) ?? { scouts: 0, adults: 0 };
    if (scoutPeople.has(a.person_id)) c.scouts += 1;
    else c.adults += 1;
    counts.set(a.calendar_entry_id, c);
  }

  return ((entries ?? []) as { id: number; title: string; entry_date: string; category: string }[])
    .filter((e) => trackable.has(e.category))
    .map((e) => {
      const meeting = meetingByEntry.get(e.id);
      const count = counts.get(e.id);
      return {
        entryId: e.id,
        title: e.title,
        entryDate: e.entry_date,
        category: e.category,
        agendaId: meeting?.id ?? null,
        agendaStatus: meeting?.status ?? null,
        scoutCount: count?.scouts ?? 0,
        adultCount: count?.adults ?? 0
      };
    });
}

export default async function RollCallListPage() {
  await requireRole(['leader']);
  const rows = await loadRows();

  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Roll Call</h1>
        <p>
          Who was at what &mdash; every event that tracks attendance, not just meetings. Open one to
          take or correct its roll call; marking a scout present grants the ledger credit its
          category carries. Meetings also carry an agenda, edited separately.
        </p>
      </div>

      <AttendanceList rows={rows} onDeleteAgenda={deleteMeeting} />
    </>
  );
}
