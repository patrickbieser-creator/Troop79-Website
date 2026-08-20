import Link from 'next/link';
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
  mergeCalendarEntries,
  cloneCalendarEntry,
  setEntryPromoted,
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
  const [
    { data, error },
    { data: agendas, error: agendaError },
    { data: signups, error: signupError }
  ] = await Promise.all([
    supabase
      .from('calendar_entries')
      .select('*, hero_media:hero_media_id(*)')
      .order('entry_date', { ascending: true }),
    supabase.from('meetings').select('calendar_entry_id, status').is('archived_at', null),
    supabase.from('event_signups').select('calendar_entry_id, status')
  ]);
  // Surfaced rather than swallowed: `const { data } = await …` turns a failed
  // query into an empty calendar, which reads as "nothing scheduled" instead of
  // "something is broken" (the loadCalendarCategories grey-out lesson).
  if (error) throw new Error(`Calendar entries failed to load: ${error.message}`);
  if (agendaError) throw new Error(`Meeting layers failed to load: ${agendaError.message}`);
  if (signupError) throw new Error(`Signup layers failed to load: ${signupError.message}`);

  // Layer state, resolved once for the whole list rather than per row. This is
  // what the Status column reports: an entry's own state is only half the
  // story now that it carries layers, and "which of these still needs work?"
  // is the question a leader actually opens this screen with.
  const agendaStatus = new Map(
    ((agendas ?? []) as { calendar_entry_id: number; status: string }[]).map((m) => [
      m.calendar_entry_id,
      m.status
    ])
  );
  const signupStatus = new Map(
    ((signups ?? []) as { calendar_entry_id: number; status: string }[]).map((s) => [
      s.calendar_entry_id,
      s.status
    ])
  );

  const entries = ((data ?? []) as unknown as (CalendarEntry & { hero_media: Media | null })[]).map(
    (e) => ({
      ...e,
      hasAgenda: agendaStatus.has(e.id),
      agendaStatus: agendaStatus.get(e.id) ?? null,
      signupStatus: signupStatus.get(e.id) ?? null
    })
  );
  return { entries: entries as CalendarEntryRow[] };
}

interface SearchParams {
  q?: string;
  category?: string;
  tab?: string;
  /** '1' opens the Add Entry dialog — see the header link below. */
  new?: string;
}

function urlWith(base: SearchParams, overrides: Partial<SearchParams>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...overrides })) {
    if (v !== undefined && v !== '' && v !== null) params.set(k, String(v));
  }
  const qs = params.toString();
  return `/admin/calendar${qs ? `?${qs}` : ''}`;
}

/**
 * List state lives in the URL, matching News.
 *
 * It used to be useState, which meant a reload dropped you back to Upcoming
 * with an empty search, the back button skipped past your filtering entirely,
 * and a filtered view could not be linked to anyone. News had this right; the
 * two screens now behave the same.
 */
export default async function CalendarAdminPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [{ entries }, categories, sp] = await Promise.all([
    loadData(),
    loadCalendarCategories(),
    searchParams
  ]);

  return (
    <>
      <div className={styles.pageTitle}>
        <div>
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
        {/* Top-right of the page header, where News puts "+ New Post" — same
            act, same place, same shape of button.
            It is a link rather than a button because the dialog it opens lives
            inside the client list; `new=1` is how the header reaches it without
            lifting state out of a Server Component. */}
        <Link href={urlWith(sp, { new: '1' })} className={styles.newBtn}>
          + Add Entry
        </Link>
      </div>

      <CalendarEditor
        rows={entries}
        q={(sp.q ?? '').trim()}
        category={(sp.category ?? '').trim()}
        tab={sp.tab === 'past' ? 'past' : 'upcoming'}
        newOpen={sp.new === '1'}
        onSetPromoted={setEntryPromoted}
        categories={categories}
        onCreate={createCalendarEntry}
        onUpdate={updateCalendarEntry}
        onDelete={deleteCalendarEntry}
        onMerge={mergeCalendarEntries}
        onClone={cloneCalendarEntry}
        onImport={importCalendarEntries}
      />
    </>
  );
}
