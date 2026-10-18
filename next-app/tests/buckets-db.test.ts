import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestEvent, deleteTestEvent, TEST_PREFIX, type TestEvent } from './helpers/signup-fixtures';

/**
 * Buckets (Plans/Buckets-Lookup.md): the managed lookup every money row and
 * calendar entry points at. Since Release 2 there is no label column: writers
 * send bucket_id (bucket_id_for_name / event_bucket resolve one from text or
 * an event), and a row linked to an event with no bucket takes the event's.
 * Test-owned names only — every bucket here starts with TEST_PREFIX.
 */
const admin = adminClient();
const P = `${TEST_PREFIX} bucket`;
let event: TestEvent;

async function bucket(name: string): Promise<number> {
  const { data, error } = await admin.from('buckets').insert({ name }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  return data.id as number;
}
async function row(extra: Record<string, unknown>) {
  const { data, error } = await admin
    .from('financial_transactions')
    .insert({ occurred_on: '2026-09-01', account: 'checking', amount: 10, kind: 'donation', memo: P, ...extra })
    .select('id, bucket_id')
    .single();
  if (error || !data) throw new Error(error?.message);
  return data as { id: number; bucket_id: number | null };
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

describe('buckets table', () => {
  it('Treasurer_CannotCreate_ADuplicateBucketName_IgnoringCaseAndSpaces', async () => {
    await bucket(`${P} Can  Drive`);
    const { error } = await admin.from('buckets').insert({ name: `${P.toLowerCase()} can drive ` });
    expect(error?.code).toBe('23505');
  });
});

describe('event bucket trigger', () => {
  it('UnlinkedRow_WithNoEvent_StaysOutOfEveryBucket', async () => {
    const r = await row({});
    expect(r.bucket_id).toBeNull();
  });

  it('EventLinkedRow_WithNoBucket_TakesTheEventsBucket', async () => {
    const id = await bucket(`${P} High Cliff`);
    await admin.from('calendar_entries').update({ bucket_id: id }).eq('id', event.calendarEntryId);
    const r = await row({ kind: 'event_fee', calendar_entry_id: event.calendarEntryId });
    expect(r.bucket_id).toBe(id);
  });

  it('EventLinkedRow_KeepsTheBucketItWasGiven', async () => {
    const own = await bucket(`${P} Gas`);
    await admin.from('calendar_entries').update({ bucket_id: await bucket(`${P} Event`) }).eq('id', event.calendarEntryId);
    const r = await row({ calendar_entry_id: event.calendarEntryId, bucket_id: own });
    expect(r.bucket_id).toBe(own);
  });

  it('ClearingTheBucket_OnAnEventLinkedRow_StaysCleared', async () => {
    const id = await bucket(`${P} Event`);
    await admin.from('calendar_entries').update({ bucket_id: id }).eq('id', event.calendarEntryId);
    const r = await row({ calendar_entry_id: event.calendarEntryId });
    const { data } = await admin.from('financial_transactions').update({ bucket_id: null }).eq('id', r.id).select('bucket_id').single();
    expect([r.bucket_id, data?.bucket_id]).toEqual([id, null]);
  });

  it('LinkingARowToAnEvent_GivesItTheEventsBucket', async () => {
    const id = await bucket(`${P} Event`);
    await admin.from('calendar_entries').update({ bucket_id: id }).eq('id', event.calendarEntryId);
    const r = await row({});
    const { data } = await admin.from('financial_transactions').update({ calendar_entry_id: event.calendarEntryId }).eq('id', r.id).select('bucket_id').single();
    expect(data?.bucket_id).toBe(id);
  });
});

describe('bucket resolvers', () => {
  it('BucketIdForName_FindsTheBucket_IgnoringCaseAndSpaces', async () => {
    const id = await bucket(`${P} Wreaths`);
    const { data } = await admin.rpc('bucket_id_for_name', { p_name: `  ${P.toLowerCase()}   wreaths ` });
    expect(data).toBe(id);
  });

  it('BucketIdForName_CreatesAnUnknownName', async () => {
    const { data: id } = await admin.rpc('bucket_id_for_name', { p_name: `${P}  Brand New` });
    const { data } = await admin.from('buckets').select('name').eq('id', id as number).single();
    expect(data?.name).toBe(`${P} Brand New`);
  });

  it('BucketIdForName_IsNull_ForABlankName', async () => {
    const { data } = await admin.rpc('bucket_id_for_name', { p_name: '   ' });
    expect(data).toBeNull();
  });

  it('EventBucket_IsTheEventsOwnBucket', async () => {
    const id = await bucket(`${P} High Cliff`);
    await admin.from('calendar_entries').update({ bucket_id: id }).eq('id', event.calendarEntryId);
    const { data } = await admin.rpc('event_bucket', { p_calendar_entry_id: event.calendarEntryId });
    expect(data).toBe(id);
  });

  it('EventBucket_ForAnEventWithNoBucket_MakesOneFromItsTitle_AndLinksIt', async () => {
    const { data: id } = await admin.rpc('event_bucket', { p_calendar_entry_id: event.calendarEntryId });
    const [{ data: b }, { data: c }] = await Promise.all([
      admin.from('buckets').select('name').eq('id', id as number).single(),
      admin.from('calendar_entries').select('title, bucket_id').eq('id', event.calendarEntryId).single()
    ]);
    expect([b?.name, c?.bucket_id]).toEqual([c?.title, id]);
  });
});

describe('rename and merge', () => {
  it('Treasurer_CanRenameABucket_AndHistoryShowsTheNewName', async () => {
    const id = await bucket(`${P} Old`);
    const r = await row({ bucket_id: id });
    await admin.from('buckets').update({ name: `${P} New` }).eq('id', id);
    const { data } = await admin.from('financial_transactions').select('bucket:buckets(name)').eq('id', r.id).single();
    expect(data?.bucket).toEqual({ name: `${P} New` });
  });

  it('Treasurer_CanMergeBuckets_AndEveryRowAndCalendarEntryMoves_InOneTransaction', async () => {
    const from = await bucket(`${P} From`);
    const into = await bucket(`${P} Into`);
    const r = await row({ bucket_id: from });
    await admin.from('calendar_entries').update({ bucket_id: from }).eq('id', event.calendarEntryId);
    const { data: moved, error } = await admin.rpc('merge_buckets', { p_from: from, p_into: into });
    expect(error).toBeNull();
    const [{ data: t }, { data: c }, { data: gone }] = await Promise.all([
      admin.from('financial_transactions').select('bucket_id').eq('id', r.id).single(),
      admin.from('calendar_entries').select('bucket_id').eq('id', event.calendarEntryId).single(),
      admin.from('buckets').select('id').eq('id', from)
    ]);
    expect([moved, t?.bucket_id, c?.bucket_id, gone?.length]).toEqual([1, into, into, 0]);
  });

  it('MergeBuckets_RefusesToMergeABucketIntoItself', async () => {
    const id = await bucket(`${P} Same`);
    const { error } = await admin.rpc('merge_buckets', { p_from: id, p_into: id });
    expect(error).not.toBeNull();
  });
});
