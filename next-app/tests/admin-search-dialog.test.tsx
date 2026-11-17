import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { FEATURES, visibleFeatures } from '../src/app/admin/(workspace)/_components/feature-registry';
import { searchEntries } from '../src/app/admin/(workspace)/_components/search-model';
import { CAPABILITIES, type Capability } from '../src/lib/capabilities';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }), usePathname: () => '/admin' }));
const beacon = vi.fn();
vi.mock('../src/app/admin/(workspace)/_components/nav-beacon', () => ({ beaconNavOpen: (k: string) => beacon(k) }));

const { SearchLauncher } = await import('../src/app/admin/(workspace)/_components/search-dialog');

/** The search dialog (Plans/Completed/Admin-Portal-Nav.md decision 8): keyboard, focus and what opening does. */

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

beforeEach(() => {
  push.mockClear();
  beacon.mockClear();
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ people: [], calendar: [], articles: [] }))) as typeof fetch;
});

const ENTRIES = searchEntries(
  visibleFeatures(FEATURES, { fullAdmin: true, capabilities: new Set<Capability>(CAPABILITIES), healthViewer: true, plannerView: true })
);

function setup() {
  render(
    <>
      <button type="button">Elsewhere</button>
      <SearchLauncher entries={ENTRIES} />
    </>
  );
  return screen.getByRole('combobox', { hidden: true });
}

describe('search dialog', () => {
  it('Search_OpensOnCtrlK', () => {
    const input = setup();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(input);
  });

  it('Search_OpensOnSlash_ButNotWhileTyping', () => {
    setup();
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    fireEvent.keyDown(field, { key: '/' });
    expect(document.activeElement).toBe(field);
  });

  it('Search_FirstResultIsPreselected', () => {
    const input = setup();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    fireEvent.change(input, { target: { value: 'fast entry' } });
    expect(screen.getAllByRole('option', { hidden: true })[0].getAttribute('aria-selected')).toBe('true');
  });

  it('Search_KeyboardMovesAndOpens', () => {
    const input = setup();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    fireEvent.change(input, { target: { value: 'ledger' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const selected = screen.getAllByRole('option', { hidden: true }).find((o) => o.getAttribute('aria-selected') === 'true')!;
    const label = selected.querySelector('span')!.textContent;
    fireEvent.keyDown(input, { key: 'Enter' });
    const target = ENTRIES.find((e) => e.label === label)!;
    expect([push.mock.calls.at(-1)?.[0], beacon.mock.calls.at(-1)?.[0]]).toEqual([target.href, target.key]);
  });

  it('Search_ArrowUpFromTheTopWrapsToTheLast', () => {
    const input = setup();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    fireEvent.change(input, { target: { value: 'wreath' } });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    const options = screen.getAllByRole('option', { hidden: true });
    expect(options[options.length - 1].getAttribute('aria-selected')).toBe('true');
  });

  it('Search_EscapeRestoresFocus', () => {
    const input = setup();
    const before = screen.getByRole('button', { name: 'Elsewhere' });
    before.focus();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    act(() => {
      (input.closest('dialog') as HTMLDialogElement).close();
    });
    expect(document.activeElement).toBe(before);
  });

  it('Search_RecordsAppearAfterTwoCharacters', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ people: [{ id: '82', label: 'Patrick Bieser', meta: null, href: '/admin/advancement/roster/82' }], calendar: [], articles: [] }))
    ) as typeof fetch;
    const input = setup();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    fireEvent.change(input, { target: { value: 'patrick' } });
    expect(await screen.findByText('Patrick Bieser', {}, { timeout: 2000 })).toBeTruthy();
  });

  it('Search_SaysWhenNothingMatches', () => {
    const input = setup();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    fireEvent.change(input, { target: { value: 'zzqx' } });
    expect([screen.getByText('Nothing matches', { exact: false }) != null, screen.getByRole('status', { hidden: true }).textContent]).toEqual([
      true,
      'No results'
    ]);
  });

  it('Search_AnnouncesTheResultCount', () => {
    const input = setup();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    fireEvent.change(input, { target: { value: 'fast entry' } });
    expect(screen.getByRole('status', { hidden: true }).textContent).toMatch(/^\d+ results?$/);
  });

  it('Search_ResultsSitInNamedGroups', () => {
    const input = setup();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    fireEvent.change(input, { target: { value: 'wreath' } });
    expect(screen.getAllByRole('group', { hidden: true }).map((g) => g.textContent?.split(/(?=[A-Z])/)[0])).toContain('Screens');
  });

  it('RecentSearches_RememberOnlySearchesThatOpenedAScreen', async () => {
    window.localStorage.clear();
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ people: [{ id: '82', label: 'Patrick Bieser', meta: null, href: '/admin/advancement/roster/82' }], calendar: [], articles: [] }))
    ) as typeof fetch;
    const input = setup();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    fireEvent.change(input, { target: { value: 'patrick' } });
    fireEvent.click(await screen.findByText('Patrick Bieser', {}, { timeout: 2000 }));
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    fireEvent.change(input, { target: { value: 'ledger' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(JSON.parse(window.localStorage.getItem('admin-search-recent') ?? '[]')).toEqual(['ledger']);
  });
});
