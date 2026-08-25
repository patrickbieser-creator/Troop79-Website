import { createAdminClient } from '@/lib/supabase/server';
import { loadCalendarCategories } from '@/lib/calendar';
import type { CalendarEntry, Media } from '@/lib/supabase/types';

// The row type moved to entry-form.tsx with the form itself; re-exported so
// existing importers keep working.
export type { CalendarEntryRow } from './entry-form';
import type { CalendarEntryRow } from './entry-form';
import { CalendarEditor } from './calendar-editor';
import { PageTitle } from '../_components/page-title';
import {
  createCalendarEntry,
  updateCalendarEntry,
  deleteCalendarEntry,
  mergeCalendarEntries,
  cloneCalendarEntry,
  setEntryPromoted
} from './actions';

export const metadata = {
  title: 'Calendar — Troop 79'
};

/** Every column the list, the clone dialog and the promotion picker read —
 *  NOT details_md (the markdown story), which the workbench alone edits and
 *  which was riding along for every row (2026-08-25 perf pass). */
const LIST_COLUMNS =
  'id, entry_date, end_date, day_note, category, title, description, location, start_time, end_time, on_calendar, status, show_on_homepage, featured, featured_order, promo_start, promo_end, hero_media_id, auto_archive_at, author_name, created_at, hero_media:hero_media_id(*)';

async function loadData() {
  const supabase = createAdminClient();
  // Oldest first: the tabs below split upcoming from past, and within each
  // an ascending run reads as a schedule rather than a reverse log.
  // hero_media joined for the promotion section's picker preview.
  //
  // Per-entry counts (R pill scouts/adults, Going) come from ONE aggregate —
  // calendar_list_counts() — instead of paginated reads of the whole
  // event_attendance and signup_entries tables reduced in Node (Patrick,
  // 2026-08-25: "the calendar page … is getting much slower on prod").
  const [{ data, error }, { data: agendas, error: agendaError }, { data: signups, error: signupError }, { data: countRows, error: countError }] =
    await Promise.all([
      supabase.from('calendar_entries').select(LIST_COLUMNS).order('entry_date', { ascending: true }),
      supabase.from('meetings').select('id, calendar_entry_id, status').is('archived_at', null),
      supabase.from('event_signups').select('id, calendar_entry_id, status'),
      supabase.rpc('calendar_list_counts')
    ]);
  // Surfaced rather than swallowed: `const { data } = await …` turns a failed
  // query into an empty calendar, which reads as "nothing scheduled" instead of
  // "something is broken" (the loadCalendarCategories grey-out lesson).
  if (error) throw new Error(`Calendar entries failed to load: ${error.message}`);
  if (agendaError) throw new Error(`Meeting layers failed to load: ${agendaError.message}`);
  if (signupError) throw new Error(`Signup layers failed to load: ${signupError.message}`);
  if (countError) throw new Error(`Calendar counts failed to load: ${countError.message}`);

  // Layer state, resolved once for the whole list rather than per row. This is
  // what the Status column's letter pills report: an entry's own state is only
  // half the story now that it carries layers, and "which of these still needs
  // work?" is the question a leader actually opens this screen with.
  const agendaByEntry = new Map(
    ((agendas ?? []) as { id: number; calendar_entry_id: number; status: string }[]).map((m) => [
      m.calendar_entry_id,
      m
    ])
  );
  const signupByEntry = new Map(
    ((signups ?? []) as { id: number; calendar_entry_id: number; status: string }[]).map((s) => [
      s.calendar_entry_id,
      s
    ])
  );
  const counts = new Map(
    ((countRows ?? []) as { calendar_entry_id: number; scouts: number; adults: number; going: number }[]).map((c) => [
      c.calendar_entry_id,
      c
    ])
  );

  const entries = ((data ?? []) as unknown as (CalendarEntry & { hero_media: Media | null })[]).map(
    (e) => {
      const agenda = agendaByEntry.get(e.id);
      const signup = signupByEntry.get(e.id);
      const c = counts.get(e.id);
      const present = (c?.scouts ?? 0) + (c?.adults ?? 0);
      return {
        ...e,
        hasAgenda: agenda !== undefined,
        agendaId: agenda?.id ?? null,
        agendaStatus: agenda?.status ?? null,
        signupId: signup?.id ?? null,
        signupStatus: signup?.status ?? null,
        attendance: present > 0 ? { scouts: c!.scouts, adults: c!.adults } : null,
        going: signup ? (c?.going ?? 0) : null
      };
    }
  );
  return { entries: entries as CalendarEntryRow[] };
}

interface SearchParams {
  q?: string;
  category?: string;
  tab?: string;
  /** '1' opens the Add Entry dialog — set by the Actions ▾ "+ Add Entry"
   *  option inside CalendarEditor (2026-08-20; used to be a header link). */
  new?: string;
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
      <PageTitle back={null}
        title="Calendar"
        // Orientation only (2026-08-25, Brad's split): what the screen is for
        // and the one verb. The pill legend is a ? badge on the Status header;
        // the .ics / promotion consequences are hints beside their fields.
        sub={
          <>
            Everything that happens on a date, whether or not it&rsquo;s on the troop calendar
            &mdash; meetings, campouts, fundraisers, and outside opportunities like district merit
            badge clinics. Add one here, then open it to write the story, add an agenda or a signup,
            or take roll call.
          </>
        }
      />

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
      />
    </>
  );
}
