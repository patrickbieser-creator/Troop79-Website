import { describe, it, expect } from 'vitest';
import { readHouseholdLinks } from '../src/lib/household-links';

/**
 * Adding an adult into a household with scouts must say how they relate to each one. A shared household grants
 * nothing (lib/household-scope): only a parent_of/guardian_of link lets a parent manage a child's records, and the
 * Add adult dialog used to create the household membership without one (Kevin Greene, 2026-11-14).
 */
const scouts = [
  { personId: 173, name: 'Miren Greene' },
  { personId: 27, name: 'Oliver Vest' }
];
const from = (entries: Record<string, string>) => (key: string) => entries[key] ?? null;

describe('readHouseholdLinks', () => {
  it('Leader_AddingAdultToHouseholdWithNoScouts_NeedsNoAnswers', () => {
    expect(readHouseholdLinks(from({}), [])).toEqual({ ok: true, links: [] });
  });

  it('Leader_ChoosingParent_RecordsAParentLink', () => {
    const res = readHouseholdLinks(from({ relation_173: 'parent_of', relation_27: 'none' }), scouts);
    expect(res).toEqual({ ok: true, links: [{ personId: 173, type: 'parent_of' }] });
  });

  it('Leader_ChoosingGuardian_RecordsAGuardianLink', () => {
    const res = readHouseholdLinks(from({ relation_173: 'guardian_of', relation_27: 'none' }), scouts);
    expect(res).toEqual({ ok: true, links: [{ personId: 173, type: 'guardian_of' }] });
  });

  it('Leader_ChoosingNeither_RecordsNoLink', () => {
    expect(readHouseholdLinks(from({ relation_173: 'none', relation_27: 'none' }), scouts)).toEqual({ ok: true, links: [] });
  });

  it('Leader_LeavingAScoutUnanswered_IsToldWhichScout', () => {
    const res = readHouseholdLinks(from({ relation_173: 'parent_of' }), scouts);
    expect(res).toEqual({ ok: false, error: 'Say how this person is related to Oliver Vest.' });
  });

  it('Leader_PostingAnUnknownRelation_IsRefused', () => {
    const res = readHouseholdLinks(from({ relation_173: 'sibling_of', relation_27: 'none' }), scouts);
    expect(res.ok).toBe(false);
  });
});
