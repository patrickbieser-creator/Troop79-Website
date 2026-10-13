import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DirtyGuardProvider, useRegisterDirty } from '../src/app/admin/(workspace)/_components/dirty-guard';
import { Workbench, type WorkbenchEntry } from '../src/app/admin/(workspace)/calendar/[id]/workbench';
import type { CalendarEntryRow } from '../src/app/admin/(workspace)/calendar/entry-form';

/**
 * Calendar entry workbench tabs (Patrick, 2026-08-24: "introduce that same tab
 * format we have used elsewhere where details are one tab, story is another
 * tab, agenda is another tab, roll call is another, and sign up is another. So
 * at the top of the form it's evident what options are available").
 *
 * The heavy editors are stubbed — this file tests the tab shell: which tabs
 * exist for which template, which panel shows, and that a tab click is a
 * (guarded) URL navigation — since 2026-08-25 the page loads only the active
 * tab's data and only that panel renders (Patrick: "overloaded … slower").
 */
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push })
}));
vi.mock('../src/app/admin/(workspace)/_components/markdown-split-pane', () => ({
  MarkdownSplitPane: ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => (
    <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  )
}));
vi.mock('../src/app/admin/(workspace)/_components/markdown-block-tools', () => ({
  useMarkdownBlockTools: () => ({ toolbar: null, onEditBlock: vi.fn(), prompts: null, pickers: null })
}));
vi.mock('../src/app/admin/(workspace)/calendar/entry-form', () => ({
  CalendarEntryForm: () => <form aria-label="Entry details form" />
}));
vi.mock('../src/app/admin/(workspace)/events/[id]/builder-panels', () => ({
  BuilderPanels: ({ signupId }: { signupId: number }) => <div aria-label="Signup builder">builder for signup {signupId}</div>
}));
vi.mock('../src/app/admin/(workspace)/advancement/meetings/[id]/meeting-editor', () => ({
  MeetingEditor: ({ embedded }: { embedded?: boolean }) => (
    <div aria-label="Agenda editor">{embedded ? 'embedded agenda editor' : 'standalone'}</div>
  )
}));

const entry: WorkbenchEntry = {
  id: 109,
  title: 'PLC Meeting',
  entry_date: '2026-08-30',
  end_date: null,
  category: 'Leadership / Planning',
  categoryColor: '#4c5c6a',
  location: null,
  description: null,
  details_md: '',
  on_calendar: true,
  show_on_homepage: false
};

function renderWorkbench(over: Partial<React.ComponentProps<typeof Workbench>> = {}) {
  return render(
    <Workbench
      entry={entry}
      row={{ id: 109 } as unknown as CalendarEntryRow}
      categories={[]}
      onSaveDetails={vi.fn()}
      onCreateEntry={vi.fn()}
      template="meeting"
      meeting={null}
      agenda={null}
      signupId={null}
      builder={null}
      attendanceCount={0}
      tab="entry"
      signupNav={null}
      signupView={null}
      rollCall={null}
      onAddAgenda={vi.fn()}
      {...over}
    />
  );
}

const ROLL_CALL = {
  creditKind: null,
  creditUnit: null,
  countsAsActivity: false,
  defaultQty: 1,
  hasSignup: false,
  candidates: [{ personId: 1, displayName: 'Avery Scout', scoutId: 's1', tab: 'active_scout', signedUp: false }],
  attendance: [],
  onMark: vi.fn(),
  onUnmark: vi.fn(),
  onSetQty: vi.fn(),
  onSeed: vi.fn()
} as never;

/** The LAYER tabs only — the Roll Call sheet nests its own Scouts/Adults strip. */
function tabNames(): string[] {
  return within(screen.getByRole('tablist', { name: 'Entry layers' }))
    .getAllByRole('tab')
    .map((t) => t.textContent ?? '');
}

const ALL_TABS = ['Entry', 'Agenda', 'Signup', 'Roster', 'Assignments', 'Money', 'Snapshot', 'Roll Call'];
const SETS = [
  { id: 31, label: 'Patrols' },
  { id: 32, label: 'Cars there' }
];
const WITH_SIGNUP = {
  signupId: 8,
  signupNav: { entryId: 109, sets: SETS, hasMoney: true }
};

function tabByName(name: string | RegExp) {
  return within(screen.getByRole('tablist', { name: 'Entry layers' })).getByRole('tab', { name });
}

/** The tabs a leader sees greyed. */
function inactiveTabs(): string[] {
  return within(screen.getByRole('tablist', { name: 'Entry layers' }))
    .getAllByRole('tab')
    .filter((t) => t.getAttribute('aria-disabled') === 'true')
    .map((t) => t.textContent ?? '');
}

describe('Calendar entry workbench — one flat bar', () => {
  it('CalendarWorkbench_ShowsOneBar_InOrder_WithASignupAndTwoSets', () => {
    renderWorkbench({ ...WITH_SIGNUP });
    expect(tabNames()).toEqual(['Entry', 'Agenda', 'Signup', 'Roster', 'Patrols', 'Cars there', 'Money', 'Snapshot', 'Roll Call']);
    expect(inactiveTabs()).toEqual([]);
  });

  it('CalendarWorkbench_ShowsEveryTab_WhenTheEntryHasNoSignup', () => {
    renderWorkbench();
    expect(tabNames()).toEqual(ALL_TABS);
  });

  it('CalendarWorkbench_GreysRosterAssignmentsMoneySnapshot_WhenTheEntryHasNoSignup', () => {
    renderWorkbench();
    expect(inactiveTabs()).toEqual(['Roster', 'Assignments', 'Money', 'Snapshot']);
  });

  it.each(['Signup', 'Roll Call'])('CalendarWorkbench_KeepsTheTabEnabled_WithNoSignup_%s', (name) => {
    renderWorkbench();
    expect(tabByName(new RegExp(name)).getAttribute('aria-disabled')).toBeNull();
  });

  it('CalendarWorkbench_LightsTheFirstSetTab_ForViewAssignmentsWithNoSetParam', () => {
    // The page resolves a missing &set= to the first set (activeSetFor); a bare 'assignments' key with sets present maps the same way.
    renderWorkbench({
      tab: 'signup',
      ...WITH_SIGNUP,
      signupView: { key: 'assignments', node: <div aria-label="Board" /> }
    });
    expect(tabByName('Patrols').getAttribute('aria-selected')).toBe('true');
  });

  it('CalendarWorkbench_RoutesAnEnabledTab_ThroughTheDirtyFormGuard', async () => {
    const user = userEvent.setup();
    push.mockClear();
    function Dirty() {
      useRegisterDirty(true);
      return null;
    }
    render(
      <DirtyGuardProvider>
        <Dirty />
        <Workbench
          entry={entry}
          row={{ id: 109 } as unknown as CalendarEntryRow}
          categories={[]}
          onSaveDetails={vi.fn()}
          onCreateEntry={vi.fn()}
          template="meeting"
          meeting={null}
          agenda={null}
          signupId={null}
          builder={null}
          attendanceCount={0}
          tab="entry"
          signupNav={null}
          signupView={null}
          rollCall={null}
        />
      </DirtyGuardProvider>
    );
    await user.click(tabByName('Signup'));
    expect(push).not.toHaveBeenCalled();
  });

  it('CalendarWorkbench_GreysAgenda_WhenTheTemplateIsNotAMeeting', () => {
    renderWorkbench({ template: 'activity', ...WITH_SIGNUP });
    expect(inactiveTabs()).toEqual(['Agenda']);
  });

  it('CalendarWorkbench_GreysMoney_WhenTheEntryHasNoMoneyActivity', () => {
    renderWorkbench({ ...WITH_SIGNUP, signupNav: { entryId: 109, sets: SETS, hasMoney: false } });
    expect(inactiveTabs()).toEqual(['Money']);
  });

  it('CalendarWorkbench_KeepsMoneyEnabled_WhileTheMoneyViewIsOpen', () => {
    renderWorkbench({
      tab: 'signup',
      ...WITH_SIGNUP,
      signupNav: { entryId: 109, sets: SETS, hasMoney: false },
      signupView: { key: 'money', node: <div aria-label="Money view" /> }
    });
    expect(inactiveTabs()).toEqual([]);
    expect(tabByName('Money').getAttribute('aria-selected')).toBe('true');
  });

  it('CalendarWorkbench_ShowsOneGreyedAssignments_WhenTheSignupHasNoSets', () => {
    renderWorkbench({ ...WITH_SIGNUP, signupNav: { entryId: 109, sets: [], hasMoney: true } });
    expect(tabNames()).toEqual(ALL_TABS);
    expect(inactiveTabs()).toEqual(['Assignments']);
  });

  it('CalendarWorkbench_ExplainsAnInactiveTab_WhenClicked', async () => {
    const user = userEvent.setup();
    renderWorkbench();
    await user.click(tabByName('Roster'));
    expect(screen.getByRole('status').textContent).toBe('Not active for this event');
  });

  it('CalendarWorkbench_DoesNotNavigate_WhenAnInactiveTabIsClicked', async () => {
    const user = userEvent.setup();
    push.mockClear();
    renderWorkbench();
    await user.click(tabByName('Roster'));
    expect(push).not.toHaveBeenCalled();
  });

  it('CalendarWorkbench_MarksTheRosterTabActive_ForTheOldSignupViewRosterUrl', () => {
    renderWorkbench({
      tab: 'signup',
      ...WITH_SIGNUP,
      signupView: { key: 'roster', node: <div aria-label="Roster view">roster for 8</div> }
    });
    expect(tabByName('Roster').getAttribute('aria-selected')).toBe('true');
    expect(tabByName('Signup').getAttribute('aria-selected')).toBe('false');
  });

  it('CalendarWorkbench_MarksTheSetTabActive_ForTheOldAssignmentsSetUrl', () => {
    renderWorkbench({
      tab: 'signup',
      ...WITH_SIGNUP,
      signupView: { key: 'set:32', node: <div aria-label="Board" /> }
    });
    expect(tabByName('Cars there').getAttribute('aria-selected')).toBe('true');
  });

  it('CalendarWorkbench_NavigatesToTheOldViewUrls_FromTheFlatTabs', async () => {
    const user = userEvent.setup();
    push.mockClear();
    renderWorkbench({ ...WITH_SIGNUP });
    await user.click(tabByName('Roster'));
    await user.click(tabByName('Cars there'));
    await user.click(tabByName('Money'));
    await user.click(tabByName('Snapshot'));
    await user.click(tabByName('Signup'));
    expect(push.mock.calls.map((c) => c[0])).toEqual([
      '/admin/calendar/109?tab=signup&view=roster',
      '/admin/calendar/109?tab=signup&view=assignments&set=32',
      '/admin/calendar/109?tab=signup&view=money',
      '/admin/calendar/109?tab=signup&view=snapshot',
      '/admin/calendar/109?tab=signup'
    ]);
  });
});

describe('Calendar entry workbench — one tab per layer', () => {
  // Details + Story became ONE Entry tab (Patrick, 2026-08-25: "consolidate
  // Details and story" on the news editor's pattern) — the form itself is
  // covered in calendar-entry-form.test.tsx.
  it('MeetingTemplate_OffersEntryAgendaSignupRollCall_InThatOrder', () => {
    renderWorkbench();
    expect(tabNames()).toEqual(ALL_TABS);
  });

  it('ActivityTemplate_KeepsTheAgendaTab_GreyedOut', () => {
    renderWorkbench({ template: 'activity' });
    expect(tabNames()).toContain('Agenda');
    expect(tabByName('Agenda').getAttribute('aria-disabled')).toBe('true');
  });

  it('EntryTab_IsSelected_ByDefault', () => {
    renderWorkbench();
    expect(tabByName('Entry').getAttribute('aria-selected')).toBe('true');
  });

  it('EntryTab_RendersTheEntryForm', () => {
    renderWorkbench();
    expect(screen.getByRole('form', { name: 'Entry details form' })).toBeTruthy();
  });

  // Other tabs' panels are not in the DOM at all — their data was never loaded.
  it.each(['Roll Call', 'Signup'])('EntryTab_DoesNotMountThePanel_%s', (name) => {
    renderWorkbench();
    expect(document.querySelector(`section[aria-label="${name}"]`)).toBeNull();
  });

  it('TabClick_IsAUrlNavigation_ToThatTab', async () => {
    const user = userEvent.setup();
    push.mockClear();
    renderWorkbench();
    await user.click(screen.getByRole('tab', { name: 'Agenda' }));
    expect(push).toHaveBeenCalledWith('/admin/calendar/109?tab=agenda');
  });

  it('RollCallTab_CarriesTheAttendanceCount_WhenRollWasTaken', () => {
    renderWorkbench({ attendanceCount: 14 });
    expect(screen.getByRole('tab', { name: /Roll Call/ }).textContent).toContain('14');
  });

  it('RollCallTab_ShowsTheSheetItself_WithItsOwnSubTabs', () => {
    renderWorkbench({ tab: 'roll-call', rollCall: ROLL_CALL });
    const panel = within(screen.getByRole('tabpanel', { name: 'Roll Call' }));
    expect(panel.getByRole('tablist', { name: 'Who to take roll for' })).toBeTruthy(); // the sub-tab bar
    expect(panel.getByLabelText(/Avery Scout/)).toBeTruthy(); // a checkbox, no "Take Roll Call" button first
    expect(screen.queryByRole('link', { name: 'Take Roll Call' })).toBeNull();
    expect(tabNames()).toEqual(ALL_TABS); // layer tabs still there
  });

  // Enabling happens HERE (2026-08-25: the Calendar is the hub) — a button
  // that runs the action for this entry, not a link out to the signups list.
  it('SignupTab_RunsTheEnableAction_ForThisEntry_WhenEnableIsClicked', async () => {
    const user = userEvent.setup();
    const onEnableSignup = vi.fn(async () => ({ ok: true }));
    renderWorkbench({ tab: 'signup', onEnableSignup });
    await user.click(screen.getByRole('button', { name: 'Enable a signup' }));
    expect(onEnableSignup).toHaveBeenCalledWith(109);
  });

  it('SignupTab_OffersEnableAsAButtonNotALink_WhenThereIsNoSignup', () => {
    renderWorkbench({ tab: 'signup' });
    expect(screen.queryByRole('link', { name: 'Enable a signup' })).toBeNull();
  });

  it('SignupTab_ShowsNoBuilder_WhenThereIsNoSignup', () => {
    renderWorkbench({ tab: 'signup' });
    expect(screen.queryByLabelText('Signup builder')).toBeNull();
  });

  const WITH_BUILDER = {
    tab: 'signup' as const,
    signupId: 8,
    signupNav: { entryId: 109, sets: [], hasMoney: false },
    builder: {
      nav: { entryId: 109, sets: [], hasMoney: false },
      signup: { id: 8 },
      entry: { id: 109 },
      prices: [],
      slots: [],
      questions: [],
      sets: []
    } as never
  };

  it('SignupTab_ShowsTheBuilder_WhenThereIsASignup', () => {
    renderWorkbench(WITH_BUILDER);
    expect(screen.getByLabelText('Signup builder').textContent).toBe('builder for signup 8');
  });

  it('SignupTab_HasNoSecondLevelNav_WhenThereIsASignup', () => {
    renderWorkbench(WITH_BUILDER);
    expect(screen.queryByRole('tablist', { name: 'Event pages' })).toBeNull();
  });

  it('SignupTab_HidesEnable_WhenThereIsASignup', () => {
    renderWorkbench(WITH_BUILDER);
    expect(screen.queryByRole('button', { name: 'Enable a signup' })).toBeNull();
  });

  // Patrick, 2026-08-25: Roster / Snapshot used to leave the workbench,
  // "losing the top table" — now the page renders the view under the bar.
  describe('a Roster view', () => {
    const props = {
      tab: 'signup' as const,
      signupId: 8,
      signupNav: { entryId: 109, sets: [], hasMoney: true },
      signupView: { key: 'roster' as const, node: <div aria-label="Roster view">roster for 8</div> }
    };

    it('SignupTab_HostsTheRosterView', () => {
      renderWorkbench(props);
      expect(screen.getByLabelText('Roster view').textContent).toBe('roster for 8');
    });

    it('SignupTab_ShowsNoBuilder_WhileTheRosterViewIsOpen', () => {
      renderWorkbench(props);
      expect(screen.queryByLabelText('Signup builder')).toBeNull();
    });

    it('SignupTab_KeepsTheEntryHead_WhileTheRosterViewIsOpen', () => {
      renderWorkbench(props);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('PLC Meeting');
    });

    it('SignupTab_KeepsTheWholeBar_WhileTheRosterViewIsOpen', () => {
      renderWorkbench(props);
      expect(tabNames()).toEqual(ALL_TABS);
    });
  });

  it('AgendaTab_OffersAddAnAgenda_WhenNoneExists', () => {
    renderWorkbench({ tab: 'agenda' });
    expect(screen.getByRole('button', { name: 'Add an agenda' })).toBeTruthy();
    expect(screen.queryByLabelText('Agenda editor')).toBeNull();
  });

  it('AgendaTab_ShowsTheEditorItself_WhenAnAgendaExists', () => {
    renderWorkbench({
      tab: 'agenda',
      meeting: { id: 3, status: 'draft' },
      agenda: {
        meeting: { id: 3, status: 'draft', title: 'PLC Meeting' } as never,
        sessions: [],
        candidates: null,
        onUpdateMeeting: vi.fn(),
        onSetStatus: vi.fn(),
        onCreateSession: vi.fn(),
        onUpdateSession: vi.fn(),
        onDeleteSession: vi.fn(),
        onMoveSession: vi.fn(),
        onPromote: vi.fn(),
        onDeleteMeeting: vi.fn()
      }
    });
    expect(screen.getByLabelText('Agenda editor').textContent).toBe('embedded agenda editor');
    expect(screen.queryByRole('button', { name: 'Add an agenda' })).toBeNull();
    expect(screen.queryByText(/Take Roll Call/)).toBeNull(); // the link at the bottom is gone
  });
});
