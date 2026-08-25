import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
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

async function loadData() {
  const supabase = createAdminClient();
  // Oldest first: the tabs below split upcoming from past, and within each
  // an ascending run reads as a schedule rather than a reverse log.
  // hero_media joined for the promotion section's picker preview.
  const [
    { data, error },
    { data: agendas, error: agendaError },
    { data: signups, error: signupError },
    attendance,
    { data: scouts },
    signupEntries
  ] = await Promise.all([
    supabase
      .from('calendar_entries')
      .select('*, hero_media:hero_media_id(*)')
      .order('entry_date', { ascending: true }),
    supabase.from('meetings').select('id, calendar_entry_id, status').is('archived_at', null),
    supabase.from('event_signups').select('id, calendar_entry_id, status'),
    // The Roll Call list folded in here (2026-08-24), and with it its
    // PAGINATED attendance read: event_attendance passed 1,000 rows the day
    // the backfill landed, and PostgREST caps an unbounded read SILENTLY.
    fetchAllRows<{ calendar_entry_id: number; person_id: number }>((from, to) =>
      supabase.from('event_attendance').select('calendar_entry_id, person_id').range(from, to)
    ),
    supabase.from('scouts').select('person_id').not('person_id', 'is', null),
    // The Going column (2026-08-25): one paginated read of every "yes"
    // reply, reduced per signup below — the same aggregate as the
    // event_signup_headcount RPC, but ONE query for the whole list rather
    // than one RPC round-trip per signup (the loop the retired /admin/events
    // list ran).
    fetchAllRows<{ event_signup_id: number; guest_count: number | null }>((from, to) =>
      supabase
        .from('signup_entries')
        .select('event_signup_id, guest_count')
        .eq('status', 'yes')
        .eq('participation', 'full')
        .range(from, to)
    )
  ]);
  // Surfaced rather than swallowed: `const { data } = await …` turns a failed
  // query into an empty calendar, which reads as "nothing scheduled" instead of
  // "something is broken" (the loadCalendarCategories grey-out lesson).
  if (error) throw new Error(`Calendar entries failed to load: ${error.message}`);
  if (agendaError) throw new Error(`Meeting layers failed to load: ${agendaError.message}`);
  if (signupError) throw new Error(`Signup layers failed to load: ${signupError.message}`);

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
  const scoutPeople = new Set(((scouts ?? []) as { person_id: number }[]).map((s) => s.person_id));
  const counts = new Map<number, { scouts: number; adults: number }>();
  for (const a of attendance) {
    const c = counts.get(a.calendar_entry_id) ?? { scouts: 0, adults: 0 };
    if (scoutPeople.has(a.person_id)) c.scouts += 1;
    else c.adults += 1;
    counts.set(a.calendar_entry_id, c);
  }
  const goingBySignup = new Map<number, number>();
  for (const s of signupEntries) {
    goingBySignup.set(s.event_signup_id, (goingBySignup.get(s.event_signup_id) ?? 0) + 1 + (s.guest_count ?? 0));
  }

  const entries = ((data ?? []) as unknown as (CalendarEntry & { hero_media: Media | null })[]).map(
    (e) => {
      const agenda = agendaByEntry.get(e.id);
      const signup = signupByEntry.get(e.id);
      return {
        ...e,
        hasAgenda: agenda !== undefined,
        agendaId: agenda?.id ?? null,
        agendaStatus: agenda?.status ?? null,
        signupId: signup?.id ?? null,
        signupStatus: signup?.status ?? null,
        attendance: counts.get(e.id) ?? null,
        going: signup ? (goingBySignup.get(signup.id) ?? 0) : null
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
      <PageTitle
        title="Calendar"
        sub={
          <>
            Everything that happens on a date, whether or not it&rsquo;s on the troop calendar
            &mdash; meetings, campouts, fundraisers, and outside opportunities like district merit
            badge clinics. Add one here, then <strong>Edit</strong>{' '}
            it to add a story, an agenda, a signup or take roll call. The Status pills say what each
            entry carries &mdash; <strong>A</strong>genda, <strong>S</strong>ignup, <strong>R</strong>oll
            call taken, <strong>O</strong>n the calendar &mdash; green when live, yellow while a draft;
            click one to open that layer. On-calendar entries feed the public calendar and .ics
            subscription; any entry can promote itself into the homepage news feed for a window.
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
