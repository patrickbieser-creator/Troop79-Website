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
import { requireCapability } from '@/lib/require-capability';
import { loadCalendarCategories } from '@/lib/calendar';
import { categoryColorMap, colorFor, templateOf } from '@/lib/calendar-categories';
import { creditRuleFor, defaultQtyFor, loadAttendance, loadCandidates } from '@/lib/attendance';
import {
  createMeeting,
  updateMeeting,
  setMeetingStatus,
  createSession,
  updateSession,
  deleteSession,
  moveSession,
  promotePlanSession,
  deleteMeeting
} from '../../advancement/meetings/actions';
import { loadAgendaEditorData } from '../../advancement/meetings/load-agenda';
import { loadBuilderData } from '../../events/[id]/load-builder';
import type { Meeting } from '@/lib/supabase/types';
import { updateEntryStory, updateCalendarEntry, createCalendarEntry } from '../actions';
import { markAttended, markAbsent, setAttendanceQty, seedFromSignup } from './roll-call/actions';
import type { CalendarEntryRow } from '../entry-form';
import { Workbench, type WorkbenchEntry, type WorkbenchTab } from './workbench';

export const metadata = { title: 'Calendar Entry — Troop 79' };

const TABS: WorkbenchTab[] = ['details', 'story', 'agenda', 'roll-call', 'signup'];

export default async function CalendarEntryPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireCapability('calendar.write');
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const entryId = Number(id);
  if (!Number.isInteger(entryId) || entryId <= 0) notFound();
  // `?tab=roll-call` etc. — the layer screens' back links land on their own tab.
  const initialTab = TABS.find((t) => t === sp.tab);

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

  // Unconditional now — everyone who reaches this page is a leader. The Roll
  // Call sheet renders inside its tab (Patrick, 2026-08-24), so its loads —
  // who is here, who could be, what the category credits — happen here too.
  const [{ data: meeting }, { data: signup }, attendance, candidates] = await Promise.all([
    supabase
      .from('meetings')
      .select('*')
      .eq('calendar_entry_id', entryId)
      .is('archived_at', null)
      .maybeSingle(),
    supabase.from('event_signups').select('id').eq('calendar_entry_id', entryId).maybeSingle(),
    loadAttendance(entryId),
    loadCandidates(entryId)
  ]);

  const row = entry as unknown as CalendarEntryRow;
  const rule = creditRuleFor(categories as Parameters<typeof creditRuleFor>[0], row.category);

  // The agenda editor renders inside its tab (Patrick, 2026-08-24), so its
  // sessions and the engine's suggestions load here when the layer exists.
  // Same for the signup builder — the Signup tab shows the builder itself
  // once a signup exists; before that, the tab offers to enable one.
  const [agenda, builder] = await Promise.all([
    meeting ? loadAgendaEditorData(meeting.id as number, row.entry_date, meeting.title as string) : null,
    signup ? loadBuilderData(signup.id as number) : null
  ]);
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
      agenda={
        meeting && agenda
          ? {
              meeting: meeting as Meeting,
              sessions: agenda.sessions,
              candidates: agenda.candidates,
              onUpdateMeeting: updateMeeting,
              onSetStatus: setMeetingStatus,
              onCreateSession: createSession,
              onUpdateSession: updateSession,
              onDeleteSession: deleteSession,
              onMoveSession: moveSession,
              onPromote: promotePlanSession,
              onDeleteMeeting: deleteMeeting
            }
          : null
      }
      signupId={signup ? (signup.id as number) : null}
      builder={builder}
      attendanceCount={attendance.length}
      rollCall={{
        creditKind: rule.creditKind,
        creditUnit: rule.creditUnit,
        countsAsActivity: rule.countsAsActivity,
        defaultQty: defaultQtyFor(rule.creditKind, row.entry_date, row.end_date ?? null),
        hasSignup: signup !== null,
        candidates,
        attendance,
        onMark: markAttended,
        onUnmark: markAbsent,
        onSetQty: setAttendanceQty,
        onSeed: seedFromSignup
      }}
      initialTab={initialTab}
      onSaveStory={updateEntryStory}
      onCreateEntry={createCalendarEntry}
      onAddAgenda={createMeeting}
    />
  );
}
