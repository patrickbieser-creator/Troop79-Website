import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestEvent, deleteTestEvent, createTestScout, deleteTestScout, TEST_PREFIX, type TestEvent, type TestScout } from './helpers/signup-fixtures';

/**
 * Buckets (Plans/Buckets-Lookup.md, Release 1): the managed lookup every money
 * row and calendar entry points at. Until the label column is dropped, a sync
 * trigger keeps activity_label and bucket_id in step so a writer that still
 * sends text (wreath RPCs, event-fee actions, imports) can't leave a gap.
 * Test-owned names only — every bucket here starts with TEST_PREFIX.
 */
const admin = adminClient();
const P = `${TEST_PREFIX} bucket`;
let event: TestEvent;
let scout: TestScout;

async function bucket(name: string): Promise<number> {
  const { data, error } = await admin.from('buckets').insert({ name }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  return data.id as number;
}
async function entry(): Promise<number> {
  const { data, error } = await admin
    .from('signup_entries')
    .insert({ event_signup_id: event.eventSignupId, status: 'yes', person_kind: 'scout', person_id: scout.personId })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message);
  return data.id as number;
}
async function row(extra: Record<string, unknown>) {
  const { data, error } = await admin
    .from('financial_transactions')
    .insert({ occurred_on: '2026-09-01', account: 'checking', amount: 10, kind: 'donation', memo: P, ...extra })
    .select('id, bucket_id, activity_label')
    .single();
  if (error || !data) throw new Error(error?.message);
  return data as { id: number; bucket_id: number | null; activity_label: string | null };
}

beforeAll(async () => {
  event = await createTestEvent(admin);
  scout = await createTestScout(admin, 'Bucket');
});
afterEach(async () => {
  await admin.from('financial_transactions').delete().eq('memo', P);
  await admin.from('signup_entries').delete().eq('event_signup_id', event.eventSignupId);
  await admin.from('calendar_entries').update({ bucket_id: null }).eq('id', event.calendarEntryId);
  await admin.from('buckets').delete().like('name', `${TEST_PREFIX}%`);
});
afterAll(async () => {
  await deleteTestEvent(admin, event);
  await deleteTestScout(admin, scout);
});

describe('buckets table', () => {
  it('Treasurer_CannotCreate_ADuplicateBucketName_IgnoringCaseAndSpaces', async () => {
    await bucket(`${P} Can  Drive`);
    const { error } = await admin.from('buckets').insert({ name: `${P.toLowerCase()} can drive ` });
    expect(error?.code).toBe('23505');
  });
});

describe('sync trigger', () => {
  it('LabelOnlyInsert_GetsItsBucketId_FromTheSyncTrigger', async () => {
    const id = await bucket(`${P} Wreaths`);
    const r = await row({ activity_label: `${P} wreaths` });
    expect(r.bucket_id).toBe(id);
  });

  it('LabelOnlyInsert_WritesTheBucketsOwnSpelling_IntoTheLabel', async () => {
    await bucket(`${P} Wreaths`);
    const r = await row({ activity_label: `${P}  wreaths` });
    expect(r.activity_label).toBe(`${P} Wreaths`);
  });

  it('LabelOnlyInsert_WithAnUnknownLabel_CreatesTheBucket', async () => {
    const r = await row({ activity_label: `${P} Brand New` });
    const { data } = await admin.from('buckets').select('name').eq('id', r.bucket_id!).single();
    expect(data?.name).toBe(`${P} Brand New`);
  });

  it('BucketIdInsert_WritesTheBucketNameIntoTheLabel', async () => {
    const id = await bucket(`${P} Dividends`);
    const r = await row({ bucket_id: id });
    expect(r.activity_label).toBe(`${P} Dividends`);
  });

  it('UnlabelledRow_WithNoEvent_StaysOutOfEveryBucket', async () => {
    const r = await row({});
    expect(r.bucket_id).toBeNull();
  });

  it('EventFeePayment_CarriesTheEventsBucket_OverTheEventTitle', async () => {
    const id = await bucket(`${P} High Cliff`);
    await admin.from('calendar_entries').update({ bucket_id: id }).eq('id', event.calendarEntryId);
    const r = await row({ kind: 'event_fee', calendar_entry_id: event.calendarEntryId, activity_label: `${TEST_PREFIX} fixture event` });
    expect([r.bucket_id, r.activity_label]).toEqual([id, `${P} High Cliff`]);
  });

  it('FeeRow_ForAnEventWithNoBucket_LinksTheEvent_ToTheBucketItsLabelNames', async () => {
    const r = await row({ kind: 'event_fee', calendar_entry_id: event.calendarEntryId, activity_label: `${P} New Campout`, signup_entry_id: await entry() });
    const { data } = await admin.from('calendar_entries').select('bucket_id').eq('id', event.calendarEntryId).single();
    expect(data?.bucket_id).toBe(r.bucket_id);
  });

  it('ClearingTheBucket_OnAnEventLinkedRow_StaysCleared', async () => {
    const id = await bucket(`${P} Event`);
    await admin.from('calendar_entries').update({ bucket_id: id }).eq('id', event.calendarEntryId);
    const r = await row({ calendar_entry_id: event.calendarEntryId });
    const { data } = await admin.from('financial_transactions').update({ bucket_id: null }).eq('id', r.id).select('bucket_id, activity_label').single();
    expect([r.bucket_id, data?.bucket_id, data?.activity_label]).toEqual([id, null, null]);
  });

  it('NonFeeRow_OnAnEventWithNoBucket_DoesNotClaimTheBucketForTheEvent', async () => {
    await row({ calendar_entry_id: event.calendarEntryId, activity_label: `${P} Gas` });
    const { data } = await admin.from('calendar_entries').select('bucket_id').eq('id', event.calendarEntryId).single();
    expect(data?.bucket_id).toBeNull();
  });

  it('RelabellingARow_MovesItToTheNamedBucket', async () => {
    await bucket(`${P} A`);
    const b = await bucket(`${P} B`);
    const r = await row({ activity_label: `${P} A` });
    const { data } = await admin.from('financial_transactions').update({ activity_label: `${P} B` }).eq('id', r.id).select('bucket_id').single();
    expect(data?.bucket_id).toBe(b);
  });
});

describe('rename and merge', () => {
  it('Treasurer_CanRenameABucket_AndHistoryShowsTheNewName', async () => {
    const id = await bucket(`${P} Old`);
    const r = await row({ bucket_id: id });
    await admin.from('buckets').update({ name: `${P} New` }).eq('id', id);
    const { data } = await admin.from('financial_transactions').select('activity_label').eq('id', r.id).single();
    expect(data?.activity_label).toBe(`${P} New`);
  });

  it('Treasurer_CanMergeBuckets_AndEveryRowAndCalendarEntryMoves_InOneTransaction', async () => {
    const from = await bucket(`${P} From`);
    const into = await bucket(`${P} Into`);
    const r = await row({ bucket_id: from });
    await admin.from('calendar_entries').update({ bucket_id: from }).eq('id', event.calendarEntryId);
    const { data: moved, error } = await admin.rpc('merge_buckets', { p_from: from, p_into: into });
    expect(error).toBeNull();
    const [{ data: t }, { data: c }, { data: gone }] = await Promise.all([
      admin.from('financial_transactions').select('bucket_id, activity_label').eq('id', r.id).single(),
      admin.from('calendar_entries').select('bucket_id').eq('id', event.calendarEntryId).single(),
      admin.from('buckets').select('id').eq('id', from)
    ]);
    expect([moved, t?.bucket_id, t?.activity_label, c?.bucket_id, gone?.length]).toEqual([1, into, `${P} Into`, into, 0]);
  });

  it('MergeBuckets_RefusesToMergeABucketIntoItself', async () => {
    const id = await bucket(`${P} Same`);
    const { error } = await admin.rpc('merge_buckets', { p_from: id, p_into: id });
    expect(error).not.toBeNull();
  });
});

describe('backfill', () => {
  it('Backfill_LeavesNoLabelledRowWithoutABucket', async () => {
    const { count } = await admin
      .from('financial_transactions')
      .select('id', { count: 'exact', head: true })
      .not('activity_label', 'is', null)
      .neq('activity_label', '')
      .is('bucket_id', null);
    expect(count).toBe(0);
  });
});
