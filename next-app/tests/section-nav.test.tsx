import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminNav } from '../src/app/admin/(workspace)/_components/section-nav';
import { DirtyGuardProvider, useRegisterDirty } from '../src/app/admin/(workspace)/_components/dirty-guard';
import { CAPABILITIES, type Capability } from '../src/lib/capabilities';

/**
 * The section bar + per-section tabs that replaced the left rail
 * (Plans/Admin-Home-And-Nav.md Wave 3). The model (which sections, which tabs, which is active) is tested in
 * admin-hub.test.ts; this file covers what renders and that every link goes through the dirty-form guard.
 */
const push = vi.fn();
let pathname = '/admin/advancement/ledger';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => pathname
}));

beforeEach(() => {
  push.mockClear();
  pathname = '/admin/advancement/ledger';
  // jsdom has no <dialog> modal support.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
});

function DirtyForm() {
  useRegisterDirty(true);
  return <form aria-label="dirty form" />;
}
function Shell({ caps, dirty = false, fullAdmin = false }: { caps: Capability[]; dirty?: boolean; fullAdmin?: boolean }) {
  return (
    <DirtyGuardProvider>
      <AdminNav fullAdmin={fullAdmin} capabilities={caps} />
      {dirty ? <DirtyForm /> : null}
    </DirtyGuardProvider>
  );
}

describe('AdminNav (section bar + tabs)', () => {
  it('SectionBar_ListsOnlySectionsWithVisibleItems_AndMarksTheActiveOne', () => {
    render(<Shell caps={['advancement.write']} />);
    const bar = within(screen.getByRole('navigation', { name: 'Admin sections' }));
    expect(bar.getAllByRole('link').map((a) => a.textContent)).toEqual(['Home', 'Advancement', 'Reports']);
    expect(bar.getByRole('link', { name: 'Advancement' }).getAttribute('aria-current')).toBe('page');
    expect(bar.getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBeNull();
  });

  it('SectionTabs_ListTheActiveSectionsItems_WithTheCurrentOneSelected', () => {
    render(<Shell caps={['advancement.write']} />);
    const tabs = within(screen.getByRole('navigation', { name: 'Advancement section' }));
    expect(tabs.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Dashboard', 'Fast Entry', 'Ledger', 'Submit & Present', 'MB Progress', 'Has/Needs'
    ]);
    expect(tabs.getByRole('tab', { name: 'Ledger' }).getAttribute('aria-selected')).toBe('true');
    expect(tabs.getByRole('tab', { name: 'Dashboard' }).getAttribute('aria-selected')).toBe('false');
  });

  it('SectionBar_LightsReportsWithNoTabStrip_OnAReportPage', () => {
    pathname = '/admin/advancement/court-of-honor';
    render(<Shell caps={['advancement.write']} />);
    expect(screen.getByRole('link', { name: 'Reports' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('SectionTabs_AreAbsent_WhenTheSectionHasOneVisibleItem', () => {
    pathname = '/admin/calendar';
    render(<Shell caps={['calendar.write']} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('link', { name: 'Calendar & Content' }).getAttribute('aria-current')).toBe('page');
  });

  it('SectionTabs_AreAbsent_OnHome', () => {
    pathname = '/admin';
    render(<Shell caps={[...CAPABILITIES]} fullAdmin />);
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('SectionBar_NavigatesStraightAway_WhenNothingIsDirty', async () => {
    render(<Shell caps={['advancement.write']} />);
    await userEvent.click(screen.getByRole('link', { name: 'Home' }));
    expect(push).toHaveBeenCalledWith('/admin');
  });

  it('SectionBar_AsksToDiscard_WhenAFormIsDirty', async () => {
    render(<Shell caps={['advancement.write']} dirty />);
    await userEvent.click(screen.getByRole('link', { name: 'Home' }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText('Discard changes?')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(push).toHaveBeenCalledWith('/admin');
  });

  it('SectionTabs_AskToDiscard_WhenAFormIsDirty', async () => {
    render(<Shell caps={['advancement.write']} dirty />);
    await userEvent.click(screen.getByRole('tab', { name: 'Dashboard' }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText('Discard changes?')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(push).not.toHaveBeenCalled();
  });

  it('SectionTabs_NavigateStraightAway_WhenNothingIsDirty', async () => {
    render(<Shell caps={['advancement.write']} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Dashboard' }));
    expect(push).toHaveBeenCalledWith('/admin/advancement/dashboard');
  });
});
