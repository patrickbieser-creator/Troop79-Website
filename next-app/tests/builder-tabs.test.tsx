import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BuilderPanels } from '../src/app/admin/(workspace)/events/[id]/builder-panels';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
}));

/**
 * Signup Builder layout (Patrick, 2026-08-23): the Blocks checklist stays at
 * the top; every other data-entry section is a TAB under it — Settings first
 * and open by default, then Price tiers, Jobs, Questions, Assignments in the
 * order they always had — so the forms are visually separated and it is clear
 * where one ends and the next begins. The Remove-signup danger panel is not a
 * data-entry form and stays below the tabs.
 */
function renderBuilder(over: Partial<Parameters<typeof BuilderPanels>[0]> = {}) {
  return render(
    <BuilderPanels
      signupId={1}
      calendarEntryId={2}
      entryDate="2026-10-09"
      endDate="2026-10-11"
      signup={{ attendance_enabled: true, status: 'open' }}
      prices={[{ id: 1, label: 'Scout', amount: 30, per: 'event', applies_to: 'scouts' }]}
      slots={[{ id: 11, kind: 'task', label: 'Cashier', code: 'CASH', attendance_required: false }]}
      questions={[]}
      sets={[]}
      {...over}
    />
  );
}

const tabNames = () => within(screen.getByRole('tablist', { name: /builder sections/i })).getAllByRole('tab').map((t) => t.textContent?.replace(/\d+/g, '').trim());

describe('Builder — Blocks stay, every other section is a tab', () => {
  it('Tabs_AreGeneratedInSectionOrder_SettingsFirstAndOpenByDefault', () => {
    renderBuilder();
    expect(tabNames()).toEqual(['Settings', 'Price tiers', 'Jobs', 'Questions', 'Assignments']);
    expect(screen.getByRole('heading', { name: 'Blocks' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    // Other sections are not rendered until their tab is picked.
    expect(screen.queryByRole('heading', { name: /price tiers/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /jobs — shifts/i })).toBeNull();
    expect(screen.getByRole('tab', { name: /settings/i }).getAttribute('aria-selected')).toBe('true');
  });

  it('Tabs_CarryCounts_AndSwitchTheVisibleSection', async () => {
    const user = userEvent.setup();
    renderBuilder();
    expect(screen.getByRole('tab', { name: /price tiers/i }).textContent).toMatch(/1/);
    await user.click(screen.getByRole('tab', { name: /jobs/i }));
    expect(screen.getByRole('heading', { name: /jobs — shifts/i })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Blocks' })).toBeTruthy(); // Blocks never leaves
  });

  it('RemoveSignup_DangerPanel_StaysBelowTheTabs_NotATab', () => {
    renderBuilder();
    expect(tabNames()).not.toContain('Remove signup from this event');
    expect(screen.getByRole('heading', { name: /remove signup from this event/i })).toBeTruthy();
  });
});

describe('Builder — Jobs tab: Add a job is hidden until asked for', () => {
  // Patrick, 2026-08-23: "have the Add a Job feature hidden until someone
  // clicks Add a Job … put the button on the right side so it's consistent
  // with the other Add buttons".
  it('AddAJob_Button_OpensTheFormAndFocusesTheName_FormIsClosedByDefault', async () => {
    const user = userEvent.setup();
    renderBuilder();
    await user.click(screen.getByRole('tab', { name: /jobs/i }));
    expect(screen.queryByRole('heading', { name: /add a job/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: /add a job/i }));
    expect(screen.getByRole('heading', { name: /add a job/i })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByPlaceholderText(/setup crew/i));
    // The code field suggests the derived code for whatever is typed as the name.
    await user.type(screen.getByPlaceholderText(/setup crew/i), 'Serve dinner');
    expect(screen.getByPlaceholderText('SD')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^done$/i }));
    expect(screen.queryByRole('heading', { name: /add a job/i })).toBeNull();
  });

  it('JobList_ShowsEachJobsRosterCode', async () => {
    const user = userEvent.setup();
    renderBuilder();
    await user.click(screen.getByRole('tab', { name: /jobs/i }));
    expect(screen.getByText('CASH', { selector: 'span' })).toBeTruthy();
  });
});
