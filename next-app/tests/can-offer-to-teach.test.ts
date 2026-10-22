import { describe, it, expect } from 'vitest';
import { canOfferToTeach, NOT_A_TEACHER } from '../src/lib/can-offer-to-teach';

/**
 * Who among the scouts may offer to teach (Plans/Meeting-Requests-And-Teaching-Offers.md, Decision 11 / Q-D): any
 * First Class+ scout, always; otherwise a Junior Leader — grade 9–12 as of the meeting date unless the roster override
 * says 'no', or anyone the override says 'yes'. Adults still decide who actually teaches. Pure; no database.
 */
const FIRST_CLASS = 4;
// Meeting on 2026-10-25: the 2026–27 school year ends 2027, so class of 2030 is grade 9, class of 2031 grade 8.
const on = '2026-10-25';
const scout = (over: Partial<Parameters<typeof canOfferToTeach>[0]> = {}) => ({
  rankSortOrder: 3 as number | null,
  firstClassSortOrder: FIRST_CLASS,
  graduationYear: 2031 as number | null,
  override: null as 'yes' | 'no' | null,
  onDate: on,
  ...over
});

describe('canOfferToTeach', () => {
  it('JuniorLeader_FirstClassScout_CanAlwaysOfferToTeach_EvenWithOverrideNo', () => {
    expect(canOfferToTeach(scout({ rankSortOrder: FIRST_CLASS, override: 'no' }))).toBe(true);
  });

  it('JuniorLeader_GradeNineScout_ExcludedOnlyByOverrideNo', () => {
    expect([canOfferToTeach(scout({ graduationYear: 2030 })), canOfferToTeach(scout({ graduationYear: 2030, override: 'no' }))]).toEqual([true, false]);
  });

  it('JuniorLeader_YoungerScout_IncludedByOverrideYes', () => {
    expect([canOfferToTeach(scout()), canOfferToTeach(scout({ override: 'yes' }))]).toEqual([false, true]);
  });

  it('JuniorLeader_UnrankedYoungScout_CannotOffer', () => {
    expect(canOfferToTeach(scout({ rankSortOrder: null, graduationYear: null }))).toBe(false);
  });
});

describe('the can’t-teach message', () => {
  // One message for Meeting Live and the member teach page, and it names this file's rule: adults, Junior Leaders, First Class+.
  it('NotATeacher_StatesTheRule', () => {
    expect(NOT_A_TEACHER).toBe('Only adults, Junior Leaders, and scouts at First Class or above can teach.');
  });
});
