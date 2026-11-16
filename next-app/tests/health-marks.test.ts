import { describe, it, expect } from 'vitest';
import { healthMark } from '../src/lib/health-marks';
import type { HealthPage } from '../src/lib/health-records';

/**
 * The admin Health Forms check marks (Plans/Admin-Health-Forms.md, R1): words, not just symbols, and an optional
 * document that isn't there reads "—" rather than a red "Missing" down a whole column.
 */
const TODAY = '2026-11-15';
const page = (kind: HealthPage['kind'], expiresOn: string | null, n = 1): HealthPage => ({
  id: `${kind}-${n}`,
  personId: 1,
  kind,
  page: n,
  contentType: 'image/jpeg',
  uploadedAt: '2026-11-01T12:00:00Z',
  effectiveOn: null,
  expiresOn
});

describe('healthMark', () => {
  it('HealthMark_OptionalMissingReadsDash_RequiredMissingReadsMissing', () => {
    expect([healthMark('bsa_c', [], TODAY).text, healthMark('bsa_ab', [], TODAY).text]).toEqual(['—', 'Missing']);
  });

  it('HealthMark_CurrentReadsCheck', () => {
    expect(healthMark('bsa_ab', [page('bsa_ab', '2027-06-01')], TODAY).text).toBe('✓');
  });

  it('HealthMark_ExpiringWithinSixtyDaysReadsSoon', () => {
    expect(healthMark('bsa_ab', [page('bsa_ab', '2026-12-20')], TODAY).text).toBe('✓ Soon');
  });

  it('HealthMark_PastExpiryReadsExpired', () => {
    expect(healthMark('bsa_ab', [page('bsa_ab', '2026-10-01')], TODAY).text).toBe('Expired');
  });

  it('HealthMark_ScreenReaderTextNamesTheDocumentAndDate', () => {
    expect(healthMark('bsa_ab', [page('bsa_ab', '2026-10-01')], TODAY).srText).toBe('Parts A and B: expired Oct 1, 2026');
  });

  it('HealthMark_SortsWorstFirst', () => {
    const ranks = [
      healthMark('bsa_ab', [], TODAY),
      healthMark('bsa_ab', [page('bsa_ab', '2026-10-01')], TODAY),
      healthMark('bsa_ab', [page('bsa_ab', '2026-12-20')], TODAY),
      healthMark('bsa_ab', [page('bsa_ab', '2027-06-01')], TODAY),
      healthMark('bsa_c', [], TODAY)
    ].map((m) => m.rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });
});
