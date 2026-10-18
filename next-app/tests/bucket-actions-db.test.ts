import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestEvent, deleteTestEvent, TEST_PREFIX, type TestEvent } from './helpers/signup-fixtures';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/require-capability', () => ({
  requireCapability: async () => ({ personId: null }),
  requireAnyOf: async () => ({ personId: null })
}));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});

import { createBucketAction, deleteBucketAction, renameBucketAction, setEventBucketAction, listBucketsAction } from '../src/app/admin/(workspace)/finance/bucket-actions';

/** Bucket server actions (Plans/Buckets-Lookup.md) against the local DB. Test-owned names only. */
const admin = adminClient();
const P = `${TEST_PREFIX} bact`;
let event: TestEvent;

async function row(extra: Record<string, unknown>) {
  const { data, error } = await admin
    .from('financial_transactions')
    .insert({ occurred_on: '2026-09-01', account: 'checking', amount: -12, kind: 'expense', memo: P, ...extra })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message);
  return data.id as number;
}

beforeAll(async () => {
  event = await createTestEvent(admin);
});
afterEach(async () => {
  await admin.from('financial_transactions').delete().eq('memo', P);
  await admin.from('calendar_entries').update({ bucket_id: null }).eq('id', event.calendarEntryId);
  await admin.from('buckets').delete().like('name', `${TEST_PREFIX}%`);
});
afterAll(async () => {
  await deleteTestEvent(admin, event);
});

describe('bucket actions', () => {
  it('Treasurer_CanCreateABucket_AndItIsInThePickerList', async () => {
    const res = await createBucketAction(`${P}  Popcorn   Sale `);
    const list = await listBucketsAction();
    expect([res.bucket?.name, list.some((b) => b.id === res.bucket?.id)]).toEqual([`${P} Popcorn Sale`, true]);
  });

  it('CreateBucket_SaysWhichBucketAlreadyExists_OnADuplicate', async () => {
    await createBucketAction(`${P} Dupe`);
    const res = await createBucketAction(`${P.toLowerCase()} dupe`);
    expect(res.error).toMatch(/already exists/);
  });

  it('RenameBucket_MergesIntoTheBucketThatHasTheNewName', async () => {
    const a = (await createBucketAction(`${P} A`)).bucket!.id;
    const b = (await createBucketAction(`${P} B`)).bucket!.id;
    const id = await row({ bucket_id: a });
    const res = await renameBucketAction(a, `${P} b`);
    const { data } = await admin.from('financial_transactions').select('bucket_id').eq('id', id).single();
    expect([res.merged, data?.bucket_id]).toEqual([true, b]);
  });

  it('Leader_CanPutAnEventInABucket_AndTheEventsOwnRowsMoveWithIt', async () => {
    const old = (await createBucketAction(`${P} Title Bucket`)).bucket!.id;
    const want = (await createBucketAction(`${P} Fall '26`)).bucket!.id;
    const id = await row({ calendar_entry_id: event.calendarEntryId, bucket_id: old });
    const res = await setEventBucketAction(event.calendarEntryId, want);
    const [{ data: c }, { data: t }] = await Promise.all([
      admin.from('calendar_entries').select('bucket_id').eq('id', event.calendarEntryId).single(),
      admin.from('financial_transactions').select('bucket_id').eq('id', id).single()
    ]);
    expect([res.moved, c?.bucket_id, t?.bucket_id]).toEqual([1, want, want]);
  });
});

describe('buckets manager', () => {
  it('BucketList_CarriesEachBucketsTransactionCount_AndItsEvents', async () => {
    const id = (await createBucketAction(`${P} Usage`)).bucket!.id;
    await row({ bucket_id: id });
    await setEventBucketAction(event.calendarEntryId, id);
    const b = (await listBucketsAction()).find((x) => x.id === id)!;
    expect([b.rowCount, b.events.map((e) => e.id)]).toEqual([1, [event.calendarEntryId]]);
  });

  it('Treasurer_CanDeleteAnEmptyBucket', async () => {
    const id = (await createBucketAction(`${P} Empty`)).bucket!.id;
    const res = await deleteBucketAction(id);
    const { data } = await admin.from('buckets').select('id').eq('id', id);
    expect([res.ok, data?.length]).toEqual([true, 0]);
  });

  it('DeleteBucket_RefusesABucketThatHoldsTransactions', async () => {
    const id = (await createBucketAction(`${P} Busy`)).bucket!.id;
    await row({ bucket_id: id });
    const res = await deleteBucketAction(id);
    expect(res.error).toMatch(/transaction/);
  });

  it('DeleteBucket_RefusesABucketAnEventPointsAt', async () => {
    const id = (await createBucketAction(`${P} Linked`)).bucket!.id;
    await admin.from('calendar_entries').update({ bucket_id: id }).eq('id', event.calendarEntryId);
    const res = await deleteBucketAction(id);
    expect(res.error).toMatch(/event/);
  });
});
