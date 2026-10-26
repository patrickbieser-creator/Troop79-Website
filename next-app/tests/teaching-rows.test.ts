import { describe, it, expect } from 'vitest';
import { buildTeachingRows, collectTeachingAdults, type TeachingAdult, type TeachingScout } from '../src/app/admin/(workspace)/advancement/lookups/teaching-rows';

/**
 * Lookups & Admin -> Adult Skills / Scout Instructors (2026-10-26, Patrick: "full CRUD"). A row is a person who
 * teaches: listed once they hold a skill, gone once they hold none. Add offers everyone else in the pool.
 */
const adults: TeachingAdult[] = [
  { personId: 82, name: 'Patrick Bieser', sub: 'Scoutmaster', inPicker: true },
  { personId: 119, name: 'Julie Radtke', sub: 'Parent', inPicker: true },
  { personId: 136, name: 'Rachel Ellerman', sub: 'Parent', inPicker: true },
  { personId: 500, name: 'Out Of Picker', sub: 'Parent', inPicker: false }
];
const scouts: TeachingScout[] = [
  { personId: 10, name: 'Ava Star', sub: 'Star', eligible: true },
  { personId: 11, name: 'Ben Scout', sub: 'Scout', eligible: false },
  { personId: 12, name: 'Cal Life', sub: 'Life', eligible: true }
];
const skills = new Map<number, string[]>([
  [82, ['knots']],
  [500, ['cooking']],
  [11, ['knots']],
  [12, ['map']]
]);

const build = () => buildTeachingRows({ adults, scouts, skillIdsByPerson: skills });
const keys = (rows: { key: string }[]) => rows.map((r) => r.key);

describe('buildTeachingRows', () => {
  it('Adult_IsListed_OnlyWhenTheyHoldASkill', () => {
    expect(keys(build().adultRows)).toEqual(['500', '82']);
  });

  it('Adult_WhoHoldsASkill_CarriesTheirSkills', () => {
    expect(build().adultRows.find((r) => r.key === '82')?.skillIds).toEqual(['knots']);
  });

  it('AdultCandidates_AreThePickerAdultsWithNoSkill', () => {
    expect(keys(build().adultCandidates)).toEqual(['119', '136']);
  });

  it('Scout_IsListed_WhenTheyHoldASkill_EvenIfNoLongerEligible', () => {
    expect(keys(build().scoutRows)).toEqual(['11', '12']);
  });

  it('ScoutCandidates_AreEligibleScoutsWithNoSkill', () => {
    expect(keys(build().scoutCandidates)).toEqual(['10']);
  });

  it('Rows_AreSortedByName', () => {
    expect(build().adultRows.map((r) => r.name)).toEqual(['Out Of Picker', 'Patrick Bieser']);
  });
});

describe('collectTeachingAdults', () => {
  const base = {
    directory: [
      { personId: 82, name: 'Patrick Bieser', tab: 'leader', inPicker: true },
      { personId: 119, name: 'Julie Radtke', tab: 'adult', inPicker: true },
      { personId: 7, name: 'Youth Leader', tab: 'leader', inPicker: true }
    ],
    adultLeaders: [
      { personId: 82, name: 'Patrick Bieser', role: 'Scoutmaster' },
      { personId: 300, name: 'Not In Directory', role: 'ASM' }
    ],
    otherTeachers: [{ personId: 400, name: 'Counselor Parent' }],
    formerScouts: [{ personId: 600, name: 'Aged Out' }],
    activeScoutIds: new Set([7])
  };
  const byId = () => new Map(collectTeachingAdults(base).map((a) => [a.personId, a]));

  it('LeaderInTheDirectory_CarriesTheirLeaderRole', () => {
    expect(byId().get(82)?.sub).toBe('Scoutmaster');
  });

  it('DirectoryAdult_WithNoLeaderRow_IsAParent', () => {
    expect(byId().get(119)?.sub).toBe('Parent');
  });

  it('ActiveScout_IsNeverAnAdult_EvenOnTheLeaderTab', () => {
    expect(byId().has(7)).toBe(false);
  });

  it('AdultLeader_MissingFromTheDirectory_IsStillOffered', () => {
    expect(byId().get(300)?.inPicker).toBe(true);
  });

  it('ParentWhoTeachesOutsideThePicker_IsListedButNotOffered', () => {
    expect(byId().get(400)).toMatchObject({ sub: 'Parent', inPicker: false });
  });

  it('InactiveScoutHoldingSkills_LandsInAdults_SoTheirSkillsCanBeCleared', () => {
    expect(byId().get(600)).toMatchObject({ sub: 'Former scout', inPicker: false });
  });
});
