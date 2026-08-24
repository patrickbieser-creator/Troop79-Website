import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
      signupId={null}
      attendanceCount={0}
      onSaveStory={vi.fn()}
      onAddAgenda={vi.fn()}
      {...over}
    />
  );
}

function tabNames(): string[] {
  return screen.getAllByRole('tab').map((t) => t.textContent ?? '');
}

describe('Calendar entry workbench — one tab per layer', () => {
  it('MeetingTemplate_OffersDetailsStoryAgendaRollCallSignup_InThatOrder', () => {
    renderWorkbench();
    expect(tabNames()).toEqual(['Details', 'Story', 'Agenda', 'Roll Call', 'Signup']);
  });

  it('ActivityTemplate_HasNoAgendaTab', () => {
    renderWorkbench({ template: 'activity' });
    expect(tabNames()).toEqual(['Details', 'Story', 'Roll Call', 'Signup']);
  });

  it('OpensOnDetails_AndOnlyThatPanelIsVisible', () => {
    renderWorkbench();
    expect(screen.getByRole('tab', { name: 'Details' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Details' }).hidden).toBe(false);
    // Hidden panels leave the accessibility tree — Testing Library can't find them by role.
    expect(screen.queryByRole('tabpanel', { name: 'Story' })).toBeNull();
    const storyPanel = document.querySelector('section[aria-label="Story"]') as HTMLElement;
    expect(storyPanel.hidden).toBe(true); // still mounted — just hidden
  });

  it('SwitchingToStory_ShowsStory_AndKeepsTheDraftWhenSwitchingBack', async () => {
    const user = userEvent.setup();
    renderWorkbench();
    await user.click(screen.getByRole('tab', { name: 'Story' }));
    expect(screen.getByRole('tabpanel', { name: 'Story' }).hidden).toBe(false);
    expect(screen.queryByRole('tabpanel', { name: 'Details' })).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Story' }), 'Bring a headlamp');
    expect(screen.getByRole('tab', { name: 'Story •' })).toBeTruthy(); // the unsaved-draft dot
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await user.click(screen.getByRole('tab', { name: 'Story •' }));
    expect((screen.getByRole('textbox', { name: 'Story' }) as HTMLTextAreaElement).value).toBe('Bring a headlamp');
  });

  it('RollCallTab_CarriesTheAttendanceCount_WhenRollWasTaken', () => {
    renderWorkbench({ attendanceCount: 14 });
    expect(screen.getByRole('tab', { name: /Roll Call/ }).textContent).toContain('14');
  });

  it('AgendaTab_OffersAddAnAgenda_WhenNoneExists', async () => {
    const user = userEvent.setup();
    renderWorkbench();
    await user.click(screen.getByRole('tab', { name: 'Agenda' }));
    expect(screen.getByRole('button', { name: 'Add an agenda' })).toBeTruthy();
  });
});
