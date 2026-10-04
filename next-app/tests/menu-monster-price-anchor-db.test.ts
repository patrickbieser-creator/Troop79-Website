import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import { PRICE_BAND } from '../src/lib/menu-monster/price-band';
import {
  decidePriceWith,
  leaderSetPriceWith,
  listRecentChangesWith,
  reportPriceWith
} from '../src/lib/menu-monster/price-history';
import type { AuditEntry } from '../src/lib/audit';

/**
 * The leader-approved anchor (20261003130000_mm_price_anchor.sql, Patrick
 * 2026-10-02): the +/-30% band is measured from the last price a LEADER set or
 * approved, so scouts can update as often as they like but never drift past it.
 * Fixture package: price 4, yield 10, so the band is 2.80 .. 5.20 until a
 * leader moves it. Everything the tests touch is removed afterwards.
 */
const SCOUT = 39;
const PKG_ID = 'vitest-anchor-package';
const admin = adminClient();
const spy = () => vi.fn<(e: AuditEntry) => Promise<void>>(async () => {});
let otherPerson = 0;

beforeAll(async () => {
  const { data } = await admin.from('people').select('id').neq('id', SCOUT).order('id').limit(1).single();
  otherPerson = data!.id as number;
});

async function makePackage(overrides: Record<string, unknown> = {}) {
  const { data: ing } = await admin.from('mm_ingredients').select('id').is('retired_at', null).limit(1).single();
  const { error } = await admin.from('mm_packages').insert({
    id: PKG_ID, ingredient_id: ing!.id, name: 'vitest anchor', price: 4, yield: 10, as_of: '2026-01-01', ...overrides
  });
  if (error) throw new Error(`fixture: ${error.message}`);
}

const report = (price: number, by = SCOUT) =>
  reportPriceWith(admin, { packageId: PKG_ID, newPrice: price, reportedBy: by }, spy());

async function pkg() {
  const { data } = await admin.from('mm_packages').select('price, anchor_price, anchor_as_of').eq('id', PKG_ID).single();
  return { price: Number(data!.price), anchor: Number(data!.anchor_price), anchorAsOf: data!.anchor_as_of as string | null };
}
async function history() {
  const { data } = await admin.from('mm_price_history').select('*').eq('package_id', PKG_ID).order('created_at');
  return data ?? [];
}
const decide = (historyId: string, decision: 'apply' | 'dismiss' | 'revert') =>
  decidePriceWith(admin, { historyId, decision, decidedBy: SCOUT }, spy());

afterEach(async () => {
  await admin.from('mm_price_history').delete().eq('package_id', PKG_ID);
  await admin.from('mm_packages').delete().eq('id', PKG_ID);
});

describe('anchor on a new package', () => {
  it('Package_StartsAnchoredAtItsPrice_WhenInsertedWithoutAnAnchor', async () => {
    await makePackage();
    expect(await pkg()).toMatchObject({ price: 4, anchor: 4, anchorAsOf: '2026-01-01' });
  });
});

describe('scout reports are banded against the anchor', () => {
  it('Scout_CannotDriftPastTheBand_BySequentialReportsEachWithinTheBandOfTheCurrentPrice', async () => {
    await makePackage();
    const outcomes: string[] = [];
    let current = 4;
    for (let i = 0; i < 6; i++) {
      const next = Math.round(current * 1.2 * 100) / 100; // always inside +/-30% of the CURRENT price
      outcomes.push(await report(next));
      current = (await pkg()).price;
    }
    const after = await pkg();
    expect(after.price).toBeLessThanOrEqual(4 * (1 + PRICE_BAND));
    expect(after.anchor).toBe(4);
    expect(outcomes).toContain('held');
    expect(outcomes[0]).toBe('applied');
  });

  it('Scout_CannotDriftDownPastTheBand_EitherAfterSequentialCuts', async () => {
    await makePackage();
    let current = 4;
    for (let i = 0; i < 6; i++) {
      await report(Math.round(current * 0.8 * 100) / 100);
      current = (await pkg()).price;
    }
    expect((await pkg()).price).toBeGreaterThanOrEqual(4 * (1 - PRICE_BAND));
  });

  it('Scout_AppliedChange_DoesNotMoveTheAnchor', async () => {
    await makePackage();
    expect(await report(5)).toBe('applied');
    expect(await pkg()).toMatchObject({ price: 5, anchor: 4, anchorAsOf: '2026-01-01' });
  });

  it('Scout_IsHeld_WhenInsideTheBandOfTheCurrentPriceButOutsideTheAnchors', async () => {
    await makePackage();
    await report(5.2);
    expect(await report(6.5)).toBe('held');
    expect((await pkg()).price).toBe(5.2);
  });

  it('Scout_IsApplied_WhenBackInsideTheAnchorsBand', async () => {
    await makePackage();
    await report(5.2);
    expect(await report(3)).toBe('applied');
  });
});

describe('leader decisions move the anchor', () => {
  it('Leader_ApprovingAHeldPrice_MovesThePriceAndTheAnchor', async () => {
    await makePackage();
    await report(9);
    const [held] = await history();
    expect(await decide(held.id, 'apply')).toBe('applied');
    expect(await pkg()).toMatchObject({ price: 9, anchor: 9 });
  });

  it('Scout_CanMoveFromTheNewAnchor_AfterALeaderApprovedAHigherPrice', async () => {
    await makePackage();
    await report(9);
    const [held] = await history();
    await decide(held.id, 'apply');
    expect(await report(11)).toBe('applied');
  });

  it('Leader_SettingAPrice_MovesThePriceAndTheAnchorTogether', async () => {
    await makePackage();
    expect(await leaderSetPriceWith(admin, { packageId: PKG_ID, newPrice: 9, asOf: '2026-03-03', leaderId: SCOUT })).toBe('applied');
    expect(await pkg()).toMatchObject({ price: 9, anchor: 9, anchorAsOf: '2026-03-03' });
  });

  it('Leader_DismissingAHeldPrice_LeavesThePriceAndAnchorAndMarksItDismissed', async () => {
    await makePackage();
    await report(9);
    const [held] = await history();
    await decide(held.id, 'dismiss');
    expect(await pkg()).toMatchObject({ price: 4, anchor: 4 });
    expect((await history())[0].status).toBe('dismissed');
  });
});

describe('revert and the anchor', () => {
  it('Leader_RevertingAnApprovedHeldPrice_RestoresThePriceAndTheOlderAnchor', async () => {
    await makePackage();
    await report(9);
    const [held] = await history();
    await decide(held.id, 'apply');
    expect(await decide(held.id, 'revert')).toBe('reverted');
    expect(await pkg()).toMatchObject({ price: 4, anchor: 4, anchorAsOf: '2026-01-01' });
  });

  it('Leader_RevertingALeaderSetPrice_RestoresTheOlderAnchor', async () => {
    await makePackage();
    await leaderSetPriceWith(admin, { packageId: PKG_ID, newPrice: 5, asOf: '2026-03-03', leaderId: SCOUT });
    const [row] = await history();
    await decide(row.id, 'revert');
    expect(await pkg()).toMatchObject({ price: 4, anchor: 4, anchorAsOf: '2026-01-01' });
  });

  it('Leader_RevertingAScoutsAppliedChange_LeavesTheAnchorWhereItWas', async () => {
    await makePackage();
    await leaderSetPriceWith(admin, { packageId: PKG_ID, newPrice: 5, asOf: '2026-03-03', leaderId: SCOUT });
    await report(6);
    const rows = await history();
    await decide(rows[1].id, 'revert');
    expect(await pkg()).toMatchObject({ price: 5, anchor: 5 });
  });
});

describe('duplicate held reports', () => {
  it('SameScout_LeavesOneHeldRow_WhenTheyReportAHeldPriceTwice', async () => {
    await makePackage();
    await report(9);
    await report(10);
    const rows = await history();
    expect(rows.filter((r) => r.status === 'held')).toHaveLength(1);
    expect(rows.filter((r) => r.status === 'held')[0]).toMatchObject({ new_price: 10 });
    const dismissed = rows.filter((r) => r.status === 'dismissed');
    expect(dismissed).toHaveLength(1);
    expect(dismissed[0]).toMatchObject({ new_price: 9, decided_by_person_id: null });
    expect(dismissed[0].decided_at).not.toBeNull();
  });

  it('TwoScouts_EachKeepTheirOwnHeldRow', async () => {
    await makePackage();
    await report(9, SCOUT);
    await report(10, otherPerson);
    expect((await history()).filter((r) => r.status === 'held')).toHaveLength(2);
  });
});

describe('recent changes list', () => {
  it('Leader_DoesNotSeeDismissedRows_InRecentChanges', async () => {
    await makePackage();
    await report(9);
    await report(10); // dismisses the 9
    const [held] = (await history()).filter((r) => r.status === 'held');
    await decide(held.id, 'dismiss');
    await report(5); // applied
    const mine = (await listRecentChangesWith(admin)).filter((c) => c.packageId === PKG_ID);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: 'applied', newPrice: 5 });
  });
});

describe('function access', () => {
  const email = `vitest-anchor-${Date.now()}@example.invalid`;
  const password = 'vitest-anchor-Pass-123';
  let userId: string | null = null;

  afterEach(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
    userId = null;
  });

  async function authed() {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(created.error.message);
    userId = created.data.user.id;
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return client;
  }
  const anon = () =>
    createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

  const calls: [string, Record<string, unknown>][] = [
    ['mm_report_price', { p_package_id: PKG_ID, p_new_price: 1, p_reported_by: SCOUT, p_menu_id: null, p_band: 0.5 }],
    ['mm_decide_price', { p_history_id: '00000000-0000-0000-0000-000000000000', p_decision: 'apply', p_decided_by: SCOUT }],
    ['mm_leader_set_price', { p_package_id: PKG_ID, p_new_price: 1, p_as_of: null, p_leader: SCOUT }]
  ];

  it.each(calls)('Anon_CannotCall_%s', async (fn, args) => {
    await makePackage();
    const { error } = await anon().rpc(fn, args);
    expect(error).not.toBeNull();
    expect(await pkg()).toMatchObject({ price: 4, anchor: 4 });
  });

  it.each(calls)('Authenticated_CannotCall_%s', async (fn, args) => {
    await makePackage();
    const { error } = await (await authed()).rpc(fn, args);
    expect(error).not.toBeNull();
    expect(await pkg()).toMatchObject({ price: 4, anchor: 4 });
  });
});
