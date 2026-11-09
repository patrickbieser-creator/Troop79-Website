import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * merge_people must carry MONEY with the person (found 2026-11-09): it moved
 * signup_entries but never financial_transactions, so a duplicate merge left
 * Maya Sankpal-Tatera's $108.81 scout-account balance on the retired record
 * (98) while her live record (24) read $0. The same gap covered
 * reimbursements, reconciliations and wreath orders/sellers. A promoted
 * Webelos guest (promoteGuest → merge_people) goes through the same path.
 *
 * Every row here is test-owned: own people, own wreath sale (cascades sellers),
 * money rows deleted by the ids this file created.
 */
type Admin = ReturnType<typeof adminClient>;

const created = {
  people: [] as number[],
  transactions: [] as number[],
  reimbursements: [] as number[],
  reconciliations: [] as number[],
  sales: [] as number[]
};

afterEach(async () => {
  const admin = adminClient();
  if (created.transactions.length) await admin.from('financial_transactions').delete().in('id', created.transactions);
  if (created.reimbursements.length) await admin.from('reimbursement_requests').delete().in('id', created.reimbursements);
  if (created.reconciliations.length) await admin.from('account_reconciliations').delete().in('id', created.reconciliations);
  for (const saleId of created.sales) {
    await admin.from('wreath_orders').delete().eq('sale_id', saleId);
    await admin.from('wreath_sales').delete().eq('id', saleId);
  }
  if (created.people.length) {
    await admin.from('audit_log').delete().in('actor_person_id', created.people);
    const { error } = await admin.from('people').delete().in('id', created.people);
    if (error) throw new Error(`fixture cleanup: people delete failed: ${error.message}`);
  }
  for (const k of Object.keys(created) as (keyof typeof created)[]) created[k] = [];
});

async function makePerson(admin: Admin, label: string): Promise<number> {
  const { data, error } = await admin
    .from('people')
    .insert({ display_name: `${TEST_PREFIX} MergeMoney ${label}` })
    .select('id')
    .single();
  if (error || !data) throw new Error(`fixture: people insert failed: ${error?.message}`);
  created.people.push(data.id);
  return data.id as number;
}

async function pair(admin: Admin) {
  return { survivor: await makePerson(admin, 'Survivor'), loser: await makePerson(admin, 'Loser') };
}

async function merge(admin: Admin, survivor: number, loser: number) {
  return admin.rpc('merge_people', { p_survivor: survivor, p_loser: loser, p_decided_by: 'test:merge-money' });
}

async function makeSale(admin: Admin): Promise<number> {
  const { data, error } = await admin
    .from('wreath_sales')
    .insert({
      year: 3000 + Math.floor(Math.random() * 6000),
      status: 'draft',
      round1_cutoff: '2026-10-26T04:59:00.000Z',
      round2_cutoff: '2026-11-16T05:59:00.000Z'
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`fixture sale: ${error?.message}`);
  created.sales.push(data.id);
  return data.id as number;
}

describe('merge_people — money follows the person', () => {
  it('Merge_MovesScoutAccountTransactions_SoTheBalanceFollows', async () => {
    const admin = adminClient();
    const { survivor, loser } = await pair(admin);
    const { data, error } = await admin
      .from('financial_transactions')
      .insert({ occurred_on: '2026-01-01', account: 'scout_account', amount: 12.34, kind: 'fundraiser', person_id: loser, source: 'app' })
      .select('id')
      .single();
    expect(error).toBeNull();
    created.transactions.push(data!.id);

    expect((await merge(admin, survivor, loser)).error).toBeNull();

    const { data: row } = await admin.from('financial_transactions').select('person_id').eq('id', data!.id).single();
    expect(row?.person_id).toBe(survivor);
  });

  it('Merge_MovesTransactionEnteredByAndVoidedBy', async () => {
    const admin = adminClient();
    const { survivor, loser } = await pair(admin);
    const { data, error } = await admin
      .from('financial_transactions')
      .insert({
        occurred_on: '2026-01-01',
        account: 'checking',
        amount: 5,
        kind: 'fundraiser',
        source: 'app',
        entered_by_person_id: loser,
        voided_by_person_id: loser,
        voided_at: '2026-01-02T00:00:00Z'
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    created.transactions.push(data!.id);

    expect((await merge(admin, survivor, loser)).error).toBeNull();

    const { data: row } = await admin
      .from('financial_transactions')
      .select('entered_by_person_id, voided_by_person_id')
      .eq('id', data!.id)
      .single();
    expect(row).toEqual({ entered_by_person_id: survivor, voided_by_person_id: survivor });
  });

  it('Merge_MovesReimbursementRequesterEnteredByAndDecidedBy', async () => {
    const admin = adminClient();
    const { survivor, loser } = await pair(admin);
    const { data, error } = await admin
      .from('reimbursement_requests')
      .insert({
        requester_person_id: loser,
        entered_by_person_id: loser,
        decided_by_person_id: loser,
        amount: 10,
        description: `${TEST_PREFIX} merge money`
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    created.reimbursements.push(data!.id);

    expect((await merge(admin, survivor, loser)).error).toBeNull();

    const { data: row } = await admin
      .from('reimbursement_requests')
      .select('requester_person_id, entered_by_person_id, decided_by_person_id')
      .eq('id', data!.id)
      .single();
    expect(row).toEqual({ requester_person_id: survivor, entered_by_person_id: survivor, decided_by_person_id: survivor });
  });

  it('Merge_MovesReconciledBy', async () => {
    const admin = adminClient();
    const { survivor, loser } = await pair(admin);
    const { data, error } = await admin
      .from('account_reconciliations')
      .insert({
        account: 'savings',
        as_of: `1901-01-${String(1 + Math.floor(Math.random() * 28)).padStart(2, '0')}`,
        statement_balance: 1,
        computed_balance: 1,
        reconciled_by_person_id: loser
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    created.reconciliations.push(data!.id);

    expect((await merge(admin, survivor, loser)).error).toBeNull();

    const { data: row } = await admin.from('account_reconciliations').select('reconciled_by_person_id').eq('id', data!.id).single();
    expect(row?.reconciled_by_person_id).toBe(survivor);
  });

  it('Merge_MovesEveryWreathOrderPersonColumn', async () => {
    const admin = adminClient();
    const { survivor, loser } = await pair(admin);
    const saleId = await makeSale(admin);
    const { data, error } = await admin
      .from('wreath_orders')
      .insert({
        sale_id: saleId,
        idempotency_key: `${TEST_PREFIX}-merge-${Date.now()}-${Math.random()}`,
        source: 'paper',
        fulfillment: 'scout',
        round: 1,
        customer_name: `${TEST_PREFIX} customer`,
        credited_person_id: loser,
        delivering_person_id: loser,
        entered_by_person_id: loser,
        paid_by_person_id: loser
      })
      .select('id')
      .single();
    expect(error).toBeNull();

    expect((await merge(admin, survivor, loser)).error).toBeNull();

    const { data: row } = await admin
      .from('wreath_orders')
      .select('credited_person_id, delivering_person_id, entered_by_person_id, paid_by_person_id')
      .eq('id', data!.id)
      .single();
    expect(row).toEqual({
      credited_person_id: survivor,
      delivering_person_id: survivor,
      entered_by_person_id: survivor,
      paid_by_person_id: survivor
    });
  });

  it('Merge_MovesWreathSeller_WhenSurvivorIsNotASellerInThatSale', async () => {
    const admin = adminClient();
    const { survivor, loser } = await pair(admin);
    const saleId = await makeSale(admin);
    const { data, error } = await admin
      .from('wreath_sellers')
      .insert({ sale_id: saleId, person_id: loser, slug: 'vitest-merge-loser' })
      .select('id')
      .single();
    expect(error).toBeNull();

    expect((await merge(admin, survivor, loser)).error).toBeNull();

    const { data: row } = await admin.from('wreath_sellers').select('person_id').eq('id', data!.id).single();
    expect(row?.person_id).toBe(survivor);
  });

  it('Merge_IsBlocked_WhenBothAreSellersInTheSameSale', async () => {
    const admin = adminClient();
    const { survivor, loser } = await pair(admin);
    const saleId = await makeSale(admin);
    const { error } = await admin.from('wreath_sellers').insert([
      { sale_id: saleId, person_id: survivor, slug: 'vitest-merge-survivor' },
      { sale_id: saleId, person_id: loser, slug: 'vitest-merge-loser' }
    ]);
    expect(error).toBeNull();

    const { error: mergeErr } = await merge(admin, survivor, loser);

    expect(mergeErr?.message).toContain('MERGE_BLOCKED_DUPLICATE_SELLER');
  });
});
