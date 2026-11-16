import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { FEATURES, visibleFeatures } from '../src/app/admin/(workspace)/_components/feature-registry';
import { railModel } from '../src/app/admin/(workspace)/_components/area-menu';
import { CAPABILITIES, type Capability } from '../src/lib/capabilities';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push, replace: vi.fn() }),
  usePathname: () => '/admin/utilities/ledger-audit'
}));
const pinFeatureAction = vi.fn<(key: string) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
vi.mock('../src/app/admin/(workspace)/_components/pin-actions', () => ({
  pinFeatureAction: (k: string) => pinFeatureAction(k),
  unpinFeatureAction: vi.fn(async () => ({ ok: true }))
}));

const { Rail } = await import('../src/app/admin/(workspace)/_components/rail');

/** The rail and its menus as rendered (Plans/Admin-Portal-Nav.md phase 3). */

const ALL = visibleFeatures(FEATURES, { fullAdmin: true, capabilities: new Set<Capability>(CAPABILITIES), healthViewer: true, plannerView: true });

function renderRail(pinKeys: string[] = [], canPin = true) {
  const m = railModel(ALL, pinKeys, { wreathOpen: false });
  return render(<Rail groups={m.groups} pins={m.pins} setup={m.setup} counts={Promise.resolve({ money: 9 })} canPin={canPin} />);
}

const railNames = () =>
  [...screen.getByRole('navigation', { name: 'Workspace' }).querySelectorAll('a, button')]
    .map((el) => el.textContent?.replace(' (current section)', '').replace(/\d+$/, '').trim())
    .filter((t) => t && t !== 'Close' && t !== 'Edit pins');

describe('rail', () => {
  it('Rail_ShowsSetupAndAZ_DirectlyUnderPins', () => {
    renderRail(['advancement.fast-entry', 'money.ledger']);
    expect(railNames()).toEqual([
      'Home',
      'Meetings',
      'Advancement',
      'Website Content',
      'Money',
      'People',
      'Reports',
      'Fast Entry',
      'Financial Ledger',
      'Setup',
      'Everything A–Z'
    ]);
  });

  it('ActiveGroup_ByMembership_HighlightsMoneyOnLedgerAudit', () => {
    renderRail();
    expect(screen.getByRole('button', { name: /^Money/ }).getAttribute('data-active')).toBe('true');
  });

  it('Rail_GroupIsAButton_ClickOpensItsMenu', () => {
    renderRail();
    fireEvent.click(screen.getByRole('button', { name: /^Money/ }));
    expect(screen.getByRole('region', { name: 'Money menu' })).toBeTruthy();
  });

  it('AreaMenu_EmptyColumn_SaysNoneYet', () => {
    renderRail();
    fireEvent.click(screen.getByRole('button', { name: /^Website Content/ }));
    expect(within(screen.getByRole('region', { name: 'Website Content menu' })).getByText('None yet')).toBeTruthy();
  });

  it('Menu_EscapeCloses_ReturnsFocus', () => {
    renderRail();
    const money = screen.getByRole('button', { name: /^Money/ });
    fireEvent.click(money);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect([screen.queryByRole('region', { name: /menu$/ }), document.activeElement]).toEqual([null, money]);
  });

  it('Menu_ItemNavigatesAndCloses', () => {
    renderRail();
    fireEvent.click(screen.getByRole('button', { name: /^Money/ }));
    fireEvent.click(screen.getByRole('link', { name: /^Bucket Report/ }));
    expect([push.mock.calls.at(-1)?.[0], screen.queryByRole('region', { name: /menu$/ })]).toEqual(['/admin/finance/report', null]);
  });

  it('Pin_AddsToRail', async () => {
    renderRail();
    fireEvent.click(screen.getByRole('button', { name: /^Money/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pin Bucket Report' }));
    });
    expect(pinFeatureAction).toHaveBeenCalledWith('money.bucket-report');
  });

  it('Pin_HiddenWithoutAPersonalSignIn', () => {
    renderRail([], false);
    fireEvent.click(screen.getByRole('button', { name: /^Money/ }));
    expect(screen.queryByRole('button', { name: /^Pin / })).toBeNull();
  });

  it('PinnedItem_ShowsUnpin', () => {
    renderRail(['money.bucket-report']);
    fireEvent.click(screen.getByRole('button', { name: /^Money/ }));
    expect(screen.getByRole('button', { name: 'Unpin Bucket Report' })).toBeTruthy();
  });

  it('PhoneMenuButton_OpensTheRailSheet_AndSaysSo', async () => {
    const { RailMenuButton } = await import('../src/app/admin/(workspace)/_components/rail');
    const m = railModel(ALL, [], { wreathOpen: false });
    const { container } = render(
      <>
        <RailMenuButton />
        <Rail groups={m.groups} pins={m.pins} setup={m.setup} counts={Promise.resolve({})} canPin />
      </>
    );
    const button = screen.getByRole('button', { name: 'Menu' });
    await act(async () => {
      fireEvent.click(button);
    });
    expect([button.getAttribute('aria-expanded'), container.querySelector('[data-sheet-open]') != null]).toEqual(['true', true]);
  });

  it('Counts_ShowOnTheirGroup', async () => {
    renderRail();
    expect(await screen.findByText('waiting', { exact: false })).toBeTruthy();
  });
});
