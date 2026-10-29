import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MatchedCandidate } from '../src/app/admin/(workspace)/advancement/meetings/[id]/meeting-editor';

/**
 * Meeting board, Phase 3a, the screens: the meeting editor's tray (matched sessions promote through onPromote, nothing
 * else) and the member page's "You're in First aid, your #2". Admin's This Sunday and its board settings retired in P5c.
 * Server actions are the mock boundary.
 */
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: nav.refresh, push: vi.fn() }) }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/advancement-catalog', () => ({ loadAdvancementCatalog: async () => ({}) }));
vi.mock('../src/app/(public)/member/meeting/actions', () => ({
  meetingAddPickAction: vi.fn(),
  meetingRemovePickAction: vi.fn(),
  meetingSetOrderAction: vi.fn(),
  meetingSetNoteAction: vi.fn(),
  meetingSetIntentAction: vi.fn()
}));

const { MeetingEditor } = await import('../src/app/admin/(workspace)/advancement/meetings/[id]/meeting-editor');
const { PlanNotice } = await import('../src/app/(public)/member/meeting/plan-notice');

beforeEach(() => {
  nav.refresh.mockReset();
});

const matched: MatchedCandidate = {
  id: '40:tenderfoot-4a',
  blockLabel: 'Block 1',
  title: 'First Aid',
  codeLabel: 'Tenderfoot 4a, 4b',
  group: null,
  teachers: ['Mr. Vest'],
  flags: ['sign-off needs a counselor'],
  scouts: ['Anjali S', 'Finn P'],
  promote: {
    title: 'First Aid',
    description: 'Tenderfoot 4a, 4b · Block 1',
    track: 'Open Advancement',
    leaderName: 'Mr. Vest',
    skillId: 'first-aid',
    requirements: [
      { code: 'Tenderfoot 4a', label: 'First aid' },
      { code: 'Tenderfoot 4b', label: 'Bites' }
    ],
    scouts: ['Anjali S', 'Finn P']
  }
};
const ok = async () => ({ ok: true });
function editor(board: Parameters<typeof MeetingEditor>[0]['board'], onPromote = vi.fn(ok), sessions: Parameters<typeof MeetingEditor>[0]['sessions'] = []) {
  render(
    <MeetingEditor
      meeting={{ id: 9, status: 'draft', title: 'Troop Meeting' } as Parameters<typeof MeetingEditor>[0]['meeting']}
      board={board}
      entry={{ id: 5, entry_date: '2026-11-01' }}
      sessions={sessions}
      onUpdateMeeting={vi.fn(ok)}
      onSetStatus={vi.fn(ok)}
      onCreateSession={vi.fn(ok)}
      onUpdateSession={vi.fn(ok)}
      onDeleteSession={vi.fn(ok)}
      onMoveSession={vi.fn(ok)}
      onPromote={onPromote}
      onDeleteMeeting={vi.fn(ok)}
    />
  );
  return onPromote;
}

describe('the meeting editor tray', () => {
  it('Tray_ShowsMatchedSessions_PrefilledFromTheBoard', () => {
    editor({ closed: false, sessions: [matched], wanted: 1 });
    expect([screen.getByText('Block 1 · Tenderfoot 4a, 4b') != null, screen.getByText(/Teacher: Mr\. Vest · sign-off needs a counselor/) != null, screen.getByText(/2 scouts: Anjali S, Finn P/) != null]).toEqual([true, true, true]);
  });

  it('Tray_SessionWithTwoTeachers_SaysTeachers', () => {
    editor({ closed: false, sessions: [{ ...matched, teachers: ['Mr. Vest', 'Ms. Ruiz'] }], wanted: 0 });
    expect(screen.getByText(/Teachers: Mr\. Vest and Ms\. Ruiz/)).toBeTruthy();
  });

  it('Tray_SessionWithNoTeacher_SaysNoTeachersYet', () => {
    editor({ closed: false, sessions: [{ ...matched, teachers: [] }], wanted: 0 });
    expect(screen.getByText(/No teachers yet/)).toBeTruthy();
  });

  it('Leader_PromotesMatchedSession_ThroughTheExistingFlow', async () => {
    const onPromote = editor({ closed: false, sessions: [matched], wanted: 0 });
    await userEvent.click(screen.getAllByRole('button', { name: 'Add to agenda' })[0]);
    expect([onPromote.mock.calls, await screen.findByText('Added ✓')]).toEqual([[[{ meetingId: 9, ...matched.promote }]], expect.anything()]);
  });

  it('Tray_MarksASessionAlreadyOnTheAgenda_AsAdded', () => {
    const onAgenda = { id: 1, meeting_id: 9, section: 'agenda', sort_order: 10, title: 'First Aid', description: 'Tenderfoot 4a, 4b · Block 1' } as Parameters<typeof MeetingEditor>[0]['sessions'][number];
    editor({ closed: false, sessions: [matched], wanted: 0 }, vi.fn(ok), [onAgenda]);
    expect([screen.getByText('Added ✓') != null, screen.getByRole('button', { name: 'Add again' }) != null]).toEqual([true, true]);
  });

  it('Tray_SaysSo_WhenTheMeetingIsClosed', () => {
    editor({ closed: true, sessions: [], wanted: 0 });
    expect(screen.getByText('This meeting has no board. Build the agenda by hand.')).toBeTruthy();
  });

  // Patrick, 2026-10-22 (B7 extra): the agenda tray is the plan only; the engine's own suggestions panel is retired.
  it('Tray_HasNoEngineSuggestionsPanel', () => {
    editor({ closed: false, sessions: [], wanted: 0 });
    expect([screen.queryByText(/Engine suggestions|Plan Suggestions/), screen.getByText('Nothing on the plan yet.') != null]).toEqual([null, true]);
  });

  it('Tray_PlanFailedToLoad_SaysSo', () => {
    editor(null);
    expect(screen.getByText(/The plan didn.t load right now/)).toBeTruthy();
  });
});

describe('the member page', () => {

  it('Member_SeesALinkToTheAgenda_OnceItIsPublished_AndNoPersonalLine', () => {
    render(<PlanNotice planSet pastClose={false} entryId={5} />);
    expect([screen.getByRole('link', { name: 'see the agenda' }).getAttribute('href'), screen.queryByText(/you’re in/i)]).toEqual(['/events/5', null]);
  });

  it('Member_SeesThePlanIsSet_AfterTheSoftClose_WithNoAgendaYet', () => {
    render(<PlanNotice planSet={false} pastClose entryId={5} />);
    expect([screen.getByText('This week’s plan is set. You can still tell us you’re coming.') != null, screen.queryByRole('link')]).toEqual([true, null]);
  });

  it('Member_SeesNoPlanNotice_BeforeTheSoftClose', () => {
    const { container } = render(<PlanNotice planSet={false} pastClose={false} entryId={5} />);
    expect(container.textContent).toBe('');
  });

});
