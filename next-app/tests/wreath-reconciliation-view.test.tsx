import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AdminOrder, AdminSeller } from '../src/lib/wreaths/admin-data';
import { buildReconciliation, type Reconciliation } from '../src/lib/wreaths/reconciliation';

/**
 * Admin › Wreath Sale › Reconciliation, the family Statement page, and their gates (Patrick, 2026-10-19).
 * The page tests mock the session and data seams; the access rule itself (canViewStatement) runs for real.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  }
}));

const createAdminClient = vi.fn(() => ({}));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => createAdminClient() }));

let scope: { scope: number[]; proxyPersonId: number | null } | null = null;
const loadScoutStatement = vi.fn();
vi.mock('@/lib/wreaths/statement', async (orig) => ({
  ...(await orig<typeof import('@/lib/wreaths/statement')>()),
  resolveStatementScope: async () => scope,
  loadScoutStatement: (...a: unknown[]) => loadScoutStatement(...a)
}));

let capabilityOk = false;
vi.mock('@/lib/require-capability', () => ({
  requireCapability: async (cap: string) => {
    if (!capabilityOk || cap !== 'finance.manage') throw new Error(`requires ${cap}`);
  }
}));

const LILY = 100;
const BEN = 200;
let n = 0;
const order = (over: Partial<AdminOrder> = {}): AdminOrder => {
  n += 1;
  return {
    id: n, orderNumber: `W-${1000 + n}`, placedAt: '2026-10-14T15:00:00.000Z', round: 1, source: 'scout_link', fulfillment: 'pickup',
    creditedPersonId: LILY, creditedName: 'Lily L', deliveringPersonId: null, customerName: `Customer ${n}`, customerEmail: `c${n}@example.test`,
    customerPhone: '414-555-0100', customerAddress: '', customerCity: '', customerZip: '', outsideAreaRelative: false, itemsSubtotal: 52,
    deliveryFee: 0, feeCovered: 0, gift: 0, total: 52, paymentStatus: 'unpaid', paidMethod: null, paidAt: null, paidAmount: null, status: 'placed',
    stripeFee: null, refundedAt: null, needsRefund: null, cardStarted: false, enteredByPersonId: null, enteredByName: null, collectedByScout: false,
    paymentNote: '', customerNote: '', orderNote: '', orderNoteBy: null, orderNoteAt: null,
    lines: [{ itemId: 1, label: '20″ Wreath', catalogNumber: 1, quantity: 2, donated: false, amount: 52, unitPrice: 26, unitCost: 16.07 }],
    ...over
  };
};
const seller = (personId: number, name: string): AdminSeller => ({ id: personId, personId, name, slug: null, active: true, orders: 0, goal: null, deliveryMessage: null });
const SALE = { year: 2026, scoutShare: 0.3, donationShare: 0.15, feePercent: 2.9, feeFixed: 0.3, round1Cutoff: '2026-10-21T04:59:00.000Z', round2Cutoff: '2026-11-11T05:59:00.000Z' };
const recon = (): Reconciliation =>
  buildReconciliation({ orders: [order(), order({ creditedPersonId: BEN, creditedName: 'Ben B', customerName: 'Ben customer' })], sellers: [seller(LILY, 'Lily L'), seller(BEN, 'Ben B')], items: [], sale: SALE });
const AS_OF = '2026-10-19T17:00:00.000Z';

beforeEach(() => {
  scope = null;
  capabilityOk = false;
  createAdminClient.mockClear();
  loadScoutStatement.mockReset();
});

describe('Reconciliation panel', () => {
  it('PrintView_RendersOnlyTheSelectedScout', async () => {
    const { ReconciliationPanel } = await import('../src/app/admin/(workspace)/finance/wreaths/reconciliation-panel');
    render(<ReconciliationPanel r={recon()} scout={String(LILY)} asOf={AS_OF} />);
    expect([screen.queryByRole('region', { name: 'Lily L wreath account' })?.hasAttribute('data-statement-print'), screen.queryByRole('region', { name: 'Ben B wreath account' })]).toEqual([true, null]);
  });

  it('PrintView_ShowsTheSettingsUsed', async () => {
    const { ReconciliationPanel } = await import('../src/app/admin/(workspace)/finance/wreaths/reconciliation-panel');
    render(<ReconciliationPanel r={recon()} scout={String(LILY)} asOf={AS_OF} />);
    expect(screen.getByText(/Profit share: scout 30%, troop 70%.*Card fee: 2.9% \+ \$0.30/)).toBeTruthy();
  });

  it('BottomLine_SaysWhenTheMoneyMoves', async () => {
    const { ReconciliationPanel } = await import('../src/app/admin/(workspace)/finance/wreaths/reconciliation-panel');
    render(<ReconciliationPanel r={recon()} scout={String(LILY)} asOf={AS_OF} />);
    expect(screen.getByText('Moves to Lily’s scout account after the books close (December).')).toBeTruthy();
  });

  it('Balanced_SaysSo', async () => {
    const { ReconciliationPanel } = await import('../src/app/admin/(workspace)/finance/wreaths/reconciliation-panel');
    render(<ReconciliationPanel r={recon()} scout="" asOf={AS_OF} />);
    expect(screen.getByText('Balances with the sales dashboard ✓')).toBeTruthy();
  });

  // Patrick, 2026-10-19: the card fee's wreath part comes off the troop's share, on the order and in the totals.
  const cardRecon = () =>
    buildReconciliation({
      orders: [order({ paymentStatus: 'paid', paidMethod: 'card', paidAmount: 52, stripeFee: 1.81 })],
      sellers: [seller(LILY, 'Lily L')],
      items: [],
      sale: SALE
    });

  it('Statement_CardFeeRow_ComesOffTheTroopsShare', async () => {
    const { ReconciliationPanel } = await import('../src/app/admin/(workspace)/finance/wreaths/reconciliation-panel');
    render(<ReconciliationPanel r={cardRecon()} scout={String(LILY)} asOf={AS_OF} />);
    const row = screen.getByText('Card fee $1.81').closest('tr')!;
    expect(row.lastElementChild!.textContent).toBe('−$1.81');
  });

  it('Statement_UnpaidOrderWithAStaleCover_ShowsNoCardFeeRow', async () => {
    const { ReconciliationPanel } = await import('../src/app/admin/(workspace)/finance/wreaths/reconciliation-panel');
    const r = buildReconciliation({ orders: [order({ feeCovered: 1.92, total: 53.92 })], sellers: [seller(LILY, 'Lily L')], items: [], sale: SALE });
    render(<ReconciliationPanel r={r} scout={String(LILY)} asOf={AS_OF} />);
    expect(screen.queryByText(/^Card fee|customer covered/)).toBeNull();
  });

  it('AllScouts_ShowsTheCardFeesOffTheTroopsShare', async () => {
    const { ReconciliationPanel } = await import('../src/app/admin/(workspace)/finance/wreaths/reconciliation-panel');
    render(<ReconciliationPanel r={cardRecon()} scout="" asOf={AS_OF} />);
    expect(screen.getByText('Card fees off the troop’s share').nextElementSibling!.textContent).toBe('−$1.81');
  });

  it('Mismatch_NamesTheDifference', async () => {
    const { ReconciliationPanel } = await import('../src/app/admin/(workspace)/finance/wreaths/reconciliation-panel');
    const r = { ...recon(), check: { ok: false, mismatches: [{ label: 'Profit', reconciliation: 10, dashboard: 12 }] } };
    render(<ReconciliationPanel r={r} scout="" asOf={AS_OF} />);
    expect(screen.getByRole('alert').textContent).toContain('Profit $10.00 here, $12.00 on the dashboard');
  });
});

describe('Reconciliation tab — access gate', () => {
  it('AdminPage_RefusesWithoutFinanceManage_BeforeReadingTheDatabase', async () => {
    const { default: Page } = await import('../src/app/admin/(workspace)/finance/wreaths/page');
    await expect(Page({ searchParams: Promise.resolve({ tab: 'reconciliation' }) })).rejects.toThrow('requires finance.manage');
    expect(createAdminClient).not.toHaveBeenCalled();
  }, 90_000); // the admin page's module graph is large: a cold import is slow under a full-suite load
});

describe('Family statement page — access', () => {
  const lilyStatement = () => {
    const r = recon();
    return { year: r.year, settings: r.settings, name: 'Lily L', section: r.sections.find((s) => s.personId === LILY)! };
  };

  it('Family_SeesItsOwnScoutsStatement', async () => {
    scope = { scope: [LILY, 300], proxyPersonId: null };
    loadScoutStatement.mockResolvedValue(lilyStatement());
    const { default: Page } = await import('../src/app/(public)/member/wreaths/statement/page');
    render(await Page({ searchParams: Promise.resolve({ scout: String(LILY) }) }));
    expect(screen.getByRole('region', { name: 'Lily L wreath account' })).toBeTruthy();
  });

  it('Family_AnotherFamilysScout_Is404_WithoutLoadingIt', async () => {
    scope = { scope: [LILY, 300], proxyPersonId: null };
    const { default: Page } = await import('../src/app/(public)/member/wreaths/statement/page');
    await expect(Page({ searchParams: Promise.resolve({ scout: String(BEN) }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(loadScoutStatement).not.toHaveBeenCalled();
  });

  it('SignedOut_GetsTheSignInPrompt_AndNoStatement', async () => {
    const { default: Page } = await import('../src/app/(public)/member/wreaths/statement/page');
    render(await Page({ searchParams: Promise.resolve({ scout: String(LILY) }) }));
    expect([screen.getByText(/Sign in to see your scout/) != null, loadScoutStatement.mock.calls.length]).toEqual([true, 0]);
  });

  it('Statement_ShowsTheScoutsCustomersContact', async () => {
    scope = { scope: [LILY], proxyPersonId: null };
    loadScoutStatement.mockResolvedValue(lilyStatement());
    const { default: Page } = await import('../src/app/(public)/member/wreaths/statement/page');
    render(await Page({ searchParams: Promise.resolve({ scout: String(LILY) }) }));
    expect(screen.getAllByText(/414-555-0100/).length).toBeGreaterThan(0);
  });
});
