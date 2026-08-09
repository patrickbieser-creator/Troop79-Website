import { createAdminClient } from '@/lib/supabase/server';
import { CATEGORIES } from '@/lib/calendar';
import type { CalendarEntry, Media } from '@/lib/supabase/types';

/** Admin rows carry the resolved promotion hero for the editor's preview. */
export type CalendarEntryRow = CalendarEntry & { hero_media: Media | null };
import { CalendarEditor } from './calendar-editor';
import {
  createCalendarEntry,
  updateCalendarEntry,
  deleteCalendarEntry,
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
  const { data } = await supabase
    .from('calendar_entries')
    .select('*, hero_media:hero_media_id(*)')
    .order('entry_date', { ascending: true });
  return { entries: (data ?? []) as unknown as CalendarEntryRow[] };
}

export default async function CalendarAdminPage() {
  const { entries } = await loadData();

  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Calendar</h1>
        <p>
          Everything that shows up on the public calendar and the .ics subscription feed — routine
          meetings, campouts, fundraisers, and anything else worth a date. An entry can also promote
          itself into the homepage news feed for a window — no separate article needed.
        </p>
      </div>

      <CalendarEditor
        rows={entries}
        categories={CATEGORIES}
        onCreate={createCalendarEntry}
        onUpdate={updateCalendarEntry}
        onDelete={deleteCalendarEntry}
        onImport={importCalendarEntries}
      />
    </>
  );
}
