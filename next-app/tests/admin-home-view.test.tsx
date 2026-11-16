import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CAPABILITIES, type Capability } from '../src/lib/capabilities';

/**
 * Home (/admin), Plans/Admin-Portal-Nav.md decisions 5–7: what each kind of leader sees. Loaders that need a database
 * are stubbed; the registry, the visibility rules and the shortcut/shelf logic are real.
 */
let caps: Capability[] = [...CAPABILITIES];
vi.mock('@/lib/admin-actor', () => ({
  resolveAdminActor: async () => ({ legacyRole: null, personId: 82, capabilities: new Set(caps), subjectKind: 'adult' })
}));
vi.mock('@/lib/health-access', () => ({ adminIsHealthViewer: async () => false }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));
vi.mock('../src/app/admin/(workspace)/advancement/dashboard/attention-items', () => ({ attentionCategoriesFor: async () => [] }));
vi.mock('../src/app/admin/(workspace)/advancement/dashboard/suggestion-actions', () => ({
  loadSuggestionActor: async () => ({ name: 'Pat', email: 'pat@example.com' }),
  sendSuggestionAction: async () => ({ ok: true })
}));
vi.mock('../src/app/admin/(workspace)/advancement/dashboard/suggestion-button', () => ({ SuggestionButton: () => null }));
vi.mock('../src/app/admin/(workspace)/_components/attention-inbox', () => ({
  AttentionInbox: () => <div data-testid="inbox">Needs you today</div>
}));
vi.mock('../src/app/admin/(workspace)/_components/page-title', () => ({
  PageTitle: ({ title }: { title: string }) => <h1>{title}</h1>
}));
vi.mock('../src/app/admin/(workspace)/_components/pins-store', () => ({ loadPinKeys: async () => ['money.ledger'] }));
vi.mock('../src/app/admin/(workspace)/_components/nav-events', () => ({
  mostOpened: async () => [
    { key: 'content.calendar', count: 9 },
    { key: 'money.ledger', count: 4 }
  ]
}));
vi.mock('../src/app/admin/(workspace)/_home/advancement-cards', () => ({
  RecentLedgerCard: () => <div data-testid="ledger-card" />,
  LikelyReadyCard: () => <div data-testid="ready-card" />,
  RecentLoginsCard: () => <div data-testid="logins-card" />
}));
vi.mock('../src/app/admin/(workspace)/_home/home-data', async (orig) => ({
  ...(await orig<typeof import('../src/app/admin/(workspace)/_home/home-data')>()),
  loadThisWeek: async () => ({
    meeting: { entryId: 7, date: '2026-11-22', title: 'Troop Meeting', startTime: '19:00:00', location: null, closed: false },
    comingUp: [{ id: 8, date: '2026-12-14', title: 'Court of Honor' }]
  })
}));
vi.mock('../src/app/admin/(workspace)/_home/at-a-glance', () => ({
  AtAGlance: ({ financeManage }: { financeManage: boolean }) => <div data-testid="glance" data-finance={String(financeManage)} />
}));

async function renderHome() {
  const { AdminHome } = await import('../src/app/admin/(workspace)/advancement/dashboard/admin-home');
  render(await AdminHome());
}

beforeEach(() => {
  caps = [...CAPABILITIES];
});

describe('Home', () => {
  it('Home_ShowsNeedsYouTodayAndThisWeek', async () => {
    await renderHome();
    expect([screen.getByTestId('inbox') != null, screen.getByRole('heading', { name: 'This week' }) != null]).toEqual([true, true]);
  });

  it('Shortcuts_PinsFirst_ThenMostOpened', async () => {
    await renderHome();
    const tiles = screen.getByRole('region', { name: 'Your shortcuts' }).querySelectorAll('a[href]:not([href="/admin/pins"])');
    expect([...tiles].map((a) => a.textContent)).toEqual(['Financial LedgerMoney · pinned', 'CalendarWebsite Content · opened 9 times in 30 days']);
  });

  it('AtAGlance_StreamsBesideTheReportsShelf', async () => {
    await renderHome();
    expect(screen.getByTestId('glance').getAttribute('data-finance')).toBe('true');
  });

  it('AdvancementCards_HiddenWithoutAdvancementWrite', async () => {
    caps = ['calendar.write'];
    await renderHome();
    expect([screen.queryByTestId('ledger-card'), screen.queryByTestId('ready-card')]).toEqual([null, null]);
  });

  it('AdvancementCards_ShownWithAdvancementWrite', async () => {
    await renderHome();
    expect([screen.getByTestId('ledger-card') != null, screen.getByTestId('ready-card') != null]).toEqual([true, true]);
  });

  it('RecentLogins_HiddenWithoutRosterManage', async () => {
    caps = ['advancement.write'];
    await renderHome();
    expect(screen.queryByTestId('logins-card')).toBeNull();
  });

  it('ReportsShelf_LinksToAllReports', async () => {
    await renderHome();
    expect(screen.getByRole('link', { name: /^All \d+ reports/ }).getAttribute('href')).toBe('/admin/reports');
  });

  it('Home_HasNoCardGridAndNoDashboardLink', async () => {
    await renderHome();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull();
  });
});
