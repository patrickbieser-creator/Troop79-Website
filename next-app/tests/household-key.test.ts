import { describe, it, expect } from 'vitest';
import { storedHouseholdId, storedHouseholdKey } from '../src/lib/households';

/**
 * Patrick, 2026-08-25: the roster's Resend logged "No deliverable addresses"
 * — the action looked the household up as `household:<id>` while
 * loadHouseholds() keys a stored household as `"<id>"`. One helper each way,
 * so no caller can spell the key by hand again.
 */
describe('storedHouseholdKey', () => {
  it('StoredHouseholdKey_RoundTrips_ThroughStoredHouseholdId', () => {
    expect(storedHouseholdId(storedHouseholdKey(5))).toBe(5);
  });

  it('StoredHouseholdKey_IsTheBareId_NotAPrefixedForm', () => {
    expect(storedHouseholdKey(12)).toBe('12');
    expect(storedHouseholdId('household:12')).toBeNull();
  });
});
