import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { centralToday } from '../src/lib/dates';
import { PRICE_BAND, bandCheck } from '../src/lib/menu-monster/price-band';

/**
 * mm_report_price / mm_decide_price (20261003120000_mm_report_price.sql): the
 * band, the chain of old/new prices, and the revert rules. Test package and
 * history rows are removed after every test.
 */
const SCOUT = 39;
const PKG_ID = 'vitest-rpc-package';
const admin = adminClient();

async function makePackage(overrides: Record<string, unknown> = {}) {
  const { data: ing } = await admin.from('mm_ingredients').select('id').is('retired_at', null).limit(1).single();
  const { error } = await admin.from('mm_packages').insert({
    id: PKG_ID, ingredient_id: ing!.id, name: 'vitest rpc', price: 4, yield: 10, as_of: '2026-01-01', ...overrides
  });
  if (error) throw new Error(`fixture: ${error.message}`);
}

async function report(price: number) {
  const { data, error } = await admin.rpc('mm_report_price', {
    p_package_id: PKG_ID, p_new_price: price, p_reported_by: SCOUT, p_menu_id: null, p_band: PRICE_BAND
  });
  if (error) throw new Error(error.message);
  return data as string;
}

async function decide(historyId: string, decision: string) {
  const { data, error } = await admin.rpc('mm_decide_price', {
    p_history_id: historyId, p_decision: decision, p_decided_by: SCOUT
  });
  if (error) throw new Error(error.message);
  return data as string;
}

async function pkg() {
  const { data } = await admin.from('mm_packages').select('price, as_of').eq('id', PKG_ID).single();
  return { price: Number(data!.price), asOf: data!.as_of as string | null };
}
async function history() {
  const { data } = await admin.from('mm_price_history').select('*').eq('package_id', PKG_ID).order('created_at');
  return data ?? [];
}

afterEach(async () => {
  await admin.from('mm_price_history').delete().eq('package_id', PKG_ID);
  await admin.from('mm_packages').delete().eq('id', PKG_ID);
});

describe('mm_report_price', () => {
  it('Report_OnlyBumpsAsOf_WhenPriceIsUnchanged', async () => {
    await makePackage();
    expect(await report(4)).toBe('same');
    expect(await pkg()).toEqual({ price: 4, asOf: centralToday() });
    expect(await history()).toHaveLength(0);
  });

  it('Report_AppliesAndRecordsHistory_WhenInsideTheBand', async () => {
    await makePackage();
    expect(await report(5.5)).toBe('applied');
    expect(await pkg()).toEqual({ price: 5.5, asOf: centralToday() });
    const [h] = await history();
    expect(h).toMatchObject({ status: 'applied', old_price: 4, new_price: 5.5, old_as_of: '2026-01-01', reported_by_person_id: SCOUT, decided_at: null });
  });

  it('Report_Applies_ExactlyAtTheEdge', async () => {
    await makePackage();
    expect(await report(6)).toBe('applied');
  });

  it('Report_Holds_WhenOutsideTheBand_AndLeavesThePriceAlone', async () => {
    await makePackage();
    expect(await report(6.01)).toBe('held');
    expect(await pkg()).toEqual({ price: 4, asOf: '2026-01-01' });
    const [h] = await history();
    expect(h).toMatchObject({ status: 'held', old_price: 4, new_price: 6.01 });
  });

  it('Report_Holds_WhenThePackageHasNoYield', async () => {
    await makePackage({ yield: null });
    expect(await report(4.5)).toBe('held');
    expect(await pkg()).toEqual({ price: 4, asOf: '2026-01-01' });
  });

  it('Report_IsInvalid_WhenThePriceIsNotPositive', async () => {
    await makePackage();
    expect(await report(0)).toBe('invalid');
    expect(await history()).toHaveLength(0);
  });

  it('Report_ReturnsMissing_WhenThePackageIsGone', async () => {
    expect(await report(4)).toBe('missing');
  });

  it('Report_ChainsOldToNew_AcrossTwoSequentialReports', async () => {
    await makePackage();
    await report(5);
    await report(6);
    const [first, second] = await history();
    expect(first).toMatchObject({ old_price: 4, new_price: 5 });
    expect(second).toMatchObject({ old_price: 5, new_price: 6, old_as_of: centralToday() });
  });

  it.each([
    [4, 4.5], [4, 6], [4, 6.01], [4, 2], [4, 1.99], [4, 4], [0.1, 0.15]
  ])('Report_AgreesWithTheTypeScriptBand_ForPrice%sTo%s', async (cur, next) => {
    await makePackage({ price: cur });
    const sql = await report(next);
    const ts = bandCheck({ price: cur, yield: 10 }, next);
    expect(sql).toBe(ts === 'apply' ? 'applied' : ts === 'hold' ? 'held' : ts);
  });
});

describe('mm_decide_price', () => {
  it('Apply_UpdatesThePackage_WhenAHeldRowIsApproved', async () => {
    await makePackage();
    await report(9);
    const [h] = await history();
    expect(await decide(h.id, 'apply')).toBe('applied');
    expect(await pkg()).toEqual({ price: 9, asOf: centralToday() });
    const [after] = await history();
    expect(after).toMatchObject({ status: 'applied', old_price: 4, old_as_of: '2026-01-01', decided_by_person_id: SCOUT });
    expect(after.decided_at).not.toBeNull();
  });

  it('Apply_RebasesOldPrice_WhenThePriceMovedWhileHeld', async () => {
    await makePackage();
    await report(9);
    await admin.from('mm_packages').update({ price: 5 }).eq('id', PKG_ID);
    const [h] = await history();
    await decide(h.id, 'apply');
    const [after] = await history();
    expect(after).toMatchObject({ old_price: 5, new_price: 9 });
  });

  it('Dismiss_MarksTheRowReverted_AndLeavesThePrice', async () => {
    await makePackage();
    await report(9);
    const [h] = await history();
    expect(await decide(h.id, 'dismiss')).toBe('dismissed');
    expect(await pkg()).toEqual({ price: 4, asOf: '2026-01-01' });
    const [after] = await history();
    expect(after).toMatchObject({ status: 'reverted', decided_by_person_id: SCOUT });
  });

  it('Revert_OfAHeldRow_ActsAsDismiss', async () => {
    await makePackage();
    await report(9);
    const [h] = await history();
    expect(await decide(h.id, 'revert')).toBe('dismissed');
  });

  it('Revert_RestoresOldPriceAndDate_WhenPriceStillMatches', async () => {
    await makePackage();
    await report(5);
    const [h] = await history();
    expect(await decide(h.id, 'revert')).toBe('reverted');
    expect(await pkg()).toEqual({ price: 4, asOf: '2026-01-01' });
    const [after] = await history();
    expect(after).toMatchObject({ status: 'reverted', decided_by_person_id: SCOUT });
  });

  it('Revert_IsSuperseded_WhenALaterChangeMovedThePrice', async () => {
    await makePackage();
    await report(5);
    await report(6);
    const [first] = await history();
    expect(await decide(first.id, 'revert')).toBe('superseded');
    expect(await pkg()).toMatchObject({ price: 6 });
    const [still] = await history();
    expect(still).toMatchObject({ status: 'applied', decided_at: null });
  });

  it('Revert_IsNotAllowedTwice', async () => {
    await makePackage();
    await report(5);
    const [h] = await history();
    await decide(h.id, 'revert');
    expect(await decide(h.id, 'revert')).toBe('not_applied');
  });

  it('Apply_IsRefused_WhenTheRowIsNotHeld', async () => {
    await makePackage();
    await report(5);
    const [h] = await history();
    expect(await decide(h.id, 'apply')).toBe('not_held');
  });

  it('Decide_ReturnsMissing_ForAnUnknownRow', async () => {
    expect(await decide('00000000-0000-0000-0000-000000000000', 'apply')).toBe('missing');
  });

  it('Decide_Rejects_AnUnknownDecision', async () => {
    await expect(decide('00000000-0000-0000-0000-000000000000', 'nope')).rejects.toThrow();
  });
});

describe('mm_report_price access', () => {
  it('Report_IsNotCallableByAnon', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error } = await anon.rpc('mm_report_price', {
      p_package_id: PKG_ID, p_new_price: 1, p_reported_by: SCOUT, p_menu_id: null, p_band: 0.5
    });
    expect(error).not.toBeNull();
  });
});
