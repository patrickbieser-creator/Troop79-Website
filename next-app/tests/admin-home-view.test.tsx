import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CAPABILITIES } from '../src/lib/capabilities';

/**
 * Home (/admin) and the Dashboard page (/admin/advancement/dashboard) are two pages now: Home is the inbox and the card
 * grid only; the old overview lives on its own page, reached from the first Advancement card. Collaborators that need a
 * database or the router are stubbed - this asserts what each page puts on screen, not how it loads.
 */
vi.mock('@/lib/admin-actor', () => ({
  resolveAdminActor: async () => ({ legacyRole: null, capabilities: new Set(CAPABILITIES) })
}));
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => undefined }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/wreaths/admin-data', () => ({ loadWreathSaleOpen: async () => false }));
vi.mock('../src/app/admin/(workspace)/advancement/dashboard/attention-items', () => ({ loadAttentionCategories: async () => [] }));
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
vi.mock('../src/app/admin/(workspace)/advancement/dashboard/advancement-overview', () => ({
  AdvancementOverview: () => <div data-testid="overview">Recent Ledger Activity</div>
}));

describe('AdminHome', () => {
  async function renderHome() {
    const { AdminHome } = await import('../src/app/admin/(workspace)/advancement/dashboard/admin-home');
    render(await AdminHome());
  }

  it('AdminHome_RendersNoAdvancementOverviewButton', async () => {
    await renderHome();
    expect(screen.queryByRole('link', { name: 'Advancement overview' })).toBeNull();
  });

  it('AdminHome_RendersNoOverview', async () => {
    await renderHome();
    expect(screen.queryByTestId('overview')).toBeNull();
  });

  it('AdminHome_RendersTheInbox', async () => {
    await renderHome();
    expect(screen.getByTestId('inbox')).toBeTruthy();
  });

  it('AdminHome_OffersTheDashboardAsACard_InTheAdvancementGroup', async () => {
    const { AdminHome } = await import('../src/app/admin/(workspace)/advancement/dashboard/admin-home');
    render(await AdminHome());
    const dashboard = screen.getByRole('link', { name: 'Dashboard' });
    expect(dashboard.getAttribute('href')).toBe('/admin/advancement/dashboard');
    expect(dashboard.closest('section')!.getAttribute('data-tint')).toBe('moss');
  });
});

describe('Dashboard page', () => {
  it('DashboardPage_RendersTheOverviewUnderItsOwnTitle_NotTheHomeInbox', async () => {
    const { default: DashboardPage, metadata } = await import('../src/app/admin/(workspace)/advancement/dashboard/page');
    render(await DashboardPage());
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByTestId('overview')).toBeTruthy();
    expect(screen.queryByTestId('inbox')).toBeNull();
    expect(metadata.title).toBe('Dashboard — Troop 79');
  });
});
