import { describe, it, expect } from 'vitest';
import {
  normalizePatrolName,
  distinctPatrols,
  applyBulk,
  diffAssignments,
  patrolCounts,
  duplicateSpellings,
  suspectPatrolValues,
  assignableScouts,
  NON_PATROL_VALUES,
  type PatrolScout
} from '../src/lib/patrol-assign';

/**
 * Bulk patrol assignment (Patrick, 2026-08-22: "build a bulk patrol assignment
 * screen").
 *
 * WHY IT EXISTS. 23 of 28 active scouts carry no patrol, because the only way
 * to set one was the per-scout Roster editor — 28 individual saves, which is
 * the kind of chore that never gets done. The Patrols page on the new family
 * roster is correct and useless until this is filled in.
 *
 * `scouts.patrol` is FREE TEXT with no lookup table behind it, so this module
 * carries the discipline a table would have given for free: one spelling per
 * patrol, no stray whitespace, and a way to notice when two spellings of the
 * same patrol have drifted apart.
 */

const SCOUTS: PatrolScout[] = [
  { id: 's1', display_name: 'Adi Alfred', patrol: 'Screaming Eagles', current_rank: 'scout', graduation_year: 2031, active: true },
  { id: 's2', display_name: 'Ben Bieser', patrol: 'Screaming Eagles', current_rank: 'scout', graduation_year: 2031, active: true },
  { id: 's3', display_name: 'Anjali Sankpal-Tatera', patrol: 'FireQuacker', current_rank: 'second-class', graduation_year: 2029, active: true },
  { id: 's4', display_name: 'Jack Porter', patrol: 'Junior Leader', current_rank: 'star', graduation_year: 2027, active: true },
  { id: 's5', display_name: 'Lucy Lyden', patrol: null, current_rank: 'tenderfoot', graduation_year: 2027, active: true },
  { id: 's6', display_name: 'Owen Radtke', patrol: '   ', current_rank: 'scout', graduation_year: 2030, active: true },
  { id: 's7', display_name: 'Gone Away', patrol: 'Screaming Eagles', current_rank: null, graduation_year: null, active: false }
];

describe('patrol assign — name hygiene (pure)', () => {
  it('NormalizePatrolName_TrimsAndCollapsesWhitespace', () => {
    expect(normalizePatrolName('  Screaming   Eagles ')).toBe('Screaming Eagles');
    expect(normalizePatrolName('Hawks')).toBe('Hawks');
  });

  it('NormalizePatrolName_TreatsBlankAsUnassigned', () => {
    // The DB already holds '   ' on at least one row; blank and null must mean
    // the same thing everywhere or the counts disagree with the roster.
    expect(normalizePatrolName('')).toBe(null);
    expect(normalizePatrolName('   ')).toBe(null);
  });

  it('NormalizePatrolName_CapsRunawayInput', () => {
    expect(normalizePatrolName('x'.repeat(200))?.length).toBe(60);
  });

  it('DistinctPatrols_ListsEachPatrolOnce_Sorted_ExcludingUnassigned', () => {
    expect(distinctPatrols(SCOUTS)).toEqual(['FireQuacker', 'Junior Leader', 'Screaming Eagles']);
  });

  it('DistinctPatrols_IncludesAPatrolHeldOnlyByAnInactiveScout', () => {
    // A patrol nobody active is in must stay offerable — that is exactly the
    // patrol you are about to move someone back into.
    const onlyInactive: PatrolScout[] = [
      { id: 'x', display_name: 'X', patrol: 'Ghost', current_rank: null, graduation_year: null, active: false }
    ];
    expect(distinctPatrols(onlyInactive)).toEqual(['Ghost']);
  });

  it('DuplicateSpellings_FindsNamesThatDifferOnlyByCaseOrSpacing', () => {
    const names = ['Screaming Eagles', 'screaming  eagles', 'Hawks'];
    expect(duplicateSpellings(names)).toEqual([['Screaming Eagles', 'screaming  eagles']]);
  });

  it('DuplicateSpellings_ReturnsNothing_WhenEverySpellingIsDistinct', () => {
    expect(duplicateSpellings(['Hawks', 'Owls'])).toEqual([]);
  });
});

describe('patrol assign — who can be assigned (pure)', () => {
  it('AssignableScouts_OffersActiveScoutsOnly_SortedByName', () => {
    expect(assignableScouts(SCOUTS).map((s) => s.display_name)).toEqual([
      'Adi Alfred',
      'Anjali Sankpal-Tatera',
      'Ben Bieser',
      'Jack Porter',
      'Lucy Lyden',
      'Owen Radtke'
    ]);
  });

  it('AssignableScouts_NeverOffersAnInactiveScout', () => {
    expect(assignableScouts(SCOUTS).some((s) => s.id === 's7')).toBe(false);
  });
});

describe('patrol assign — editing a draft (pure)', () => {
  it('ApplyBulk_AssignsEverySelectedScout_AndLeavesTheRestAlone', () => {
    const draft = applyBulk({}, ['s5', 's6'], 'Hawks');
    expect(draft).toEqual({ s5: 'Hawks', s6: 'Hawks' });
  });

  it('ApplyBulk_ClearsThePatrol_WhenAssignedToUnassigned', () => {
    expect(applyBulk({ s1: 'Hawks' }, ['s1'], null)).toEqual({ s1: null });
  });

  it('ApplyBulk_NormalizesTheNameItWrites', () => {
    expect(applyBulk({}, ['s5'], '  Hawks  ')).toEqual({ s5: 'Hawks' });
  });

  it('ApplyBulk_OverwritesAnEarlierDraftValue_ForTheSameScout', () => {
    expect(applyBulk({ s5: 'Hawks' }, ['s5'], 'Owls')).toEqual({ s5: 'Owls' });
  });

  it('ApplyBulk_IsANoOp_WhenNothingIsSelected', () => {
    expect(applyBulk({ s5: 'Hawks' }, [], 'Owls')).toEqual({ s5: 'Hawks' });
  });
});

describe('patrol assign — the diff that gets saved (pure)', () => {
  it('DiffAssignments_ReturnsOnlyTheScoutsWhoActuallyChanged', () => {
    const diff = diffAssignments(SCOUTS, { s1: 'Screaming Eagles', s5: 'Hawks' });
    expect(diff).toEqual([{ id: 's5', from: null, to: 'Hawks' }]);
  });

  it('DiffAssignments_TreatsBlankAndNullAsTheSameValue', () => {
    // s6 holds '   ' in the DB. Choosing "Unassigned" for them is not a change
    // and must not generate a write.
    expect(diffAssignments(SCOUTS, { s6: null })).toEqual([]);
  });

  it('DiffAssignments_ReturnsEmpty_WhenTheDraftIsUntouched', () => {
    expect(diffAssignments(SCOUTS, {})).toEqual([]);
  });

  it('DiffAssignments_IgnoresAScoutIdThatIsNotOnTheRoster', () => {
    // A stale tab must not be able to write to an arbitrary id.
    expect(diffAssignments(SCOUTS, { nope: 'Hawks' })).toEqual([]);
  });

  it('DiffAssignments_IgnoresAnInactiveScout', () => {
    expect(diffAssignments(SCOUTS, { s7: 'Hawks' })).toEqual([]);
  });

  it('DiffAssignments_RecordsAClearedPatrol', () => {
    expect(diffAssignments(SCOUTS, { s1: null })).toEqual([
      { id: 's1', from: 'Screaming Eagles', to: null }
    ]);
  });
});

describe('patrol assign — the counts shown while editing (pure)', () => {
  it('PatrolCounts_CountsActiveScoutsPerPatrol_WithUnassignedLast', () => {
    const counts = patrolCounts(SCOUTS, {});
    expect(counts.map((c) => [c.name, c.count])).toEqual([
      ['FireQuacker', 1],
      ['Junior Leader', 1],
      ['Screaming Eagles', 2],
      [null, 2]
    ]);
  });

  it('PatrolCounts_ReflectTheDraft_BeforeAnythingIsSaved', () => {
    const counts = patrolCounts(SCOUTS, { s5: 'FireQuacker', s6: 'FireQuacker' });
    const fq = counts.find((c) => c.name === 'FireQuacker');
    const un = counts.find((c) => c.name === null);
    expect(fq?.count).toBe(3);
    expect(un?.count).toBe(0);
  });

  it('PatrolCounts_KeepsAPatrolVisible_AfterItsLastScoutMovesOut', () => {
    // Otherwise the patrol you just emptied by mistake vanishes from the
    // screen and you cannot put anyone back.
    const counts = patrolCounts(SCOUTS, { s3: 'Screaming Eagles' });
    expect(counts.find((c) => c.name === 'FireQuacker')?.count).toBe(0);
  });
});

describe('patrol assign — data-quality warnings (pure)', () => {
  it('SuspectPatrolValues_FlagsJuniorLeader_BecauseItHasItsOwnColumn', () => {
    // scouts.junior_leader_override exists (Participant Classification, D-176),
    // so "Junior Leader" in the patrol column is two systems in one field.
    expect(suspectPatrolValues(distinctPatrols(SCOUTS))).toEqual(['Junior Leader']);
  });

  it('SuspectPatrolValues_MatchesRegardlessOfCaseAndSpacing', () => {
    expect(suspectPatrolValues(['junior  leader'])).toEqual(['junior  leader']);
  });

  it('SuspectPatrolValues_LeavesRealPatrolNamesAlone', () => {
    expect(suspectPatrolValues(['Screaming Eagles', 'Hawks', 'FireQuacker'])).toEqual([]);
  });

  it('NonPatrolValues_IsNotEmpty_SoTheWarningHasSomethingToMatch', () => {
    expect(NON_PATROL_VALUES.length).toBeGreaterThan(0);
  });
});
