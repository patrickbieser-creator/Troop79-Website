import { describe, it, expect } from 'vitest';
import { planButtons, planChanged, renderHouseholdEmail, scoutBlock, type ScoutPlanSent } from '../src/lib/meeting-email-build';

/** Emails E3: the household email's words, buttons and the "plan changed since sent" rule. Pure. */
const lily: ScoutPlanSent = {
  name: 'Lily',
  kind: 'rank',
  group: 'fr:second-class',
  groupName: 'Second Class',
  teachers: ['Mr. V'],
  items: [
    { key: 'second-class-6a', code: '6a', label: 'First aid' },
    { key: 'second-class-6c', code: '6c', label: 'Reduce injuries' }
  ],
  helpName: null
};
const finn: ScoutPlanSent = { name: 'Finn', kind: 'mb', group: 'fr:mb:first-aid', groupName: 'First Aid', teachers: [], items: [], helpName: 'Tenderfoot' };
const T = { subject: 'Troop meeting on [day]: [focus]', body: 'Hi [name], here is the plan for [people].' };

describe('household email', () => {
  it('EmailButtons_MapToPageChoices_ForRankScouts', () => {
    expect(planButtons([lily]).map((b) => [b.label, b.answer])).toEqual([
      ['Yes, coming', 'ok'],
      ['Pick something else', 'change'],
      ['Not this week', 'out']
    ]);
  });

  it('EmailButtons_MapToPageChoices_ForMeritBadgeScouts', () => {
    expect(planButtons([finn]).map((b) => b.answer)).toEqual(['mb', 'help', 'out']);
  });

  it('EmailButtons_MixedHousehold_UseTheRankButtons', () => {
    expect(planButtons([lily, finn]).map((b) => b.answer)).toEqual(['ok', 'change', 'out']);
  });

  it('Email_ListsEachScoutsGroupTeacherAndRequirements', () => {
    expect(scoutBlock(lily)).toBe('**Lily**: the Second Class group with Mr. V\n- 6a · First aid\n- 6c · Reduce injuries');
  });

  it('Email_SplitGroups_AreNamedAsOnThePlan', () => {
    expect([
      scoutBlock({ ...lily, group: 'fr:second-class~2', groupTitle: 'Second Class Group 2', teachers: [] }).split(String.fromCharCode(10))[0],
      scoutBlock({ ...finn, helpTitle: 'Tenderfoot Group 1' })
    ]).toEqual(['**Lily**: Second Class Group 2', `**Finn**: the First Aid merit badge, or help teach Tenderfoot Group 1\n${library('First Aid', 'Finn')}`]);
  });

  // Patrick, 2026-11-01: a merit badge on the plan is named, not listed requirement by requirement; a scout who has
  // started it is pointed at the Troop Library by the badge's name, with no link (a link would pull them off the RSVP).
  const library = (badge: string, name: string) => `Already started it? Look up ${badge} in the Troop Library to see which requirements ${name} still needs.`;
  const damian: ScoutPlanSent = {
    name: 'Damian',
    kind: 'rank',
    group: 'fr:mb:citizenship-community',
    groupName: 'Citizenship in The Community',
    groupTitle: 'Citizenship in The Community merit badge',
    teachers: ['Mr. Porter'],
    items: [
      { key: 'mb:citizenship-community-1', code: 'Citizenship in The Community 1', label: 'Discuss citizenship' },
      { key: 'mb:citizenship-community-2', code: 'Citizenship in The Community 2', label: 'Community mapping' }
    ],
    helpName: null
  };

  it('MeritBadgePlan_NamesTheBadge_NotItsRequirements', () => {
    expect(scoutBlock(damian)).toBe(`**Damian**: the Citizenship in The Community merit badge with Mr. Porter\n${library('Citizenship in The Community', 'Damian')}`);
  });

  it('MeritBadgePlan_LibraryLine_HasNoLink', () => {
    expect([scoutBlock(damian), scoutBlock(finn)].some((b) => b.includes('](') || /https?:/.test(b))).toBe(false);
  });

  it('MeritBadgeGroupNotChosenYet_HasNoLibraryLine', () => {
    expect(scoutBlock({ ...finn, group: null, groupName: null, helpName: null })).toBe('**Finn**: a leader will find something for Sunday');
  });

  it('RankPlan_StillListsItsRequirements', () => {
    expect(scoutBlock(lily).split('\n').filter((l) => l.startsWith('- ')).length).toBe(2);
  });

  it('Email_UsesTheOverride_WhenEdited', () => {
    expect(renderHouseholdEmail(T, { name: 'Laura', people: 'Lily', day: 'Sun', focus: 'First aid' }, [lily], 'Just for [name].').md.startsWith('Just for Laura.')).toBe(true);
  });

  it('Email_FillsTheTemplate_WhenNotEdited', () => {
    const r = renderHouseholdEmail(T, { name: 'Laura', people: 'Lily', day: 'Sun', focus: 'First aid' }, [lily], null);
    expect([r.subject, r.md.split('\n')[0]]).toEqual(['Troop meeting on Sun: First aid', 'Hi Laura, here is the plan for Lily.']);
  });
});

describe('plan changed since sent', () => {
  it('Drift_FlagsANewGroup', () => {
    expect(planChanged(lily, { ...lily, group: 'fr:first-class' })).toBe(true);
  });

  it('Drift_IgnoresTheSamePlanInAnotherOrder', () => {
    expect(planChanged(lily, { ...lily, items: [...lily.items].reverse() })).toBe(false);
  });

  it('Drift_FlagsARequirementAdded', () => {
    expect(planChanged(lily, { ...lily, items: [...lily.items, { key: 'second-class-6d', code: '6d', label: 'x' }] })).toBe(true);
  });
});

describe('the family’s own changes', () => {
  it('Drift_IgnoresTheFamilysOwnUntick', () => {
    expect(planChanged(lily, { ...lily, items: lily.items.map((i, n) => (n === 0 ? { ...i, on: false } : i)) })).toBe(false);
  });

  it('Email_LeavesOutWhatTheFamilyTookOff', () => {
    expect(scoutBlock({ ...lily, items: [{ ...lily.items[0], on: false }, lily.items[1]] })).not.toContain('6a');
  });
});
