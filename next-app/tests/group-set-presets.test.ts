import { describe, it, expect } from 'vitest';
import {
  SET_KINDS,
  SET_KIND_LABEL,
  presetSetsFor,
  normalizeSetLabel,
  normalizeGroupName,
  validateNewSet,
  placementPayloadFromForm
} from '../src/lib/group-sets';

/**
 * Event Logistics Phase 2 — the Assignments block presets and the pure
 * validators behind the builder and the family picker (Plans/Event-Logistics.md §B).
 */
describe('presets', () => {
  it('SetKinds_CoverTheSheetColumnsPatrickNamed', () => {
    expect([...SET_KINDS]).toEqual(['patrol', 'crew', 'tent', 'cabin', 'car', 'team', 'meal', 'custom']);
    for (const k of SET_KINDS) expect(SET_KIND_LABEL[k]).toBeTruthy();
  });

  it('PresetSets_MatchCategory_WhenAssignmentsBlockEnabled', () => {
    expect(presetSetsFor('Campout / Overnight').map((p) => [p.kind, p.label, p.seedFromRoster])).toEqual([
      ['patrol', 'Patrols', true],
      ['tent', 'Tents', false]
    ]);
    expect(presetSetsFor('High Adventure').map((p) => p.label)).toEqual(['Crews']);
    expect(presetSetsFor('Summer Camp').map((p) => p.label)).toEqual(['Patrols', 'Tents']);
    expect(presetSetsFor('Service Project').map((p) => p.label)).toEqual(['Teams']);
    expect(presetSetsFor('Fundraiser')).toEqual([]);
    expect(presetSetsFor('Nonsense')).toEqual([]);
  });

  it('PresetSets_NeverIncludeCars_TheyComeFromTheDriversBlock', () => {
    for (const cat of ['Campout / Overnight', 'High Adventure', 'Summer Camp', 'Day Activity / Outing']) {
      expect(presetSetsFor(cat).some((p) => p.kind === 'car')).toBe(false);
    }
  });
});

describe('validators', () => {
  it('NormalizeSetLabel_TrimsCollapsesAndCaps', () => {
    expect(normalizeSetLabel('  Service   teams ')).toBe('Service teams');
    expect(normalizeSetLabel('   ')).toBeNull();
    expect(normalizeSetLabel('x'.repeat(80))?.length).toBe(60);
  });

  it('NormalizeGroupName_SameRules', () => {
    expect(normalizeGroupName(' Tent  3 ')).toBe('Tent 3');
    expect(normalizeGroupName('')).toBeNull();
  });

  it('ValidateNewSet_RejectsCarsAndBadKinds_AndDuplicateLabels', () => {
    expect(validateNewSet({ kind: 'car', label: 'Cars' }, ['Patrols'])).toMatch(/Drivers/);
    expect(validateNewSet({ kind: 'rocket', label: 'Rockets' }, [])).toMatch(/kind/);
    expect(validateNewSet({ kind: 'tent', label: 'patrols' }, ['Patrols'])).toMatch(/already/);
    expect(validateNewSet({ kind: 'tent', label: 'Tents' }, ['Patrols'])).toBeNull();
  });
});

describe('family picker payload', () => {
  it('PlacementPayload_KeepsOnlyNumericPicks_ForSelfSelectSets', () => {
    const selfSelect = new Set([11, 12]);
    expect(
      placementPayloadFromForm('{"s:1":{"11":"200","12":"","99":"5"},"a:2":{"11":"abc"}}', selfSelect)
    ).toEqual([
      { personKey: 's:1', setId: 11, groupId: 200 },
      { personKey: 's:1', setId: 12, groupId: null }
    ]);
    expect(placementPayloadFromForm('not json', selfSelect)).toEqual([]);
  });
});
