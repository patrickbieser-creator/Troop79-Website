import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useLeaveGuard, LEAVE_MESSAGE } from '../src/lib/use-leave-guard';

/**
 * The public leave guard: while dirty, a click on an in-app link asks first and
 * a "no" cancels the navigation. window.confirm is always stubbed — no test
 * here may open a real dialog.
 */

function Guard({ dirty, links }: { dirty: boolean; links: Record<string, string>[] }) {
  useLeaveGuard(dirty);
  return (
    <nav>
      {links.map((l, i) => (
        <a key={i} data-testid={`l${i}`} {...l}>
          link {i}
        </a>
      ))}
    </nav>
  );
}

let confirm: ReturnType<typeof vi.fn>;
beforeEach(() => {
  confirm = vi.fn(() => false);
  vi.stubGlobal('confirm', confirm);
  window.history.replaceState({}, '', '/library/menu-monster/menus/abc?tab=1');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Clicks link 0 of a freshly rendered guard. */
function click(links: Record<string, string>[], dirty = true, init: MouseEventInit = {}): void {
  const { getByTestId } = render(<Guard dirty={dirty} links={links} />);
  const a = getByTestId('l0');
  // Keep jsdom from "navigating" on an allowed click.
  a.addEventListener('click', (e) => e.preventDefault());
  a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
}

const inApp = [{ href: '/library' }];

describe('useLeaveGuard', () => {
  it('Scout_IsAsked_WhenLeavingViaAnInAppLinkWithUnsavedChanges', () => {
    click(inApp);
    expect(confirm).toHaveBeenCalledWith(LEAVE_MESSAGE);
  });

  it('Scout_StaysPut_WhenTheyDeclineTheLeavePrompt', () => {
    const { getByTestId } = render(<Guard dirty links={inApp} />);
    const seenByLink = vi.fn();
    getByTestId('l0').addEventListener('click', seenByLink);
    getByTestId('l0').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(seenByLink).not.toHaveBeenCalled();
  });

  it('Scout_Leaves_WhenTheyConfirmTheLeavePrompt', () => {
    confirm.mockReturnValue(true);
    const { getByTestId } = render(<Guard dirty links={inApp} />);
    const seenByLink = vi.fn((e: Event) => e.preventDefault());
    getByTestId('l0').addEventListener('click', seenByLink);
    getByTestId('l0').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(seenByLink).toHaveBeenCalled();
  });

  it('Scout_IsNotAsked_WhenThereAreNoUnsavedChanges', () => {
    click(inApp, false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each([
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['shift', { shiftKey: true }],
    ['alt', { altKey: true }],
    ['middle button', { button: 1 }]
  ])('Scout_IsNotAsked_WhenTheClickHasA_%s_modifier', (_n, init) => {
    click(inApp, true, init);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('Scout_IsNotAsked_WhenTheLinkOpensANewTab', () => {
    click([{ href: '/library', target: '_blank' }]);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('Scout_IsNotAsked_WhenTheLinkIsADownload', () => {
    click([{ href: '/library/x.pdf', download: '' }]);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('Scout_IsNotAsked_WhenTheLinkIsAHashOnTheSamePage', () => {
    click([{ href: '#shopping' }]);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('Scout_IsNotAsked_WhenTheLinkIsTheSamePathAndQuery', () => {
    click([{ href: '/library/menu-monster/menus/abc?tab=1' }]);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('Scout_IsAsked_WhenTheLinkIsTheSamePathWithADifferentQuery', () => {
    click([{ href: '/library/menu-monster/menus/abc?tab=2' }]);
    expect(confirm).toHaveBeenCalled();
  });

  it('Scout_IsNotAsked_WhenTheLinkLeavesTheSite', () => {
    click([{ href: 'https://example.com/elsewhere' }]);
    expect(confirm).not.toHaveBeenCalled();
  });
});
