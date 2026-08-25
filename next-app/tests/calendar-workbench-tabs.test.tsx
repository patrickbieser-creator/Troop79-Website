import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Workbench, type WorkbenchEntry } from '../src/app/admin/(workspace)/calendar/[id]/workbench';
import type { CalendarEntryRow } from '../src/app/admin/(workspace)/calendar/entry-form';

/**
 * Calendar entry workbench tabs (Patrick, 2026-08-24: "introduce that same tab
 * format we have used elsewhere where details are one tab, story is another
 * tab, agenda is another tab, roll call is another, and sign up is another. So
 * at the top of the form it's evident what options are available").
 *
 * The heavy editors are stubbed — this file tests the tab shell: which tabs
 * exist for which template, which panel shows, and that switching tabs keeps
 * the other panels (and their drafts) mounted.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
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
vi.mock('../src/app/admin/(workspace)/rosters/[id]/event-nav', () => ({
  EventNav: () => <nav aria-label="Event nav" />
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
      rollCall={{
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
      }}
      onAddAgenda={vi.fn()}
      {...over}
    />
  );
}

/** The LAYER tabs only — the Roll Call sheet nests its own Scouts/Adults strip. */
function tabNames(): string[] {
  return within(screen.getByRole('tablist', { name: 'Entry layers' }))
    .getAllByRole('tab')
    .map((t) => t.textContent ?? '');
}

describe('Calendar entry workbench — one tab per layer', () => {
  // Details + Story became ONE Entry tab (Patrick, 2026-08-25: "consolidate
  // Details and story" on the news editor's pattern) — the form itself is
  // covered in calendar-entry-form.test.tsx.
  it('MeetingTemplate_OffersEntryAgendaRollCallSignup_InThatOrder', () => {
    renderWorkbench();
    expect(tabNames()).toEqual(['Entry', 'Agenda', 'Roll Call', 'Signup']);
  });

  it('ActivityTemplate_HasNoAgendaTab', () => {
    renderWorkbench({ template: 'activity' });
    expect(tabNames()).toEqual(['Entry', 'Roll Call', 'Signup']);
  });

  it('OpensOnEntry_AndOnlyThatPanelIsVisible', () => {
    renderWorkbench();
    expect(screen.getByRole('tab', { name: 'Entry' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Entry' }).hidden).toBe(false);
    expect(screen.getByRole('form', { name: 'Entry details form' })).toBeTruthy();
    // Hidden panels leave the accessibility tree — Testing Library can't find them by role.
    expect(screen.queryByRole('tabpanel', { name: 'Roll Call' })).toBeNull();
    const rollPanel = document.querySelector('section[aria-label="Roll Call"]') as HTMLElement;
    expect(rollPanel.hidden).toBe(true); // still mounted — just hidden
  });

  it('LegacyStoryOrDetailsDeepLink_OpensTheEntryTab', () => {
    // page.tsx maps ?tab=details|story → 'entry'; the workbench only knows 'entry'.
    renderWorkbench({ initialTab: 'entry' });
    expect(screen.getByRole('tab', { name: 'Entry' }).getAttribute('aria-selected')).toBe('true');
  });

  it('RollCallTab_CarriesTheAttendanceCount_WhenRollWasTaken', () => {
    renderWorkbench({ attendanceCount: 14 });
    expect(screen.getByRole('tab', { name: /Roll Call/ }).textContent).toContain('14');
  });

  it('RollCallTab_ShowsTheSheetItself_WithItsOwnSubTabs', async () => {
    const user = userEvent.setup();
    renderWorkbench();
    await user.click(screen.getByRole('tab', { name: 'Roll Call' }));
    const panel = within(screen.getByRole('tabpanel', { name: 'Roll Call' }));
    expect(panel.getByRole('tablist', { name: 'Who to take roll for' })).toBeTruthy(); // the sub-tab bar
    expect(panel.getByLabelText(/Avery Scout/)).toBeTruthy(); // a checkbox, no "Take Roll Call" button first
    expect(screen.queryByRole('link', { name: 'Take Roll Call' })).toBeNull();
    expect(tabNames()).toEqual(['Entry', 'Agenda', 'Roll Call', 'Signup']); // layer tabs still there
  });

  it('SignupTab_OffersToEnable_WhenThereIsNoSignup_AndShowsTheBuilderWhenThereIs', async () => {
    const user = userEvent.setup();
    // Enabling happens HERE (2026-08-25: the Calendar is the hub) — a button
    // that runs the action for this entry, not a link out to the signups list.
    const onEnableSignup = vi.fn(async () => ({ ok: true }));
    const { unmount } = renderWorkbench({ onEnableSignup });
    await user.click(screen.getByRole('tab', { name: 'Signup' }));
    expect(screen.queryByRole('link', { name: 'Enable a signup' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Enable a signup' }));
    expect(onEnableSignup).toHaveBeenCalledWith(109);
    expect(screen.queryByLabelText('Signup builder')).toBeNull();
    unmount();

    renderWorkbench({
      signupId: 8,
      builder: {
        nav: { sets: [], hasMoney: false },
        signup: { id: 8 },
        entry: { id: 109 },
        prices: [],
        slots: [],
        questions: [],
        sets: []
      } as never
    });
    await user.click(screen.getByRole('tab', { name: 'Signup' }));
    expect(screen.getByLabelText('Signup builder').textContent).toBe('builder for signup 8');
    expect(screen.getByRole('navigation', { name: 'Event nav' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Enable a signup' })).toBeNull();
  });

  it('AgendaTab_OffersAddAnAgenda_WhenNoneExists', async () => {
    const user = userEvent.setup();
    renderWorkbench();
    await user.click(screen.getByRole('tab', { name: 'Agenda' }));
    expect(screen.getByRole('button', { name: 'Add an agenda' })).toBeTruthy();
    expect(screen.queryByLabelText('Agenda editor')).toBeNull();
  });

  it('AgendaTab_ShowsTheEditorItself_WhenAnAgendaExists', async () => {
    const user = userEvent.setup();
    renderWorkbench({
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
    await user.click(screen.getByRole('tab', { name: 'Agenda' }));
    expect(screen.getByLabelText('Agenda editor').textContent).toBe('embedded agenda editor');
    expect(screen.queryByRole('button', { name: 'Add an agenda' })).toBeNull();
    expect(screen.queryByText(/Take Roll Call/)).toBeNull(); // the link at the bottom is gone
  });
});
