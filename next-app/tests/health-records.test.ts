import { describe, it, expect } from 'vitest';
import {
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
