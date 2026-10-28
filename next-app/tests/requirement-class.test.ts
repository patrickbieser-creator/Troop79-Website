import { describe, it, expect } from 'vitest';
import { effectiveClasses, fitsGathering, normalizeClassCodes, settingGroups, UNTAGGED } from '../src/lib/requirement-class';

/** Requirement classes are tags (Plans/Requirement-Classification.md): any number, no precedence, one shared tag fits. */
describe('effectiveClasses', () => {
  it('Requirement_KeepsItsOwnTags', () => {
    expect(effectiveClasses(['O', 'E'], ['C'])).toEqual(['O', 'E']);
  });

  it('Requirement_InheritsItsParentsTags_WhenItHasNone', () => {
    expect(effectiveClasses([], ['A'])).toEqual(['A']);
  });

  it('Requirement_Untagged_BehavesAsTroopMeeting', () => {
    expect(effectiveClasses([], undefined)).toEqual(['M']);
  });
});

describe('fitsGathering', () => {
  it('Meeting_HoldsARequirementTaggedMeetingAndExpert', () => {
    expect(fitsGathering(['M', 'E'], 'meeting')).toBe(true);
  });

  it('Meeting_DoesNotHoldARequirementTaggedOnlyAquatics', () => {
    expect(fitsGathering(['A'], 'meeting')).toBe(false);
  });

  it('Gathering_Campout_HoldsCampoutAndOutdoorClasses', () => {
    expect([fitsGathering(['C'], 'campout'), fitsGathering(['O'], 'campout'), fitsGathering(['A'], 'campout')]).toEqual([true, true, false]);
  });
});

describe('normalizeClassCodes', () => {
  it('ClassCodes_AreUppercasedAndDeduplicated', () => {
    expect(normalizeClassCodes(['o', 'E', 'O'])).toEqual(['O', 'E']);
  });

  it('ClassCodes_RefuseAnythingButSingleLetters', () => {
    expect([normalizeClassCodes('M'), normalizeClassCodes(['MM']), normalizeClassCodes([1])]).toEqual([null, null, null]);
  });
});

describe('settingGroups', () => {
  it('NeedsAnotherSetting_GroupsItemsByTag_UnderEachTheMeetingLacks', () => {
    expect(settingGroups(['S', 'O'], 'meeting')).toEqual(['S', 'O']);
  });

  it('NeedsAnotherSetting_LeavesOutLeadershipItems', () => {
    expect(settingGroups(['L'], 'meeting')).toEqual([]);
  });

  it('Untagged_IsAnEmptyList', () => {
    expect(UNTAGGED).toEqual([]);
  });
});
