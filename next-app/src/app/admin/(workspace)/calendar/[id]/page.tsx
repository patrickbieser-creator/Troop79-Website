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
 *
 * LOADS PER TAB (2026-08-25, Patrick: "overloaded … much slower on prod"):
 * the entry, its categories, the meeting and signup rows and the attendance
 * count are always read (cheap, they drive the tab strip); everything else —
 * the agenda editor's sessions and candidates, the roll-call sheet, the
 * signup builder, a roster / money / snapshot / assignments view — loads only
 * for the tab (and `?view=`) that is actually open.
 */

import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';
import { loadCalendarCategories } from '@/lib/calendar';
import { categoryColorMap, colorFor, templateOf } from '@/lib/calendar-categories';
import { creditRuleFor, defaultQtyFor, loadAttendance, loadCandidates } from '@/lib/attendance';
import { parseRosterOrder } from '@/lib/event-snapshot';
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
import { enableSignup } from '../../events/actions';
import { loadEventNav, type EventNavData } from '../../rosters/[id]/event-nav-data';
import type { EventNavKey } from '../../rosters/[id]/event-nav';
import { loadRoster, RosterView, type RosterData } from '../../rosters/[id]/roster-view';
import { MoneyView } from '../../rosters/[id]/money/money-view';
import { SnapshotView } from '../../rosters/[id]/snapshot/snapshot-view';
import { activeSetFor, AssignmentsView, loadAssignments } from '../../rosters/[id]/assignments/assignments-view';
import type { Meeting } from '@/lib/supabase/types';
import { updateCalendarEntry, createCalendarEntry } from '../actions';
import { markAttended, markAbsent, setAttendanceQty, seedFromSignup } from './roll-call/actions';
import type { CalendarEntryRow } from '../entry-form';
import { Workbench, type WorkbenchEntry, type WorkbenchTab } from './workbench';

export const metadata = { title: 'Calendar Entry — Troop 79' };

const TABS: WorkbenchTab[] = ['entry', 'agenda', 'roll-call', 'signup'];
/** Older links and bookmarks: Details and Story are both the Entry tab now. */
const LEGACY_TABS: Record<string, WorkbenchTab> = { details: 'entry', story: 'entry' };
type SignupViewName = 'roster' | 'assignments' | 'money' | 'snapshot';
const VIEWS: SignupViewName[] = ['roster', 'assignments', 'money', 'snapshot'];

export default async function CalendarEntryPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; view?: string; set?: string; order?: string }>;
}) {
  await requireCapability('calendar.write');
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const entryId = Number(id);
  if (!Number.isInteger(entryId) || entryId <= 0) notFound();
  const tab: WorkbenchTab = TABS.find((t) => t === sp.tab) ?? (sp.tab ? LEGACY_TABS[sp.tab] : undefined) ?? 'entry';
  const view = VIEWS.find((v) => v === sp.view) ?? null;

  const supabase = createAdminClient();
  // Entry+categories and meeting/signup/count used to be two serial
  // Promise.all phases — nothing in the second phase reads anything from the
  // first (all five key off entryId or nothing at all), so one round trip
  // covers what the tab strip needs, always: the full entry (plus the
  // promotion hero — the Entry panel is the full entry editor, not a
  // summary), which layers exist, and how many were present (the Roll Call
  // count pill) (Plans/Performance-Review-2026-08-27.md #7).
  const [{ data: entry }, categories, { data: meeting }, { data: signup }, { count: attendanceCount }] = await Promise.all([
    supabase
      .from('calendar_entries')
      .select('*, hero_media:hero_media_id(*)')
      .eq('id', entryId)
      .maybeSingle(),
    loadCalendarCategories(),
    supabase
      .from('meetings')
      .select('*')
      .eq('calendar_entry_id', entryId)
      .is('archived_at', null)
      .maybeSingle(),
    supabase.from('event_signups').select('id').eq('calendar_entry_id', entryId).maybeSingle(),
    supabase.from('event_attendance').select('id', { count: 'exact', head: true }).eq('calendar_entry_id', entryId)
  ]);
  if (!entry) notFound();

  const row = entry as unknown as CalendarEntryRow;
  const template = templateOf(categories, row.category);
  const rule = creditRuleFor(categories as Parameters<typeof creditRuleFor>[0], row.category);
  const signupId = signup ? (signup.id as number) : null;

  // ── the active tab's own data ──
  const agenda =
    tab === 'agenda' && meeting
      ? await loadAgendaEditorData(meeting.id as number, row.entry_date, meeting.title as string)
      : null;

  const [attendance, candidates] =
    tab === 'roll-call' ? await Promise.all([loadAttendance(entryId), loadCandidates(entryId)]) : [null, null];

  let builder: Awaited<ReturnType<typeof loadBuilderData>> = null;
  let signupNav: EventNavData | null = null;
  let signupView: { key: EventNavKey; node: React.ReactNode } | null = null;
  if (tab === 'signup' && signupId) {
    if (!view) {
      builder = await loadBuilderData(signupId);
      signupNav = builder?.nav ?? null;
    } else {
      const base = `/admin/calendar/${entryId}?tab=signup`;
      // loadRoster/loadAssignments already compute the same nav internally
      // (loadEventNav) and return it — a separate await for signupNav before
      // them was a wholly redundant extra round trip, serial with the load
      // it duplicated. Money and Snapshot don't load nav-bearing data of
      // their own, so they still fetch it directly (item 7).
      if (view === 'roster') {
        const data = await loadRoster(signupId);
        signupNav = data?.nav ?? null;
        if (data && data.entry) signupView = { key: 'roster', node: <RosterView data={data as RosterData} signupId={signupId} /> };
      } else if (view === 'money') {
        signupNav = await loadEventNav(supabase, signupId, entryId);
        signupView = { key: 'money', node: <MoneyView signupId={signupId} calendarEntryId={entryId} /> };
      } else if (view === 'snapshot') {
        signupNav = await loadEventNav(supabase, signupId, entryId);
        const order = parseRosterOrder(sp.order);
        signupView = {
          key: 'snapshot',
          node: (
            <SnapshotView
              signupId={signupId}
              order={order}
              orderHref={(o) => `${base}&view=snapshot${o === 'patrol' ? '' : `&order=${o}`}`}
            />
          )
        };
      } else if (view === 'assignments') {
        const data = await loadAssignments(signupId);
        signupNav = data?.nav ?? null;
        if (data && data.entry) {
          const activeSetId = activeSetFor(data, Number(sp.set));
          signupView = {
            key: activeSetId != null ? `set:${activeSetId}` : 'assignments',
            node: <AssignmentsView data={data} signupId={signupId} activeSetId={activeSetId} />
          };
        }
      }
    }
  }

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
      // The full row feeds the Entry panel's form, which is the same
      // component the list's "+ Add Entry" dialog uses.
      row={{ ...row, hasAgenda: false }}
      categories={categories}
      onSaveDetails={updateCalendarEntry}
      template={template}
      tab={tab}
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
      signupId={signupId}
      builder={builder}
      signupNav={signupNav}
      signupView={signupView}
      attendanceCount={attendanceCount ?? 0}
      rollCall={
        attendance && candidates
          ? {
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
            }
          : null
      }
      onCreateEntry={createCalendarEntry}
      onAddAgenda={createMeeting}
      onEnableSignup={enableSignup}
    />
  );
}
