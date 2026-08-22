import { describe, it, expect } from 'vitest';
import {
  formatPhone,
  formatAddress,
  sameAddress,
  familySortKey,
  buildFamilyRoster,
  buildPatrolRoster,
  buildLeaderDirectory,
  rankLabel,
  rosterCounts,
  type RosterPrintInput
} from '../src/lib/roster-print';

/**
 * The home roster (Patrick, 2026-08-22: "the print a roster is a mess … a
 * better, more useful printout of the roster that could be in PDF format that
 * would be available for leaders to keep by their phones at home").
 *
 * The old "Print Roster" was window.print() over whichever admin tab happened
 * to be open. This builds a real document instead, and the shape of that
 * document is decided here so it can be asserted without a printer.
 *
 * ORGANIZED BY FAMILY, not by person. The question this page answers at 8pm
 * on a Tuesday is "who is Ben's mom and what's her cell" — that is a household
 * lookup, and a flat list of scouts cannot answer it.
 *
 * MEDICAL CONTENT IS OUT, permanently. `things_we_should_know` carries food
 * allergies and medical conditions, and the 2026-07-13 decision keeps medical
 * content out of the system's outputs (Plans/Health-Forms.md is parked pending
 * a committee decision). A printout that leaves the building is the last place
 * to relax that, so there is a test below that fails if the field ever
 * reaches this module.
 */

const INPUT: RosterPrintInput = {
  households: [
    { id: 1, label: 'Kowalski' },
    { id: 2, label: 'Barry / Kingston' },
    { id: 3, label: 'Ellerman' }
  ],
  scouts: [
    {
      id: 's1',
      first_name: 'Ben',
      last_name: 'Kowalski',
      display_name: 'Ben Kowalski',
      household_id: 1,
      patrol: 'Hawks',
      current_rank: 'first-class',
      graduation_year: 2029,
      phone: '4145551234',
      email: 'ben@example.com',
      address_line1: '123 N Astor St',
      address_line2: null,
      city: 'Milwaukee',
      state: 'WI',
      zip: '53202',
      active: true
    },
    {
      id: 's2',
      first_name: 'Quinn',
      last_name: 'Barry',
      display_name: 'Quinn Barry',
      household_id: 2,
      patrol: 'Owls',
      current_rank: 'second-class',
      graduation_year: 2031,
      phone: null,
      email: null,
      address_line1: '55 E Capitol Dr',
      address_line2: 'Apt 3',
      city: 'Shorewood',
      state: 'WI',
      zip: '53211',
      active: true
    },
    {
      id: 's3',
      first_name: 'Piper',
      last_name: 'Kingston',
      display_name: 'Piper Kingston',
      household_id: 2,
      patrol: 'Hawks',
      current_rank: 'scout',
      graduation_year: 2032,
      phone: null,
      email: null,
      address_line1: '55 E Capitol Dr',
      address_line2: 'Apt 3',
      city: 'Shorewood',
      state: 'WI',
      zip: '53211',
      active: true
    },
    {
      id: 's4',
      first_name: 'Gone',
      last_name: 'Ellerman',
      display_name: 'Gone Ellerman',
      household_id: 3,
      patrol: null,
      current_rank: null,
      graduation_year: null,
      phone: null,
      email: null,
      address_line1: null,
      address_line2: null,
      city: null,
      state: null,
      zip: null,
      active: false
    }
  ],
  adults: [
    {
      personId: 10,
      householdId: 1,
      name: 'Anna Kowalski',
      relationship: 'Mom',
      phone: '414-555-0000',
      email: 'anna@example.com',
      leaderCode: 'AK',
      role: 'Committee Chair',
      isYouth: false,
      address_line1: null,
      address_line2: null,
      city: null,
      state: null,
      zip: null
    },
    {
      personId: 11,
      householdId: 1,
      name: 'Paul Kowalski',
      relationship: 'Dad',
      phone: null,
      email: 'paul@example.com',
      leaderCode: null,
      role: null,
      isYouth: false,
      address_line1: null,
      address_line2: null,
      city: null,
      state: null,
      zip: null
    },
    {
      personId: 12,
      householdId: 2,
      name: 'Dana Barry',
      relationship: 'Mom',
      phone: '4145559876',
      email: null,
      leaderCode: 'DB',
      role: 'Scoutmaster',
      isYouth: false,
      address_line1: '55 E Capitol Dr',
      address_line2: null,
      city: 'Shorewood',
      state: 'WI',
      zip: '53211'
    },
    {
      // A youth leader holds a leaders row too — they must never show up in
      // the ADULT directory ("who do I call").
      personId: 13,
      householdId: 1,
      name: 'Ben Kowalski',
      relationship: null,
      phone: null,
      email: null,
      leaderCode: 'BK',
      role: 'Senior Patrol Leader',
      isYouth: true,
      address_line1: null,
      address_line2: null,
      city: null,
      state: null,
      zip: null
    }
  ],
  ranks: [
    { id: 'scout', display_name: 'Scout' },
    { id: 'tenderfoot', display_name: 'Tenderfoot' },
    { id: 'second-class', display_name: 'Second Class' },
    { id: 'first-class', display_name: 'First Class' }
  ],
  generatedOn: '2026-08-22'
};

describe('roster print — formatting (pure)', () => {
  it('FormatPhone_RendersTenDigits_AsAReadableUsNumber', () => {
    expect(formatPhone('4145551234')).toBe('(414) 555-1234');
    expect(formatPhone('414-555-1234')).toBe('(414) 555-1234');
    expect(formatPhone('(414) 555 1234')).toBe('(414) 555-1234');
    expect(formatPhone('14145551234')).toBe('(414) 555-1234');
  });

  it('FormatPhone_LeavesAnythingItDoesNotUnderstand_Untouched', () => {
    // An extension or a note is still useful on paper — mangling it is worse
    // than leaving it as the leader typed it.
    expect(formatPhone('414-555-1234 x12')).toBe('414-555-1234 x12');
    expect(formatPhone('call the house')).toBe('call the house');
    expect(formatPhone(null)).toBe(null);
    expect(formatPhone('  ')).toBe(null);
  });

  it('FormatAddress_JoinsTheParts_AndSkipsMissingOnes', () => {
    expect(
      formatAddress({ address_line1: '123 N Astor St', address_line2: 'Apt 3', city: 'Milwaukee', state: 'WI', zip: '53202' })
    ).toBe('123 N Astor St, Apt 3, Milwaukee, WI 53202');
    expect(formatAddress({ address_line1: '123 N Astor St', address_line2: null, city: 'Milwaukee', state: 'WI', zip: null })).toBe(
      '123 N Astor St, Milwaukee, WI'
    );
  });

  it('FormatAddress_ReturnsNull_WhenNothingIsKnown', () => {
    expect(formatAddress({ address_line1: null, address_line2: null, city: null, state: null, zip: null })).toBe(null);
  });

  it('SameAddress_IgnoresCaseSpacingAndPunctuation', () => {
    expect(sameAddress('123 N Astor St, Milwaukee, WI 53202', '123 n astor st,  milwaukee, wi  53202')).toBe(true);
    expect(sameAddress('123 N Astor St', '124 N Astor St')).toBe(false);
    expect(sameAddress(null, null)).toBe(false);
  });

  it('FamilySortKey_SortsBySurname_NotByTheLabelsPunctuation', () => {
    const labels = ['Barry / Kingston', 'Ellerman', 'Kowalski', 'de la Cruz'];
    const sorted = [...labels].sort((a, b) => familySortKey(a).localeCompare(familySortKey(b)));
    expect(sorted).toEqual(['Barry / Kingston', 'de la Cruz', 'Ellerman', 'Kowalski']);
  });
});

describe('roster print — the family roster (pure)', () => {
  it('BuildFamilyRoster_GroupsScoutsAndAdults_UnderTheirHousehold', () => {
    const fams = buildFamilyRoster(INPUT);
    const barry = fams.find((f) => f.label === 'Barry / Kingston');
    expect(barry?.scouts.map((s) => s.name)).toEqual(['Piper Kingston', 'Quinn Barry']);
    expect(barry?.adults.map((a) => a.name)).toEqual(['Dana Barry']);
  });

  it('BuildFamilyRoster_ListsFamiliesAlphabetically', () => {
    expect(buildFamilyRoster(INPUT).map((f) => f.label)).toEqual(['Barry / Kingston', 'Kowalski']);
  });

  it('BuildFamilyRoster_DropsAFamilyWithNoActiveScoutAndNoAdult', () => {
    // The Ellermans' only scout is inactive — a fridge roster is a list of who
    // is IN the troop now, not an archive.
    expect(buildFamilyRoster(INPUT).some((f) => f.label === 'Ellerman')).toBe(false);
  });

  it('BuildFamilyRoster_PutsTheAddressOnTheFamily_NotOnEveryScout', () => {
    const barry = buildFamilyRoster(INPUT).find((f) => f.label === 'Barry / Kingston');
    expect(barry?.address).toBe('55 E Capitol Dr, Apt 3, Shorewood, WI 53211');
    // Two siblings at one address must not print it twice.
    expect(barry?.scouts.every((s) => s.address === null)).toBe(true);
  });

  it('BuildFamilyRoster_KeepsAnAdultsOwnAddress_WhenItDiffersFromTheFamilys', () => {
    const fams = buildFamilyRoster({
      ...INPUT,
      adults: INPUT.adults.map((a) =>
        a.personId === 12
          ? { ...a, address_line1: '900 W Layton Ave', city: 'Milwaukee', state: 'WI', zip: '53221' }
          : a
      )
    });
    const dana = fams.find((f) => f.label === 'Barry / Kingston')?.adults[0];
    expect(dana?.address).toBe('900 W Layton Ave, Milwaukee, WI 53221');
  });

  it('BuildFamilyRoster_CarriesPatrolRankAndGrade_ForEachScout', () => {
    const ben = buildFamilyRoster(INPUT)[1].scouts[0];
    expect(ben.name).toBe('Ben Kowalski');
    expect(ben.patrol).toBe('Hawks');
    expect(ben.rank).toBe('First Class');
    expect(ben.grade).toBeTypeOf('string');
  });

  it('BuildFamilyRoster_FormatsEveryPhoneItPrints', () => {
    const anna = buildFamilyRoster(INPUT)[1].adults.find((a) => a.name === 'Anna Kowalski');
    expect(anna?.phone).toBe('(414) 555-0000');
  });

  it('BuildFamilyRoster_MarksAnAdultWhoAlsoHoldsALeaderRole', () => {
    const dana = buildFamilyRoster(INPUT).find((f) => f.label === 'Barry / Kingston')?.adults[0];
    expect(dana?.role).toBe('Scoutmaster');
  });

  it('BuildFamilyRoster_NeverEmitsMedicalOrAllergyContent', () => {
    // Guard, not decoration: `things_we_should_know` is food allergies and
    // medical conditions, and this document leaves the building.
    const json = JSON.stringify(buildFamilyRoster(INPUT));
    expect(json).not.toMatch(/things_we_should_know|allerg|medical|health_form/i);
  });
});

describe('roster print — patrols and the leader directory (pure)', () => {
  it('BuildPatrolRoster_GroupsActiveScoutsByPatrol_Alphabetically', () => {
    const patrols = buildPatrolRoster(INPUT);
    expect(patrols.map((p) => p.name)).toEqual(['Hawks', 'Owls']);
    expect(patrols[0].scouts.map((s) => s.name)).toEqual(['Ben Kowalski', 'Piper Kingston']);
  });

  it('BuildPatrolRoster_CollectsUnassignedScouts_UnderOneHeading', () => {
    const patrols = buildPatrolRoster({
      ...INPUT,
      scouts: INPUT.scouts.map((s) => (s.id === 's2' ? { ...s, patrol: null } : s))
    });
    const un = patrols.find((p) => p.name === 'Not yet assigned');
    expect(un?.scouts.map((s) => s.name)).toEqual(['Quinn Barry']);
    // It sorts last regardless of the alphabet.
    expect(patrols[patrols.length - 1].name).toBe('Not yet assigned');
  });

  it('BuildLeaderDirectory_ListsAdultsWithARole_AndNeverAYouthLeader', () => {
    const dir = buildLeaderDirectory(INPUT);
    expect(dir.map((l) => l.name)).toEqual(['Dana Barry', 'Anna Kowalski']);
    expect(dir.some((l) => l.role === 'Senior Patrol Leader')).toBe(false);
  });

  it('BuildLeaderDirectory_PutsTheScoutmasterFirst_ThenCommitteeChair', () => {
    // The two numbers a parent actually reaches for go at the top; the rest
    // fall alphabetically underneath.
    expect(buildLeaderDirectory(INPUT).map((l) => l.role)).toEqual(['Scoutmaster', 'Committee Chair']);
  });

  it('BuildLeaderDirectory_ExcludesAnAdultWithNoRole', () => {
    expect(buildLeaderDirectory(INPUT).some((l) => l.name === 'Paul Kowalski')).toBe(false);
  });
});

describe('roster print — real-data defects found on 2026-08-22', () => {
  it('RankLabel_RendersTheRanksDisplayName_NotItsSlug', () => {
    // scouts.current_rank stores an id ("second-class"); printing it raw put
    // "second-class" on the sheet.
    expect(rankLabel('second-class', INPUT.ranks)).toBe('Second Class');
    expect(rankLabel(null, INPUT.ranks)).toBe(null);
    // An id with no row still prints something a human can read.
    expect(rankLabel('life', [])).toBe('Life');
  });

  it('BuildPatrolRoster_PrintsRankDisplayNames', () => {
    const hawks = buildPatrolRoster(INPUT).find((p) => p.name === 'Hawks');
    expect(hawks?.scouts.map((s) => s.rank)).toEqual(['First Class', 'Scout']);
  });

  it('BuildFamilyRoster_DropsAnAdultOnlyHouseholdWithNoTroopRole', () => {
    // Production showed 41 "families" for 28 scouts: households left behind by
    // aged-out scouts, and adults with no scout, were each printing as a
    // family. A home roster is the families in the troop now.
    const fams = buildFamilyRoster({
      ...INPUT,
      households: [...INPUT.households, { id: 4, label: 'Manning' }],
      adults: [
        ...INPUT.adults,
        {
          personId: 20, householdId: 4, name: 'Rose Manning', relationship: null,
          phone: null, email: null, leaderCode: null, role: null, isYouth: false,
          address_line1: null, address_line2: null, city: null, state: null, zip: null
        }
      ]
    });
    expect(fams.some((f) => f.label === 'Manning')).toBe(false);
  });

  it('BuildFamilyRoster_KeepsAnAdultOnlyHousehold_WhenAnAdultHoldsATroopRole', () => {
    // A committee member whose scout aged out is still someone you call.
    const fams = buildFamilyRoster({
      ...INPUT,
      households: [...INPUT.households, { id: 5, label: 'Tesch' }],
      adults: [
        ...INPUT.adults,
        {
          personId: 21, householdId: 5, name: 'Louise Tesch', relationship: null,
          phone: '4144676952', email: null, leaderCode: 'LT', role: 'Committee Member',
          isYouth: false, address_line1: null, address_line2: null, city: null, state: null, zip: null
        }
      ]
    });
    expect(fams.some((f) => f.label === 'Tesch')).toBe(true);
  });

  it('RosterCounts_CountsOnlyTheFamiliesThatPrint', () => {
    const fams = buildFamilyRoster(INPUT);
    expect(rosterCounts(INPUT).families).toBe(fams.length);
  });
});
