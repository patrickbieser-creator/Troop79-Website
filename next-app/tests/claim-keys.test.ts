import { describe, it, expect } from 'vitest';
import { positionalToIdentityKey } from '../src/lib/claim-keys';
import type { Household } from '../src/lib/households';

const household = {
  key: '1',
  label: 'Bieser',
  scouts: [{ id: 'A01', displayName: 'Anjali', personId: 23 }],
  adults: [
    { key: 'pe82', personId: 82, name: 'Patrick Bieser', relationship: null, leaderCode: 'PB' },
    { key: 'pe83', personId: 83, name: 'Jamie Lynn Tatera', relationship: 'Parent', leaderCode: null }
  ]
} as unknown as Household;

describe('positionalToIdentityKey', () => {
  it('ExistingClaim_MapsPositionalKey_ToThePersonFirstFormsIdentityKey', () => {
    expect(positionalToIdentityKey(household, 'a1')).toBe('a:pe83');
    expect(positionalToIdentityKey(household, 's0')).toBe('s:A01');
  });
  it('ExistingClaim_IsDropped_WhenThePositionNoLongerExists', () => {
    // A stale index (household shrank) must not print as a chip.
    expect(positionalToIdentityKey(household, 'a2')).toBeNull();
  });
  it('IdentityKey_PassesThrough_Unchanged', () => {
    expect(positionalToIdentityKey(household, 'a:pe82')).toBe('a:pe82');
  });
});
