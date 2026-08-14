import { createAdminClient } from '@/lib/supabase/server';
import { loadCalendarCategories } from '@/lib/calendar';
import type { CalendarEntry, Media } from '@/lib/supabase/types';

// The row type moved to entry-form.tsx with the form itself; re-exported so
// existing importers keep working.
export type { CalendarEntryRow } from './entry-form';
import type { CalendarEntryRow } from './entry-form';
import { CalendarEditor } from './calendar-editor';
import {
  createCalendarEntry,
  updateCalendarEntry,
  deleteCalendarEntry,
  cloneCalendarEntry,
  importCalendarEntries
} from './actions';
import styles from './calendar.module.css';

export const metadata = {
  title: 'Calendar — Troop 79'
};

async function loadData() {
  const supabase = createAdminClient();
  // Oldest first: the tabs below split upcoming from past, and within each
  // an ascending run reads as a schedule rather than a reverse log.
  // hero_media joined for the promotion section's picker preview.
  const [{ data, error }, { data: agendas, error: agendaError }] = await Promise.all([
    supabase
      .from('calendar_entries')
      .select('*, hero_media:hero_media_id(*)')
      .order('entry_date', { ascending: true }),
    supabase.from('meetings').select('calendar_entry_id').is('archived_at', null)
  ]);
  // Surfaced rather than swallowed: `const { data } = await …` turns a failed
  // query into an empty calendar, which reads as "nothing scheduled" instead of
  // "something is broken" (the loadCalendarCategories grey-out lesson).
  if (error) throw new Error(`Calendar entries failed to load: ${error.message}`);
  if (agendaError) throw new Error(`Meeting layers failed to load: ${agendaError.message}`);

  const withAgenda = new Set(
    ((agendas ?? []) as { calendar_entry_id: number }[]).map((m) => m.calendar_entry_id)
  );
  const entries = ((data ?? []) as unknown as (CalendarEntry & { hero_media: Media | null })[]).map(
    (e) => ({ ...e, hasAgenda: withAgenda.has(e.id) })
  );
  return { entries: entries as CalendarEntryRow[] };
}

export default async function CalendarAdminPage() {
  const [{ entries }, categories] = await Promise.all([loadData(), loadCalendarCategories()]);

  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Calendar</h1>
        <p>
          Everything that happens on a date, whether or not it&rsquo;s on the troop calendar &mdash;
          meetings, campouts, fundraisers, and outside opportunities like district merit badge
          clinics. Add one here, then <strong>Edit</strong>{' '}
          it to add a story, an agenda or a signup;
          the category you pick decides which of those the entry starts with. On-calendar entries
          feed the public calendar and .ics subscription; any entry can promote itself into the
          homepage news feed for a window &mdash; no separate article needed.
        </p>
      </div>

      <CalendarEditor
        rows={entries}
        categories={categories}
        onCreate={createCalendarEntry}
        onUpdate={updateCalendarEntry}
        onDelete={deleteCalendarEntry}
        onClone={cloneCalendarEntry}
        onImport={importCalendarEntries}
      />
    </>
  );
}
