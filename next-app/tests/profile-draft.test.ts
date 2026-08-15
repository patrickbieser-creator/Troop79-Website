import { describe, it, expect } from 'vitest';
import {
  displayValue,
  draftDelta,
  draftFromValues,
  effectiveValues,
  pendingFields
} from '../src/lib/profile-draft';
import type { ChangeRequestRow } from '../src/lib/change-requests';

/**
 * The live / effective / draft model behind the /profile editors
 * (lib/profile-draft.ts). Pure functions, so this sits in the `db` project
 * with the other unit tests rather than the jsdom one — the rendering half is
 * profile-household.test.tsx.
 *
 * The rule worth pinning down is that `effective` — not `live` — is what a
 * draft is measured against. Measuring against `live` is what would let a form
 * that already displays a pending proposal keep offering to submit it again.
 */

const FIELDS = ['city', 'state', 'graduation_year'] as const;

function pending(proposed: ChangeRequestRow['proposed_changes']): ChangeRequestRow {
  return {
    id: 1,
    entity_type: 'scout',
    entity_id: 'mtest',
    submitted_by_person_id: null,
    submitted_at: '2026-08-15T00:00:00.000Z',
    proposed_changes: proposed,
    status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
    rejection_reason: null
  };
}

describe('displayValue', () => {
  it('renders an absent value as an empty input rather than the string "null"', () => {
    expect(displayValue(null)).toBe('');
    expect(displayValue(undefined)).toBe('');
  });

  it('stringifies the one numeric field so it round-trips back through the diff', () => {
    expect(displayValue(2031)).toBe('2031');
  });
});

describe('effectiveValues', () => {
  const live = { city: 'Milwaukee', state: 'WI', graduation_year: 2031 };

  it('is the live record when nothing is pending', () => {
    expect(effectiveValues(FIELDS, live, null)).toEqual(live);
  });

  it('overlays only the fields a pending request actually proposes', () => {
    expect(effectiveValues(FIELDS, live, pending({ city: 'Shorewood' }))).toEqual({
      city: 'Shorewood',
      state: 'WI',
      graduation_year: 2031
    });
  });

  it('keeps a proposal that CLEARS a field, rather than falling back to the live value', () => {
    // `null` is a real proposed value — "delete what's on record" — and `??`
    // against the live row would silently discard it.
    expect(effectiveValues(FIELDS, live, pending({ state: null })).state).toBeNull();
  });

  it('ignores a key outside the field list, so stored jsonb cannot invent a field', () => {
    const out = effectiveValues(FIELDS, live, pending({ active: 'false', city: 'Bayside' }));
    expect(out).not.toHaveProperty('active');
    expect(out.city).toBe('Bayside');
  });

  it('reports an absent field as null rather than undefined', () => {
    expect(effectiveValues(FIELDS, {}, null)).toEqual({
      city: null,
      state: null,
      graduation_year: null
    });
  });
});

describe('draftFromValues', () => {
  it('turns a record into the strings its inputs hold', () => {
    expect(draftFromValues(FIELDS, { city: 'Milwaukee', state: null, graduation_year: 2031 })).toEqual(
      { city: 'Milwaukee', state: '', graduation_year: '2031' }
    );
  });
});

describe('draftDelta', () => {
  const effective = { city: 'Shorewood', state: 'WI', graduation_year: 2031 };

  it('is empty when the form matches what is already live-or-queued', () => {
    // This is what disables the submit button — a form showing a pending
    // proposal has nothing further to send.
    const draft = draftFromValues(FIELDS, effective);
    expect(draftDelta(FIELDS, draft, effective)).toEqual({});
  });

  it('reports a field edited past the pending value', () => {
    const draft = { ...draftFromValues(FIELDS, effective), city: 'Bayside' };
    expect(draftDelta(FIELDS, draft, effective)).toEqual({ city: 'Bayside' });
  });

  it('ignores whitespace-only difference, the same way the server diff does', () => {
    const draft = { ...draftFromValues(FIELDS, effective), city: '  Shorewood  ' };
    expect(draftDelta(FIELDS, draft, effective)).toEqual({});
  });

  it('reports a field cleared to empty as a proposed null', () => {
    const draft = { ...draftFromValues(FIELDS, effective), state: '' };
    expect(draftDelta(FIELDS, draft, effective)).toEqual({ state: null });
  });

  it('compares graduation_year as a number, not as its input string', () => {
    const draft = { ...draftFromValues(FIELDS, effective), graduation_year: '2031' };
    expect(draftDelta(FIELDS, draft, effective)).toEqual({});
  });

  it('reports a field edited BACK to the live value while a proposal is queued', () => {
    // Not a no-op from the form's point of view — it differs from what is
    // queued, which is why the submit button lights up. The server then finds
    // an empty diff against the live row and treats it as a withdrawal.
    const live = { city: 'Milwaukee', state: 'WI', graduation_year: 2031 };
    const queued = effectiveValues(FIELDS, live, pending({ city: 'Shorewood' }));
    const draft = draftFromValues(FIELDS, live);
    expect(draftDelta(FIELDS, draft, queued)).toEqual({ city: 'Milwaukee' });
  });
});

describe('pendingFields', () => {
  it('is empty when nothing is queued', () => {
    expect(pendingFields(null).size).toBe(0);
  });

  it('names the fields a proposal touches, which is what the form marks', () => {
    expect([...pendingFields(pending({ city: 'Bayside', state: null }))].sort()).toEqual([
      'city',
      'state'
    ]);
  });
});
