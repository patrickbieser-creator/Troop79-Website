import { describe, it, expect } from 'vitest';
import { bucketKey, moneyScopeFor, nearBuckets, sortBucketsForPicker, type Bucket } from '../src/lib/buckets';

const b = (id: number, name: string, extra: Partial<Bucket> = {}): Bucket => ({ id, name, isEvent: false, lastUsed: null, ...extra });

describe('bucketKey (pure)', () => {
  it('BucketKey_IgnoresCaseAndExtraSpaces_LikeTheDatabaseIndex', () => {
    expect(bucketKey('  Can   Drive ')).toBe('can drive');
  });
});

describe('nearBuckets (pure)', () => {
  const all = [b(1, "Summer Camp '26"), b(2, "Summer Camp '27"), b(3, 'Dividends'), b(4, "Can Drive Feb '26")];

  it('Treasurer_SeesNearMatches_BeforeCreatingANewBucket', () => {
    expect(nearBuckets(all, 'summer camp').map((x) => x.id)).toEqual([1, 2]);
  });
  it('NearBuckets_MatchesOnASharedWord_IgnoringTheYear', () => {
    expect(nearBuckets(all, "Dividend '26").map((x) => x.id)).toEqual([3]);
  });
  it('NearBuckets_PutsAnExactNameFirst', () => {
    expect(nearBuckets(all, "summer camp '27")[0].id).toBe(2);
  });
  it('NearBuckets_IsEmpty_ForAGenuinelyNewName', () => {
    expect(nearBuckets(all, 'Popcorn Sale')).toEqual([]);
  });
  it('NearBuckets_ShowsAtMostFive', () => {
    const many = Array.from({ length: 9 }, (_, i) => b(i, `Camp ${i}`));
    expect(nearBuckets(many, 'camp')).toHaveLength(5);
  });
});

describe('sortBucketsForPicker (pure)', () => {
  it('Picker_ListsRecentlyUsedBucketsFirst_ThenTheRestByName', () => {
    const sorted = sortBucketsForPicker([
      b(1, 'Zeta'),
      b(2, "Wreaths '25", { lastUsed: '2025-12-01' }),
      b(3, 'Alpha'),
      b(4, "Wreaths '26", { lastUsed: '2026-10-16' })
    ]);
    expect(sorted.map((x) => x.id)).toEqual([4, 2, 3, 1]);
  });
});

describe('moneyScopeFor (pure)', () => {
  it('MoneyScope_IsTheEntrysBucket_PlusTheRowsLinkedToTheEntry', () => {
    expect(moneyScopeFor(35, 23)).toBe('bucket_id.eq.23,calendar_entry_id.eq.35');
  });
  it('MoneyScope_IsTheEntrysOwnRows_WhenItHasNoBucket', () => {
    expect(moneyScopeFor(35, null)).toBe('calendar_entry_id.eq.35');
  });
});
