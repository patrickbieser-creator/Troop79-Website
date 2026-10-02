import { describe, it, expect } from 'vitest';
import { actualChanged, paidSavedSentence, paidVerdict, pricedActuals } from '../src/lib/menu-monster/paid-view';

/** "What you paid" verdict lines (Phase 2 release B): the band prediction the scout reads before saving. */

const BOOK = { price: 5.99, yield: 10 };
const entry = (pricePaid: number, packageId = 'p1') => ({ packageId, qty: 2, pricePaid });

describe('paidVerdict', () => {
  it('Scout_SeesNotEnteredYet_WhenNothingIsTyped', () => {
    expect(paidVerdict(BOOK, undefined, false)).toMatchObject({ text: 'Not entered yet', entered: false, tag: null });
  });

  it('Scout_SeesItMatchesTheBook_WhenThePriceIsTheSame', () => {
    expect(paidVerdict(BOOK, entry(5.99), true).text).toBe('Matches the price book ($5.99).');
  });

  it('Scout_SeesTheBookWillChange_WhenThePriceIsInsideTheBand', () => {
    const v = paidVerdict(BOOK, entry(6.49), true);
    expect(v.text).toBe('When you save, the troop price book changes $5.99 → $6.49, credited to you.');
    expect(v.tag).toBe('book');
  });

  it('Scout_SeesALeaderWillCheck_WhenThePriceIsFarOut', () => {
    const v = paidVerdict(BOOK, entry(12.99), true);
    expect(v.text).toBe('$12.99 is far from the usual $5.99. A leader will check it. Bought a different package? Pick it above.');
    expect([v.tag, v.held]).toEqual(['held', true]);
  });

  it('Scout_SeesHeldForALeader_AfterASaveThatHeldTheLine', () => {
    const v = paidVerdict(BOOK, entry(12.99), false, 'held');
    expect([v.tag, v.held, v.text]).toEqual(['held', true, 'Held for a leader to check. Different size, or a typo?']);
  });

  it('Scout_SeesUpdated_AfterASaveThatAppliedTheLine', () => {
    const v = paidVerdict({ price: 6.49, yield: 10 }, entry(6.49), false, 'applied');
    expect(v.tag).toBe('updated');
    expect(v.text).toBe('The troop price book now says $6.49, credited to you.');
  });

  it('Scout_SeesTheLiveVerdict_WhenALineIsEditedAfterASave', () => {
    expect(paidVerdict(BOOK, entry(12.99), true, 'applied').tag).toBe('held');
  });

  it('Scout_SeesKeptOnTheMenu_WhenSavedEarlierAndTheBookMovedInsideTheBand', () => {
    expect(paidVerdict(BOOK, entry(6.49), false)).toMatchObject({ text: 'Kept on your menu.', tag: null });
  });

  it('Scout_SeesKeptOnTheMenu_WhenThePackageIsGone', () => {
    expect(paidVerdict(undefined, entry(6.49), true).text).toBe('Kept on your menu.');
  });

  it('Scout_SeesALeaderWillCheck_WhenThePackageHasNoUsableYield', () => {
    expect(paidVerdict({ price: 8, yield: null }, entry(8.5), true).held).toBe(true);
  });
});

describe('actualChanged', () => {
  it.each([
    ['same price and package', entry(3), entry(3), false],
    ['a new price', entry(4), entry(3), true],
    ['a new package', entry(3, 'p2'), entry(3), true],
    ['a new entry', entry(3), undefined, true],
    ['a removed entry', undefined, entry(3), true],
    ['nothing either side', undefined, undefined, false]
  ])('Line_IsChanged_%s', (_n, draft, saved, expected) => {
    expect(actualChanged(draft, saved)).toBe(expected);
  });

  it('Line_IsNotChanged_WhenOnlyTheQuantityMoved', () => {
    expect(actualChanged({ ...entry(3), qty: 9 }, entry(3))).toBe(false);
  });
});

describe('pricedActuals', () => {
  it('Draft_KeepsOnlyEntriesWithAPrice', () => {
    expect(pricedActuals({ a: { packageId: 'p', qty: 1, pricePaid: 2 }, b: { packageId: 'p', qty: 1, pricePaid: null } })).toEqual({ a: { packageId: 'p', qty: 1, pricePaid: 2 } });
  });
});

describe('paidSavedSentence', () => {
  it.each([
    [2, 1, 'Saved. 2 prices updated for every patrol, credited to you; 1 held for a leader.'],
    [1, 0, 'Saved. 1 price updated for every patrol, credited to you.'],
    [0, 3, 'Saved. 3 held for a leader.'],
    [0, 0, 'Saved.']
  ])('Scout_IsTold_%i_applied_%i_held', (a, h, text) => {
    expect(paidSavedSentence(a, h)).toBe(text);
  });
});
