/**
 * /admin/calendar/[entryId] — the calendar entry workbench.
 *
 * ENTRY-keyed, which is the whole point: /admin/events/[id] is keyed by SIGNUP
 * id, so an entry without a signup could not be opened, and `details_md` had no
 * editor anywhere in admin.
 *
 * Panel composition comes from the category's template. Panel PERMISSION no
 * longer varies: calendar entries became leader-only to edit (Patrick,
 * 2026-08-14), so the panel-level scout split this page used to carry is gone —
 * a scout does not reach the calendar admin at all now. The routes behind each
 * panel still enforce leader-only themselves; hiding a panel was never the only
 * thing standing in the way, and still isn't.
 */

import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/require-role';
import { loadCalendarCategories } from '@/lib/calendar';
import { categoryColorMap, colorFor, templateOf } from '@/lib/calendar-categories';
import { createMeeting } from '../../advancement/meetings/actions';
import { updateEntryStory, updateCalendarEntry, createCalendarEntry } from '../actions';
import type { CalendarEntryRow } from '../entry-form';
import { Workbench, type WorkbenchEntry } from './workbench';

export const metadata = { title: 'Calendar Entry — Troop 79' };

export default async function CalendarEntryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(['leader']);
  const { id } = await params;
  const entryId = Number(id);
  if (!Number.isInteger(entryId) || entryId <= 0) notFound();

  const supabase = createAdminClient();
  // Everything, plus the promotion hero — the Details panel is the full entry
  // editor now, not a summary.
  const [{ data: entry }, categories] = await Promise.all([
    supabase
      .from('calendar_entries')
      .select('*, hero_media:hero_media_id(*)')
      .eq('id', entryId)
      .maybeSingle(),
    loadCalendarCategories()
  ]);
  if (!entry) notFound();

  // Unconditional now — everyone who reaches this page is a leader.
  const [{ data: meeting }, { data: signup }] = await Promise.all([
    supabase
      .from('meetings')
      .select('id, status')
      .eq('calendar_entry_id', entryId)
      .is('archived_at', null)
      .maybeSingle(),
    supabase.from('event_signups').select('id').eq('calendar_entry_id', entryId).maybeSingle()
  ]);

  const row = entry as unknown as CalendarEntryRow;
  const workbenchEntry: WorkbenchEntry = {
    id: row.id,
    title: row.title,
    entry_date: row.entry_date,
    end_date: row.end_date ?? null,
    category: row.category,
    categoryColor: colorFor(categoryColorMap(categories), row.category),
    location: row.location ?? null,
    description: row.description ?? null,
    details_md: row.details_md ?? null,
    on_calendar: row.on_calendar,
    show_on_homepage: row.show_on_homepage ?? false
  };

  return (
    <Workbench
      entry={workbenchEntry}
      // The full row feeds the Details panel's form, which is the same
      // component the list's "+ Add Entry" dialog uses.
      row={{ ...row, hasAgenda: false }}
      categories={categories}
      onSaveDetails={updateCalendarEntry}
      template={templateOf(categories, workbenchEntry.category)}
      meeting={meeting ? { id: meeting.id as number, status: meeting.status as string } : null}
      signupId={signup ? (signup.id as number) : null}
      onSaveStory={updateEntryStory}
      onCreateEntry={createCalendarEntry}
      onAddAgenda={createMeeting}
    />
  );
}
