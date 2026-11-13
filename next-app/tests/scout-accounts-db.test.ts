import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestScout, deleteTestScout, TEST_PREFIX, type TestScout } from './helpers/signup-fixtures';

/**
 * Scout Accounts, the data side (admin Money › Scout Accounts, 2026-11-12): the holder list, one holder's ledger with a
 * running balance and initials, and moving a departed scout's balance to the troop's general fund. Real local DB;
 * request glue mocked as in the other finance db tests.
 */
const actor = vi.hoisted(() => ({ value: { kind: 'identity', label: 'ZZ Vitest Treasurer', personId: null as number | null, capabilities: new Set(['finance.manage']) } }));
// The capability check is real in shape: refuse unless the actor holds what is asked for.
vi.mock('@/lib/require-capability', () => ({
  requireAnyOf: async (caps: string[]) => {
    if (!caps.some((c) => actor.value.capabilities.has(c))) throw new Error(`This action requires: ${caps.join(' or ')}.`);
    return actor.value;
  },
  requireCapability: async (cap: string) => {
    if (!actor.value.capabilities.has(cap)) throw new Error(`This action requires: ${cap}.`);
    return actor.value;
  }
}));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => adminClient() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, updateTag: () => undefined, revalidateTag: () => undefined }));

import {
  getScoutAccountHistoryAction,
  listScoutAccountsAction,
  moveScoutAccountToTroopAction
} from '../src/app/admin/(workspace)/finance/scout-accounts/actions';
import { MOVE_TO_TROOP_MEMO } from '../src/lib/scout-accounts';

const admin = adminClient();
let left: TestScout;
let active: TestScout;
let treasurer: number;

async function row(personId: number, amount: number, occurredOn: string, extra: Record<string, unknown> = {}) {
  const { error } = await admin
    .from('financial_transactions')
    .insert({ account: 'scout_account', person_id: personId, amount, occurred_on: occurredOn, kind: amount > 0 ? 'fundraiser' : 'expense', ...extra });
  if (error) throw new Error(`fixture txn: ${error.message}`);
}

beforeEach(async () => {
  left = await createTestScout(admin, 'Left');
  active = await createTestScout(admin, 'Active');
  await admin.from('scouts').update({ active: false, inactive_reason: 'moved_away' }).eq('id', left.scoutId);
  const { data } = await admin.from('people').insert({ display_name: `${TEST_PREFIX} Kara Pitt`, first_name: 'Kara', last_name: 'Pitt' }).select('id').single();
  treasurer = data!.id as number;
  actor.value = { ...actor.value, personId: treasurer, capabilities: new Set(['finance.manage']) };
  await row(left.personId, 93.6, '2023-11-10', { entered_by_person_id: treasurer });
  await row(left.personId, -15, '2024-07-31');
  await row(left.personId, 55.65, '2024-11-10');
});

afterEach(async () => {
  await admin.from('financial_transactions').delete().in('person_id', [left.personId, active.personId]);
  await deleteTestScout(admin, left);
  await deleteTestScout(admin, active);
  await admin.from('people').delete().eq('id', treasurer);
});

describe('listScoutAccountsAction', () => {
  it('lists a departed scout with their balance and last date', async () => {
    const rows = await listScoutAccountsAction();
    expect(rows.find((r) => r.personId === left.personId)).toMatchObject({ status: 'inactive', balance: 134.25, lastOn: '2024-11-10' });
  });
  it('lists an active scout with no history at $0', async () => {
    const rows = await listScoutAccountsAction();
    expect(rows.find((r) => r.personId === active.personId)).toMatchObject({ status: 'active', balance: 0, lastOn: null });
  });
  it('ends with the Scholarship Fund', async () => {
    const rows = await listScoutAccountsAction();
    expect(rows.at(-1)?.key).toBe('scholarship');
  });
});

describe('getScoutAccountHistoryAction', () => {
  it('returns the ledger newest first with the balance after each row', async () => {
    const h = await getScoutAccountHistoryAction({ personId: left.personId });
    if (!h.ok) throw new Error(h.error);
    expect(h.txns.map((t) => [t.occurredOn, t.balanceAfter])).toEqual([
      ['2024-11-10', 134.25],
      ['2024-07-31', 78.6],
      ['2023-11-10', 93.6]
    ]);
  });
  it('signs a row with who recorded it', async () => {
    const h = await getScoutAccountHistoryAction({ personId: left.personId });
    if (!h.ok) throw new Error(h.error);
    expect(h.txns.at(-1)?.enteredBy).toBe('Kara P.');
  });
  it('labels the kind', async () => {
    const h = await getScoutAccountHistoryAction({ personId: left.personId });
    if (!h.ok) throw new Error(h.error);
    expect(h.txns.map((t) => t.kindLabel)).toEqual(['Fundraiser', 'Expense', 'Fundraiser']);
  });
  it('refuses a made-up target', async () => {
    const h = await getScoutAccountHistoryAction({ personId: -3 });
    expect(h.ok).toBe(false);
  });
});

describe('moveScoutAccountToTroopAction', () => {
  const moveRows = async (personId: number) =>
    (await admin.from('financial_transactions').select('amount, kind, memo, entered_by_person_id').eq('person_id', personId).eq('kind', 'transfer')).data;

  it('writes one Transfer row taking the balance to $0', async () => {
    const res = await moveScoutAccountToTroopAction({ personId: left.personId });
    expect(res).toEqual({ ok: true, moved: 134.25 });
    expect(await moveRows(left.personId)).toEqual([{ amount: -134.25, kind: 'transfer', memo: MOVE_TO_TROOP_MEMO, entered_by_person_id: treasurer }]);
  });
  it('two moves at once write one row', async () => {
    await Promise.all([moveScoutAccountToTroopAction({ personId: left.personId }), moveScoutAccountToTroopAction({ personId: left.personId })]);
    expect(await moveRows(left.personId)).toHaveLength(1);
  });
  it('a second move finds nothing to move', async () => {
    await moveScoutAccountToTroopAction({ personId: left.personId });
    const res = await moveScoutAccountToTroopAction({ personId: left.personId });
    expect(res).toEqual({ ok: false, error: 'There is nothing to move — the balance is $0.00 or less.' });
  });
  it('after the move is voided, the balance can be moved again', async () => {
    await moveScoutAccountToTroopAction({ personId: left.personId });
    await admin.from('financial_transactions').update({ voided_at: new Date().toISOString() }).eq('person_id', left.personId).eq('kind', 'transfer');
    const res = await moveScoutAccountToTroopAction({ personId: left.personId });
    expect(res).toEqual({ ok: true, moved: 134.25 });
  });
  it('ignores voided rows when working out the balance', async () => {
    await row(left.personId, 500, '2025-02-01', { voided_at: new Date().toISOString() });
    const res = await moveScoutAccountToTroopAction({ personId: left.personId });
    expect(res).toEqual({ ok: true, moved: 134.25 });
  });
  it('moves an aged-out scout’s balance', async () => {
    await admin.from('scouts').update({ inactive_reason: 'aged_out' }).eq('id', left.scoutId);
    const res = await moveScoutAccountToTroopAction({ personId: left.personId });
    expect(res.ok).toBe(true);
  });
  it('refuses an active scout', async () => {
    await row(active.personId, 20, '2025-01-01');
    const res = await moveScoutAccountToTroopAction({ personId: active.personId });
    expect(res).toEqual({ ok: false, error: 'This scout is still active.' });
  });
  it('refuses a person who was never a scout', async () => {
    await row(treasurer, 20, '2025-01-01');
    const res = await moveScoutAccountToTroopAction({ personId: treasurer });
    await admin.from('financial_transactions').delete().eq('person_id', treasurer);
    expect(res.ok).toBe(false);
  });
  it('refuses a view-only treasurer', async () => {
    actor.value = { ...actor.value, capabilities: new Set(['finance.view']) };
    await expect(moveScoutAccountToTroopAction({ personId: left.personId })).rejects.toThrow(/requires/);
  });
});

describe('reading accounts', () => {
  it('refuses someone with neither finance capability', async () => {
    actor.value = { ...actor.value, capabilities: new Set(['advancement.write']) };
    await expect(listScoutAccountsAction()).rejects.toThrow(/requires/);
  });
});
