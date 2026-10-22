import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { attendanceChanges, buildAttendanceReview, meetingIsOver, type AttendanceReview } from '../src/lib/meeting-live-shared';

/**
 * Build a Plan B8 (Plans/Build-A-Plan.md "B8"; D-429), the pure side and the checklist screen: when a meeting is over,
 * the approval checklist pre-filled from Live's draft, and "Record attendance" sending only the differences. A
 * recorded person starts ticked, so removing them takes a deliberate untick. The server side is pinned in
 * tests/meeting-live-b8-db.test.ts.
 */
const m = vi.hoisted(() => ({ record: vi.fn(), refresh: vi.fn() }));
vi.mock('../src/app/(public)/planner/live-actions', () => ({ plannerRecordAttendanceAction: m.record }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }));

const { AttendancePrompt } = await import('../src/app/(public)/planner/attendance-review');

const NAMES: Record<number, string> = { 1: 'Ann A', 2: 'Bo B', 3: 'Cy C', 4: 'Dee D', 5: 'Eve E', 6: 'Fay F', 7: 'Gus G' };
const nameOf = (id: number) => NAMES[id] ?? `#${id}`;
const draftReview = (o: Partial<Parameters<typeof buildAttendanceReview>[0]> = {}): AttendanceReview =>
  buildAttendanceReview({
    entryId: 9,
    date: '2026-10-18',
    placed: [1, 2],
    teachers: [3],
    visitors: [4],
    draft: new Map([
      [2, false],
      [5, true],
      [4, true]
    ]),
    recorded: new Set<number>(),
    nameOf,
    ...o
  });
const ticks = (r: AttendanceReview) =>
  Object.fromEntries(r.groups.map((g) => [g.key, g.people.filter((p) => p.ticked).map((p) => p.personId)]));

afterEach(() => {
  cleanup();
  m.record.mockReset();
  m.refresh.mockReset();
});

describe('when the meeting is over', () => {
  it('MeetingIsOver_TheDayAfter', () => {
    expect(meetingIsOver({ date: '2026-10-18' }, { date: '2026-10-19', time: '00:01' })).toBe(true);
  });

  it('MeetingIsOver_NotOnTheDay_WithoutAnEndTime', () => {
    expect(meetingIsOver({ date: '2026-10-18' }, { date: '2026-10-18', time: '23:59' })).toBe(false);
  });

  it('MeetingIsOver_OnTheDay_AfterTheEndTime', () => {
    expect(meetingIsOver({ date: '2026-10-18', endTime: '20:30:00' }, { date: '2026-10-18', time: '20:30' })).toBe(true);
  });

  it('MeetingIsOver_NotBeforeTheEndTime', () => {
    expect(meetingIsOver({ date: '2026-10-18', endTime: '20:30:00' }, { date: '2026-10-18', time: '20:29' })).toBe(false);
  });

  it('MeetingIsOver_AMultiDayEntry_RunsToItsLastDay', () => {
    expect(meetingIsOver({ date: '2026-10-18', endDate: '2026-10-19' }, { date: '2026-10-19', time: '12:00' })).toBe(false);
  });
});

describe('the checklist', () => {
  it('UpdateAttendance_PrefillsFromDraft', () => {
    // Placed, teaching and visitors are ticked unless marked not here (Bo); a "here" tap in no class (Eve) is ticked.
    expect(ticks(draftReview())).toEqual({ class: [1], teaching: [3], visitor: [4], here: [5] });
  });

  it('UpdateAttendance_OldCodeMeeting_NoDraftRow_StartsUnticked', () => {
    // attendance_seeded_at set: the old "Mark not present" deleted attendance and left no draft row (B8 qa).
    expect(ticks(draftReview({ seededByOldCode: true }))).toEqual({ class: [], teaching: [], visitor: [4], here: [5] });
  });

  it('UpdateAttendance_OldCodeMeeting_RecordedStillStartsTicked', () => {
    expect(ticks(draftReview({ seededByOldCode: true, recorded: new Set([1]) })).class).toEqual([1]);
  });

  it('UpdateAttendance_GroupsEachPersonOnce', () => {
    const r = draftReview({ placed: [1, 3], teachers: [3], recorded: new Set([1, 7]) });
    expect(r.groups.map((g) => [g.key, g.people.map((p) => p.personId)])).toEqual([
      ['class', [1]],
      ['teaching', [3]],
      ['visitor', [4]],
      ['here', [5]],
      ['recorded', [7]]
    ]);
  });

  it('UpdateAttendance_RecordedStartsTicked_EvenIfMarkedNotHere', () => {
    const r = draftReview({ recorded: new Set([2]) });
    expect(r.groups.flatMap((g) => g.people).find((p) => p.personId === 2)?.ticked).toBe(true);
  });

  it('AttendanceChanges_AddsTheTickedAndRemovesOnlyRecordedUnticks', () => {
    const r = draftReview({ recorded: new Set([1, 3]) });
    expect(attendanceChanges(r, new Set([1, 4, 5]))).toEqual({ add: [4, 5], remove: [3] });
  });
});

describe('the prompt and its checklist', () => {
  const open = (r: AttendanceReview) => {
    render(<AttendancePrompt review={r} label="Sun, Oct 18" />);
    fireEvent.click(screen.getByRole('button', { name: 'Update attendance' }));
    return screen.getByRole('dialog');
  };

  it('Prompt_AsksWhenThereIsSomethingToRecord', () => {
    render(<AttendancePrompt review={draftReview()} label="Sun, Oct 18" />);
    expect(screen.getByText('Would you like to update attendance for Sun, Oct 18?')).toBeTruthy();
  });

  it('Prompt_IsQuiet_WhenEverythingIsRecorded', () => {
    render(<AttendancePrompt review={draftReview({ recorded: new Set([1, 3, 4, 5]) })} label="Sun, Oct 18" />);
    expect(screen.getByText('Attendance for Sun, Oct 18 is recorded.')).toBeTruthy();
  });

  it('Checklist_CountsEveryAddAsAChange', () => {
    const dlg = open(draftReview());
    expect(within(dlg).getByRole('button', { name: 'Record 4 changes' })).toBeTruthy();
  });

  it('Checklist_MarksWhoIsAlreadyRecorded', () => {
    const dlg = open(draftReview({ recorded: new Set([1]) }));
    expect(within(dlg).getByRole('checkbox', { name: /Ann A/ }).closest('label')?.textContent).toBe('Ann Arecorded');
  });

  it('UpdateAttendance_SendsOnlyTheChanges', async () => {
    m.record.mockResolvedValue({ ok: true, added: 3, removed: 0, failed: 0 });
    const dlg = open(draftReview({ recorded: new Set([1]) }));
    fireEvent.click(within(dlg).getByRole('button', { name: 'Record 3 changes' }));
    await waitFor(() => expect(m.record).toHaveBeenCalledWith({ entryId: 9, add: [3, 4, 5], remove: [] }));
  });

  it('UpdateAttendance_ADeliberateUntick_Removes', async () => {
    m.record.mockResolvedValue({ ok: true, added: 0, removed: 1, failed: 0 });
    const dlg = open(draftReview({ recorded: new Set([1, 3, 4]) }));
    fireEvent.click(within(dlg).getByRole('checkbox', { name: /Ann A/ }));
    fireEvent.click(within(dlg).getByRole('button', { name: /^Record \d+ change/ }));
    await waitFor(() => expect(m.record).toHaveBeenCalledWith({ entryId: 9, add: [5], remove: [1] }));
  });

  it('Checklist_CountsTheChanges_NotTheTicks', () => {
    // Ann is recorded and stays ticked; Cy, Dee and Eve are added: three changes, four ticks.
    const dlg = open(draftReview({ recorded: new Set([1]) }));
    expect(within(dlg).getByRole('button', { name: 'Record 3 changes' })).toBeTruthy();
  });

  it('Checklist_OneChange_IsSingular', () => {
    const dlg = open(draftReview({ recorded: new Set([1, 3, 4]) }));
    expect(within(dlg).getByRole('button', { name: 'Record 1 change' })).toBeTruthy();
  });

  it('Recorded_StatusSurvivesTheRefresh', async () => {
    m.record.mockResolvedValue({ ok: true, added: 4, removed: 0, failed: 0 });
    const { rerender } = render(<AttendancePrompt key={9} review={draftReview()} label="Sun, Oct 18" />);
    fireEvent.click(screen.getByRole('button', { name: 'Update attendance' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Record 4 changes' }));
    await waitFor(() => expect(m.refresh).toHaveBeenCalled());
    rerender(<AttendancePrompt key={9} review={draftReview({ recorded: new Set([1, 3, 4, 5]) })} label="Sun, Oct 18" />);
    expect(screen.getByRole('status').textContent).toBe('Attendance recorded for Sun, Oct 18.');
  });

  it('Checklist_NothingToChange_IsGreyedAndSaysRecorded', () => {
    render(<AttendancePrompt review={draftReview({ recorded: new Set([1, 3, 4, 5]) })} label="Sun, Oct 18" />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect((within(screen.getByRole('dialog')).getByRole('button', { name: 'Attendance recorded' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Checklist_Refused_SaysWhyInPlace', async () => {
    m.record.mockResolvedValue({ ok: false, error: 'Only someone who can edit the Meeting Planner can do that.' });
    const dlg = open(draftReview());
    fireEvent.click(within(dlg).getByRole('button', { name: 'Record 4 changes' }));
    expect((await within(dlg).findByRole('alert')).textContent).toBe('Only someone who can edit the Meeting Planner can do that.');
  });
});
