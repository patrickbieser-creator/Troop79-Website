import { describe, it, expect } from 'vitest';
import {
  addDays,
  healthNeeds,
  healthStanding,
  inTripWindow,
  needsAttention,
  addMonths,
  effectiveOn,
  expiresOn,
  healthFileProblem,
  HEALTH_MAX_BYTES,
  kindStatus,
  nextPage,
  pageName,
  personStatus,
  signedDateProblem,
  sniffHealthType,
  validPage,
  type HealthKind,
  type HealthPage
} from '../src/lib/health-records';

/** Health records: the pure rules (Plans/Health-Forms.md). */
const TODAY = '2026-11-13';
let n = 0;
const page = (kind: HealthKind, p: number, over: Partial<HealthPage> = {}): HealthPage => ({
  id: `id-${(n += 1)}`,
  personId: 1,
  kind,
  page: p,
  contentType: 'image/jpeg',
  uploadedAt: '2026-11-01T12:00:00Z',
  effectiveOn: null,
  expiresOn: null,
  ...over
});
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PDF = new TextEncoder().encode('%PDF-1.7 rest');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

describe('expiry', () => {
  it('Expiry_IsTwelveMonths_FromTheLaterSignatureDate', () => {
    expect(expiresOn(effectiveOn('2026-03-01', '2026-03-04'))).toBe('2027-03-04');
  });

  it('Effective_WithOneDate_IsThatDate', () => {
    expect(effectiveOn(null, '2026-03-04')).toBe('2026-03-04');
  });

  it('Effective_WithNoDates_IsNull', () => {
    expect([effectiveOn(null, ''), expiresOn(null)]).toEqual([null, null]);
  });

  it('AddMonths_ClampsToTheMonthsLastDay', () => {
    expect([addMonths('2024-02-29', 12), addMonths('2026-01-31', 1)]).toEqual(['2025-02-28', '2026-02-28']);
  });

  it('SignedDate_InTheFuture_IsRefused', () => {
    expect([signedDateProblem('2026-11-14', TODAY) != null, signedDateProblem('2026-11-13', TODAY), signedDateProblem(null, TODAY)]).toEqual([true, null, null]);
  });
});

describe('status', () => {
  it('Status_IsMissing_WithNoPages', () => {
    expect(kindStatus('bsa_ab', [], TODAY)).toBe('missing');
  });

  it('Status_IsOnFile_WithAPageAndNoDate', () => {
    expect(kindStatus('bsa_ab', [page('bsa_ab', 1)], TODAY)).toBe('on_file');
  });

  it('Status_IsExpired_AfterTwelveMonths', () => {
    expect(kindStatus('bsa_ab', [page('bsa_ab', 1, { expiresOn: '2026-11-12' })], TODAY)).toBe('expired');
  });

  it('Status_IsExpiresSoon_WithinSixtyDays', () => {
    expect([kindStatus('bsa_ab', [page('bsa_ab', 1, { expiresOn: '2027-01-12' })], TODAY), kindStatus('bsa_ab', [page('bsa_ab', 1, { expiresOn: '2027-01-13' })], TODAY)]).toEqual(['expires_soon', 'on_file']);
  });

  it('InsuranceCard_WithOneSide_IsStillMissing', () => {
    expect([kindStatus('insurance', [page('insurance', 1)], TODAY), kindStatus('insurance', [page('insurance', 1), page('insurance', 2)], TODAY)]).toEqual(['missing', 'on_file']);
  });

  it('Person_IsOnFile_WithTheFormAndBothSidesOfTheCard_PartCNotNeeded', () => {
    expect(personStatus([page('bsa_ab', 1), page('insurance', 1), page('insurance', 2)], TODAY)).toBe('on_file');
  });

  it('Person_ReadsTheWorstOfWhatEveryOutingNeeds', () => {
    expect(personStatus([page('bsa_ab', 1, { expiresOn: '2026-01-01' }), page('insurance', 1)], TODAY)).toBe('missing');
  });
});

describe('the trip window', () => {
  it('TripLeader_CanView_FromSevenDaysBefore_ToTwoDaysAfter', () => {
    const on = (today: string) => inTripWindow('2026-11-20', '2026-11-22', today);
    expect([on('2026-11-12'), on('2026-11-13'), on('2026-11-24'), on('2026-11-25')]).toEqual([false, true, true, false]);
  });

  it('AOneDayEvent_EndsItsWindowTwoDaysAfterThatDay', () => {
    expect([inTripWindow('2026-11-20', null, '2026-11-22'), inTripWindow('2026-11-20', null, '2026-11-23')]).toEqual([true, false]);
  });

  it('AddDays_CrossesMonthsAndYears', () => {
    expect([addDays('2026-12-30', 3), addDays('2026-03-01', -1)]).toEqual(['2027-01-02', '2026-02-28']);
  });
});

describe('standing for an outing', () => {
  const base = [page('bsa_ab', 1), page('insurance', 1), page('insurance', 2)];
  const stand = (pages: HealthPage[], over: Partial<{ reviewed: boolean; needsPartC: boolean; asOf: string }> = {}) =>
    healthStanding(pages, { reviewed: false, needsPartC: false, today: TODAY, ...over });

  it('Complete_RequiresBsaFormInsuranceAndAReview', () => {
    expect([stand(base), stand(base, { reviewed: true })]).toEqual(['ready', 'complete']);
  });

  it('Complete_NeedsPartC_OnlyWhenTheEventNeedsIt', () => {
    expect([stand(base, { reviewed: true, needsPartC: true }), stand([...base, page('bsa_c', 1)], { reviewed: true, needsPartC: true })]).toEqual(['missing', 'complete']);
  });

  it('AReview_NeverHidesAMissingFile', () => {
    expect(stand([page('bsa_ab', 1)], { reviewed: true })).toBe('missing');
  });

  it('AFormThatRunsOutBeforeTheTripEnds_IsExpiredForThatTrip', () => {
    const pages = [page('bsa_ab', 1, { expiresOn: '2027-03-01' }), page('insurance', 1), page('insurance', 2)];
    expect([stand(pages, { reviewed: true }), stand(pages, { reviewed: true, asOf: '2027-03-02' })]).toEqual(['complete', 'expired']);
  });

  it('OnlyComplete_NeedsNoAttention', () => {
    expect((['missing', 'expired', 'expires_soon', 'ready', 'complete'] as const).map(needsAttention)).toEqual([true, true, true, true, false]);
  });
});

describe('what a family still has to hand in', () => {
  const opts = { needsPartC: false, today: TODAY };

  it('NothingOnFile_NeedsTheFormAndTheCard', () => {
    expect(healthNeeds([], opts)).toEqual(['BSA health form, Parts A and B: missing', 'Insurance card: missing']);
  });

  it('EverythingIn_NeedsNothing_WhetherOrNotItWasReviewed', () => {
    expect(healthNeeds([page('bsa_ab', 1), page('insurance', 1), page('insurance', 2)], opts)).toEqual([]);
  });

  it('OneSideOfTheCard_NamesTheOtherSide', () => {
    expect(healthNeeds([page('bsa_ab', 1), page('insurance', 1)], opts)).toEqual(['Insurance card: the back is missing']);
  });

  it('PartC_IsAskedFor_OnlyWhenTheTripNeedsIt', () => {
    const pages = [page('bsa_ab', 1), page('insurance', 1), page('insurance', 2)];
    expect(healthNeeds(pages, { ...opts, needsPartC: true })).toEqual(['BSA health form, Part C: missing']);
  });

  it('AFormThatRanOut_SaysWhen', () => {
    const pages = [page('bsa_ab', 1, { expiresOn: '2026-10-01' }), page('insurance', 1), page('insurance', 2)];
    expect(healthNeeds(pages, opts, (d) => `<${d}>`)).toEqual(['BSA health form, Parts A and B: ran out <2026-10-01>']);
  });

  it('AFormThatRunsOutDuringTheTrip_IsFlaggedForThatTrip', () => {
    const pages = [page('bsa_ab', 1, { expiresOn: '2026-11-21' }), page('insurance', 1), page('insurance', 2)];
    expect([healthNeeds(pages, opts).length, healthNeeds(pages, { ...opts, asOf: '2026-11-22' })[0]]).toEqual([0, 'BSA health form, Parts A and B: runs out 2026-11-21, before the trip ends']);
  });
});

describe('pages', () => {
  it('NextPage_IsTheFirstFreeSlot', () => {
    expect(nextPage('bsa_ab', [page('bsa_ab', 1), page('bsa_ab', 3)])).toBe(2);
  });

  it('NextPage_OfAFullDocument_IsNull', () => {
    expect(nextPage('insurance', [page('insurance', 1), page('insurance', 2)])).toBeNull();
  });

  it('PageName_OfAnInsuranceCard_IsFrontAndBack', () => {
    expect([pageName('insurance', 1), pageName('insurance', 2), pageName('bsa_ab', 2)]).toEqual(['Front', 'Back', 'Page 2']);
  });

  it('ValidPage_RefusesOutsideTheDocument', () => {
    expect([validPage('insurance', 3), validPage('bsa_ab', 0), validPage('bsa_ab', 1.5), validPage('bsa_ab', 6)]).toEqual([false, false, false, true]);
  });
});

describe('files', () => {
  it('Sniff_ReadsTheRealType_FromTheFirstBytes', () => {
    expect([sniffHealthType(JPEG), sniffHealthType(PDF), sniffHealthType(PNG)]).toEqual(['image/jpeg', 'application/pdf', 'image/png']);
  });

  it('Upload_RejectsWrongType', () => {
    expect(healthFileProblem(new TextEncoder().encode('<html>not a photo</html>'))).toMatch(/isn’t a photo or a PDF/);
  });

  it('Upload_RejectsOversize', () => {
    const big = new Uint8Array(HEALTH_MAX_BYTES + 1);
    big.set(JPEG);
    expect(healthFileProblem(big)).toMatch(/too big/);
  });

  it('Upload_RejectsAnEmptyFile', () => {
    expect(healthFileProblem(new Uint8Array())).toMatch(/empty/);
  });

  it('Upload_AcceptsAPhoto', () => {
    expect(healthFileProblem(JPEG)).toBeNull();
  });
});
