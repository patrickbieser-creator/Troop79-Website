import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { reportPriceWith } from '../src/lib/menu-monster/price-history';

/**
 * The leader side of price history in the admin actions: updatePackage writes
 * an applied history row, and apply / dismiss / revert gate on
 * library.moderate and map the RPC outcomes. The session and the audit trail
 * are stubbed; the database is the real local one. Rows are for the test scout
 * (Charlie Walters, person 39) and are removed after each test.
 */
const LEADER = 39;
const PKG_ID = 'vitest-action-package';
const admin = adminClient();

const mocks = vi.hoisted(() => ({
  allowed: true,
  personId: 39 as number | null,
  audit: vi.fn(async () => {})
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/require-capability', () => ({
  requireCapability: async () => {
    if (!mocks.allowed) throw new Error('nope');
    return { personId: mocks.personId };
  }
}));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});

import {
  applyHeldPrice,
  dismissHeldPrice,
  revertPriceChange,
  updatePackage
} from '../src/app/admin/(workspace)/library/menu-monster/actions';

async function makePackage() {
  const { data: ing } = await admin.from('mm_ingredients').select('id').is('retired_at', null).limit(1).single();
  const { error } = await admin
    .from('mm_packages')
    .insert({ id: PKG_ID, ingredient_id: ing!.id, name: 'vitest action package', price: 4, yield: 10, as_of: '2026-01-01', noun: 'pack' });
  if (error) throw new Error(`fixture: ${error.message}`);
}

const edit = (price: number) => ({
  name: 'vitest action package', store: null, price, yield: 10, yieldUnitLabel: null, asOf: '2026-02-02',
  note: null, soldSize: null, soldUnit: null, noun: 'pack'
});

async function history() {
  const { data } = await admin.from('mm_price_history').select('*').eq('package_id', PKG_ID).order('created_at');
  return data ?? [];
}

beforeEach(() => {
  mocks.allowed = true;
  mocks.personId = LEADER;
  mocks.audit.mockClear();
});

afterEach(async () => {
  await admin.from('mm_price_history').delete().eq('package_id', PKG_ID);
  await admin.from('mm_packages').delete().eq('id', PKG_ID);
});

describe('updatePackage price history', () => {
  it('Leader_PriceEdit_WritesAnAppliedHistoryRow', async () => {
    await makePackage();
    expect((await updatePackage(PKG_ID, edit(5))).ok).toBe(true);
    const rows = await history();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'applied', old_price: 4, new_price: 5, old_as_of: '2026-01-01', reported_by_person_id: LEADER, decided_by_person_id: LEADER });
  });

  it('Leader_PriceEdit_MovesTheBandAnchorWithThePrice', async () => {
    await makePackage();
    await updatePackage(PKG_ID, edit(5));
    const { data } = await admin.from('mm_packages').select('price, anchor_price, anchor_as_of').eq('id', PKG_ID).single();
    expect(data).toMatchObject({ price: 5, anchor_price: 5, anchor_as_of: '2026-02-02' });
  });

  it('Leader_PriceEdit_ChangesNothing_WhenTheHistoryRowCannotBeWritten', async () => {
    await makePackage();
    mocks.personId = 2147483000; // no such person: the history insert fails inside the one transaction
    const res = await updatePackage(PKG_ID, edit(5));
    expect(res.ok).toBe(false);
    const { data } = await admin.from('mm_packages').select('price, as_of, anchor_price').eq('id', PKG_ID).single();
    expect(data).toMatchObject({ price: 4, as_of: '2026-01-01', anchor_price: 4 });
    expect(await history()).toHaveLength(0);
  });

  it('Leader_EditWithoutAPriceChange_WritesNoHistory', async () => {
    await makePackage();
    await updatePackage(PKG_ID, edit(4));
    expect(await history()).toHaveLength(0);
  });

  it('Leader_PriceEdit_LetsALaterScoutReportChainFromIt', async () => {
    await makePackage();
    await updatePackage(PKG_ID, edit(5));
    await reportPriceWith(admin, { packageId: PKG_ID, newPrice: 6, reportedBy: LEADER }, async () => {});
    const rows = await history();
    expect(rows[1]).toMatchObject({ old_price: 5, new_price: 6 });
  });

  it('Leader_PriceEdit_IsRevertable_WhenNothingChangedSince', async () => {
    await makePackage();
    await updatePackage(PKG_ID, edit(5));
    const [row] = await history();
    const res = await revertPriceChange(row.id);
    expect(res).toMatchObject({ ok: true, outcome: 'reverted' });
    const { data } = await admin.from('mm_packages').select('price, as_of').eq('id', PKG_ID).single();
    expect(data).toMatchObject({ price: 4, as_of: '2026-01-01' });
  });
});

describe('price decision actions', () => {
  async function heldRow() {
    await makePackage();
    await reportPriceWith(admin, { packageId: PKG_ID, newPrice: 9, reportedBy: LEADER }, async () => {});
    return (await history())[0];
  }

  it('Leader_CanApplyAHeldPrice', async () => {
    const row = await heldRow();
    expect(await applyHeldPrice(row.id)).toMatchObject({ ok: true, outcome: 'applied', historyId: row.id });
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it('Leader_CanDismissAHeldPrice', async () => {
    const row = await heldRow();
    expect(await dismissHeldPrice(row.id)).toMatchObject({ ok: true, outcome: 'dismissed' });
  });

  it('Leader_CanUndoAnApply_ByRevertingIt', async () => {
    const row = await heldRow();
    await applyHeldPrice(row.id);
    expect(await revertPriceChange(row.id)).toMatchObject({ ok: true, outcome: 'reverted' });
    const { data } = await admin.from('mm_packages').select('price').eq('id', PKG_ID).single();
    expect(Number(data!.price)).toBe(4);
  });

  it('Leader_IsToldWhyARevertDidNothing_WhenTheRowWasSuperseded', async () => {
    await makePackage();
    await updatePackage(PKG_ID, edit(5));
    await updatePackage(PKG_ID, edit(6));
    const [first] = await history();
    const res = await revertPriceChange(first.id);
    expect(res).toMatchObject({ ok: false, outcome: 'superseded' });
    expect(res.error).toMatch(/changed since/);
  });

  it('Visitor_CannotDecide_WithoutTheLibraryCapability', async () => {
    const row = await heldRow();
    mocks.allowed = false;
    expect(await applyHeldPrice(row.id)).toEqual({ ok: false, error: 'Not authenticated' });
    expect((await history())[0].status).toBe('held');
  });

  it('Leader_CannotDecide_WithoutAPersonRecord', async () => {
    const row = await heldRow();
    mocks.personId = null;
    expect((await applyHeldPrice(row.id)).ok).toBe(false);
    expect((await history())[0].status).toBe('held');
  });
});
