import { createAdminClient } from '@/lib/supabase/server';
import { CATEGORIES } from '@/lib/calendar';
import type { CalendarEntry } from '@/lib/supabase/types';
import { CalendarEditor } from './calendar-editor';
import { createCalendarEntry, updateCalendarEntry, deleteCalendarEntry } from './actions';
import styles from './calendar.module.css';

export const metadata = {
  title: 'Calendar — Troop 79'
};

export interface ArticleOption {
  id: number;
  title: string;
}

async function loadData() {
  const supabase = createAdminClient();
  const [entriesRes, articlesRes] = await Promise.all([
    supabase.from('calendar_entries').select('*').order('entry_date', { ascending: false }),
    supabase.from('articles').select('id, title').order('created_at', { ascending: false }).limit(200)
  ]);
  return {
    entries: (entriesRes.data ?? []) as CalendarEntry[],
    articles: (articlesRes.data ?? []) as ArticleOption[]
  };
}

export default async function CalendarAdminPage() {
  const { entries, articles } = await loadData();

  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Calendar</h1>
        <p>
          Everything that shows up on the public calendar and the .ics subscription feed — routine
          meetings, campouts, fundraisers, and anything else worth a date. Optionally link an entry to
          a News article for a &ldquo;Read the full story&rdquo; button.
        </p>
      </div>

      <CalendarEditor
        rows={entries}
        articles={articles}
        categories={CATEGORIES}
        onCreate={createCalendarEntry}
        onUpdate={updateCalendarEntry}
        onDelete={deleteCalendarEntry}
      />
    </>
  );
}
