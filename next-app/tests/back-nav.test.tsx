import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackNav } from '../src/app/admin/(workspace)/_components/back-nav';
import { PageTitle } from '../src/app/admin/(workspace)/_components/page-title';
import { DirtyGuardProvider, useRegisterDirty } from '../src/app/admin/(workspace)/_components/dirty-guard';

/**
 * The one way back (Patrick, 2026-08-25: "a consistent way to move backwards
 * … in a consistent place on the screen"; option C — back-link at depth 2,
 * breadcrumbs at depth 3+, quiet text). Plus the two behaviours that ride
 * along: a list's remembered URL survives the round trip, and a dirty form
 * gets a Discard-changes prompt instead of silently losing its edits.
 */
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/admin/calendar',
  useSearchParams: () => new URLSearchParams('tab=past')
}));

beforeEach(() => {
  push.mockClear();
  window.sessionStorage.clear();
});

function DirtyForm() {
  useRegisterDirty(true);
  return <form aria-label="dirty form" />;
}

describe('BackNav', () => {
  it('Depth2_IsABackToParentLink_InANavNamedBack', () => {
    render(<BackNav back={{ label: 'Calendar', href: '/admin/calendar' }} />);
    const link = screen.getByRole('link', { name: /Back to Calendar/ });
    expect(link.getAttribute('href')).toBe('/admin/calendar');
    expect(screen.getByRole('navigation', { name: 'Back' })).toBeTruthy();
  });

  it('Depth3_IsABreadcrumbTrail_CurrentPageLast_NotALink', () => {
    render(
      <BackNav
        back={{
          crumbs: [
            { label: 'Event Management', href: '/admin/rosters' },
            { label: 'Fall Campout', href: '/admin/rosters/7' }
          ],
          current: 'Money'
        }}
      />
    );
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    // The trail is an <ol>; a second, phone-only "← Fall Campout" link sits
    // beside it (CSS shows one or the other — jsdom shows both).
    const trail = within(nav.querySelector('ol')!);
    expect(trail.getByRole('link', { name: 'Event Management' }).getAttribute('href')).toBe('/admin/rosters');
    expect(trail.getByRole('link', { name: 'Fall Campout' }).getAttribute('href')).toBe('/admin/rosters/7');
    const current = nav.querySelector('[aria-current="page"]')!;
    expect(current.textContent).toBe('Money');
    expect(current.querySelector('a')).toBeNull();
  });

  it('Click_LandsOnTheListsRememberedUrl_FiltersAndAll', async () => {
    const user = userEvent.setup();
    window.sessionStorage.setItem('list:/admin/calendar', '/admin/calendar?tab=past&q=camp');
    render(<BackNav back={{ label: 'Calendar', href: '/admin/calendar' }} />);
    await user.click(screen.getByRole('link', { name: /Back to Calendar/ }));
    expect(push).toHaveBeenCalledWith('/admin/calendar?tab=past&q=camp');
  });

  it('DirtyForm_PromptsBeforeLeaving_DiscardGoes_KeepEditingStays', async () => {
    const user = userEvent.setup();
    render(
      <DirtyGuardProvider>
        <BackNav back={{ label: 'News', href: '/admin/news/articles' }} />
        <DirtyForm />
      </DirtyGuardProvider>
    );
    await user.click(screen.getByRole('link', { name: /Back to News/ }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText('Discard changes?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByText('Discard changes?')).toBeNull();
    await user.click(screen.getByRole('link', { name: /Back to News/ }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(push).toHaveBeenCalledWith('/admin/news/articles');
  });

  it('CleanForm_JustLeaves', async () => {
    const user = userEvent.setup();
    render(
      <DirtyGuardProvider>
        <BackNav back={{ label: 'News', href: '/admin/news/articles' }} />
      </DirtyGuardProvider>
    );
    await user.click(screen.getByRole('link', { name: /Back to News/ }));
    expect(push).toHaveBeenCalledWith('/admin/news/articles');
  });
});

describe('PageTitle back slot', () => {
  it('Root_WithBackNull_HasNoBackNav_AndRemembersItsUrl', () => {
    render(<PageTitle back={null} title="Calendar" />);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(window.sessionStorage.getItem('list:/admin/calendar')).toBe('/admin/calendar?tab=past');
  });

  it('Child_RendersTheBackNav_AboveTheTitle', () => {
    render(<PageTitle back={{ label: 'Calendar', href: '/admin/calendar' }} title="Fall Campout" />);
    const nav = screen.getByRole('navigation', { name: 'Back' });
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(nav.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
