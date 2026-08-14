/**
 * /admin/calendar/[entryId] — the calendar entry workbench.
 *
 * ENTRY-keyed, which is the whole point: /admin/events/[id] is keyed by SIGNUP
 * id, so an entry without a signup could not be opened, and `details_md` had no
 * editor anywhere in admin.
 *
 * Panel composition comes from the category's template; panel PERMISSION comes
 * from the session role. A scout reaches this page (the entry editor is the
 * surface they already had at /admin/news/calendar) but never the agenda or
 * roll-call panels — and the routes behind those panels enforce leader-only
 * themselves, so hiding a panel is never the only thing standing in the way.
 */

import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/require-role';
import { loadCalendarCategories } from '@/lib/calendar';
import { categoryColorMap, colorFor, templateOf } from '@/lib/calendar-categories';
import { createMeeting } from '../../advancement/meetings/actions';
import { updateEntryStory } from '../actions';
import { Workbench, type WorkbenchEntry } from './workbench';

export const metadata = { title: 'Calendar Entry — Troop 79' };

export default async function CalendarEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['leader', 'scout']);
  const { id } = await params;
  const entryId = Number(id);
  if (!Number.isInteger(entryId) || entryId <= 0) notFound();

  const supabase = createAdminClient();
  const [{ data: entry }, categories] = await Promise.all([
    supabase
      .from('calendar_entries')
      .select(
        'id, title, entry_date, end_date, category, location, description, details_md, on_calendar, show_on_homepage'
      )
      .eq('id', entryId)
      .maybeSingle(),
    loadCalendarCategories()
  ]);
  if (!entry) notFound();

  const isLeader = session.role === 'leader';

  // Layer lookups are leader-only queries: a scout is not shown these panels,
  // so it would be wasted work — and not loading them is one less thing that
  // could leak into a payload.
  const [{ data: meeting }, { data: signup }] = isLeader
    ? await Promise.all([
        supabase
          .from('meetings')
          .select('id, status')
          .eq('calendar_entry_id', entryId)
          .is('archived_at', null)
          .maybeSingle(),
        supabase.from('event_signups').select('id').eq('calendar_entry_id', entryId).maybeSingle()
      ])
    : [{ data: null }, { data: null }];

  const workbenchEntry: WorkbenchEntry = {
    id: entry.id as number,
    title: entry.title as string,
    entry_date: entry.entry_date as string,
    end_date: (entry.end_date as string) ?? null,
    category: entry.category as string,
    categoryColor: colorFor(categoryColorMap(categories), entry.category as string),
    location: (entry.location as string) ?? null,
    description: (entry.description as string) ?? null,
    details_md: (entry.details_md as string) ?? null,
    on_calendar: entry.on_calendar as boolean,
    show_on_homepage: (entry.show_on_homepage as boolean) ?? false
  };

  return (
    <Workbench
      entry={workbenchEntry}
      template={templateOf(categories, workbenchEntry.category)}
      meeting={meeting ? { id: meeting.id as number, status: meeting.status as string } : null}
      signupId={signup ? (signup.id as number) : null}
      canManageAgenda={isLeader}
      onSaveStory={updateEntryStory}
      // Withheld from a scout session entirely rather than merely unused: the
      // action enforces requireRole(['leader']) itself, so this is hygiene, but
      // a leader-only action reference has no business in a scout's payload.
      onAddAgenda={isLeader ? createMeeting : undefined}
    />
  );
}
