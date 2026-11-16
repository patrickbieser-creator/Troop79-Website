import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * Home's At a glance (Plans/Admin-Portal-Nav.md decision 6). The loaders are stubbed by what they read; the tile
 * rules (who sees the money tiles, what a failed tile shows) are real.
 */
const calls: string[] = [];
let failFunds = false;
vi.mock('@/lib/missing-bsa-ids', () => ({
  loadMissingBsaIds: async () => {
    calls.push('people');
    return { scouts: [{}, {}, {}], leaders: [{}], activeScouts: 31 };
  }
}));
vi.mock('@/lib/wreaths/admin-data', () => ({ loadAdminSale: async () => null }));
vi.mock('@/lib/meeting-board', () => ({ loadUpcomingMeetings: async () => [] }));

const { AtAGlance } = await import('../src/app/admin/(workspace)/_home/at-a-glance');

beforeEach(() => {
  calls.length = 0;
  failFunds = false;
});

/** A fake service-role client: just enough of rpc / from for the finance loaders. */
function fakeClient() {
  return {
    rpc: async () => {
      calls.push('funds');
      if (failFunds) return { data: null, error: { message: 'down' } };
      return { data: [{ account: 'checking', balance_cents: 500000 }, { account: 'savings', balance_cents: 342000 }, { account: 'scout_account', balance_cents: 99900 }], error: null };
    },
    from: () => {
      calls.push('uncollected');
      const q = { select: () => q, gt: () => q, eq: () => q, order: () => q, range: async () => ({ data: [{ balance: '620.00' }], error: null }) };
      return q;
    }
  };
}

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => fakeClient() }));

async function renderGlance(o: { financeView?: boolean; financeManage?: boolean; canRoster?: boolean }) {
  render(await AtAGlance({ financeView: o.financeView ?? false, financeManage: o.financeManage ?? false, canRoster: o.canRoster ?? true }));
  return screen.getByRole('region', { name: 'At a glance' }).textContent ?? '';
}

describe('At a glance', () => {
  it('AtAGlance_ShowsAllFourTiles_ToATreasurer', async () => {
    const text = await renderGlance({ financeManage: true });
    expect(['Active scouts', 'Troop account', 'Missing BSA IDs', 'Uncollected funds'].every((t) => text.includes(t))).toBe(true);
  });

  it('AtAGlance_MoneyTiles_HiddenWithoutFinance', async () => {
    const text = await renderGlance({});
    expect([text.includes('Troop account'), text.includes('Uncollected funds')]).toEqual([false, false]);
  });

  it('AtAGlance_MoneyLoaders_NeverRunWithoutFinance', async () => {
    await renderGlance({});
    expect(calls).toEqual(['people']);
  });

  it('AtAGlance_FinanceViewSeesTheAccount_NotUncollected', async () => {
    const text = await renderGlance({ financeView: true });
    expect([text.includes('Troop account'), text.includes('Uncollected funds')]).toEqual([true, false]);
  });

  it('TroopAccount_IsCheckingPlusSavings', async () => {
    const text = await renderGlance({ financeView: true });
    expect(text).toContain('$8,420');
  });

  it('UncollectedFunds_ShowsTotalAndBothParts', async () => {
    const text = await renderGlance({ financeManage: true });
    expect([text.includes('$620'), text.includes('Wreath orders $0'), text.includes('Event fees $620')]).toEqual([true, true, true]);
  });

  it('MissingBsaIds_SplitsScoutsAndLeaders', async () => {
    await renderGlance({});
    expect(screen.getByText('3 scouts · 1 leader')).toBeTruthy();
  });

  it('MissingBsaIds_LinksToTheReport_ForRosterManagers', async () => {
    await renderGlance({ canRoster: true });
    expect(screen.getByRole('link', { name: /Missing BSA IDs/ }).getAttribute('href')).toBe('/admin/reports/missing-bsa-ids');
  });

  it('AFailedTile_SaysSoInPlace_AndTheOthersStillShow', async () => {
    failFunds = true;
    const text = await renderGlance({ financeView: true });
    expect([text.includes('Couldn’t load'), text.includes('Active scouts'), text.includes('31')]).toEqual([true, true, true]);
  });
});
