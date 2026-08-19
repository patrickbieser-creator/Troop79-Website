import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { validateAwardRows } from '@/app/admin/(workspace)/advancement/fast-entry/actions';

/**
 * Merit badge award gating (Patrick, 2026-08-19): checking "Full merit badge
 * earned" in the Fast Entry picker used to be rejected unless every catalog
 * requirement was already completed or also checked in the same batch —
 * forcing a leader to either hand-check every requirement (cluttering the
 * ledger with N extra rows for a badge that was really earned as one fact,
 * e.g. a summer-camp blue card) or "Select all" to the same effect.
 *
 * Fixed, then refined same day: the bypass is CONDITIONAL, not blanket. A
 * clean slate (zero completed/pending requirement rows for that badge) skips
 * the leaf check entirely — a checked merit_badge_award row is sufficient on
 * its own, matching how mb_progress already treats the award row as
 * authoritative independent of any leaf rows. But a scout who has been
 * working a badge over time and already has SOME (not all) requirements
 * signed off still gets the full original leaf-satisfaction check — Patrick's
 * explicit clarification: partial progress abandoned in favor of a one-click
 * award reads as a mistake, not a clean "earned as one fact" case. Rank
 * awards keep the leaf gate unconditionally regardless of clean-slate status;
 * this only covers the two kinds staying different on purpose.
 */

const admin = adminClient();
const SCOUT_ID = `zzvitest-mbgate-${process.pid}`;
const MB_ID = `zzvitest-mb-${process.pid}`;
const MB_PARTIAL_ID = `zzvitest-mbpartial-${process.pid}`;

// Scout rank's other 16 top-level requirement codes (everything except the
// terminal "7" / Scoutmaster Conference) — real catalog codes, since Scout
// rank is a fixed, permanent part of the BSA catalog, not fixture data.
const SCOUT_OTHER_CODES = [
  '1a', '1b', '1c', '1d', '1e', '1f',
  '2a', '2b', '2c', '2d',
  '3a', '3b',
  '4a', '4b',
  '5', '6'
];

beforeAll(async () => {
  await admin.from('scouts').insert({
    id: SCOUT_ID,
    first_name: 'ZZVitest',
    last_name: 'MbGate',
    display_name: 'ZZVitest MbGate',
    active: true
  });
  await admin.from('merit_badges').insert([
    { id: MB_ID, name: 'ZZVitest Badge', eagle: false },
    { id: MB_PARTIAL_ID, name: 'ZZVitest Partial Badge', eagle: false }
  ]);
  // Two top-level requirements per badge, both leaves, complete_rule defaults
  // to 'all' — a scout with zero completions or pending rows fails the OLD
  // gate on both.
  await admin.from('merit_badge_requirements').insert([
    { mb_id: MB_ID, code: '1', label: 'Requirement 1', sort_order: 1 },
    { mb_id: MB_ID, code: '2', label: 'Requirement 2', sort_order: 2 },
    { mb_id: MB_PARTIAL_ID, code: '1', label: 'Requirement 1', sort_order: 1 },
    { mb_id: MB_PARTIAL_ID, code: '2', label: 'Requirement 2', sort_order: 2 }
  ]);
  // Partial progress on MB_PARTIAL_ID: requirement 1 already signed off,
  // requirement 2 untouched — the exact "been working on it over time" shape.
  const { error } = await admin.from('ledger_entries').insert({
    scout_id: SCOUT_ID,
    date: '2026-01-01',
    kind: 'merit_badge_requirement',
    code: `${MB_PARTIAL_ID}-1`,
    label: 'Requirement 1',
    unit: 'requirement',
    entered_by: 'vitest'
  });
  if (error) throw new Error(`fixture ledger insert failed: ${error.message}`);
});

afterAll(async () => {
  await admin.from('ledger_entries').delete().eq('scout_id', SCOUT_ID);
  // merit_badge_requirements cascades from merit_badges on delete.
  await admin.from('merit_badges').delete().in('id', [MB_ID, MB_PARTIAL_ID]);
  await admin.from('scouts').delete().eq('id', SCOUT_ID);
});

describe('validateAwardRows — merit badge vs rank gating', () => {
  it('MeritBadgeAward_PassesGating_WhenNoRequirementIsCompletedOrPending', async () => {
    const errors = await validateAwardRows(admin, [
      { scout_id: SCOUT_ID, kind: 'merit_badge_award', code: `MB:${MB_ID}`, label: 'ZZVitest Badge', unit: 'award' }
    ]);
    expect(errors).toEqual([]);
  });

  it('MeritBadgeAward_PassesGating_EvenAlongsideUnrelatedPendingItemsInTheSameBatch', async () => {
    // A realistic Scout-First batch: the award, plus something unrelated
    // (not a requirement of this badge) also being signed off the same day.
    const errors = await validateAwardRows(admin, [
      { scout_id: SCOUT_ID, kind: 'merit_badge_award', code: `MB:${MB_ID}`, label: 'ZZVitest Badge', unit: 'award' },
      { scout_id: SCOUT_ID, kind: 'service_hours', code: 'ZZVIT-SERV', label: null, unit: 'hours', qty: 2 }
    ]);
    expect(errors).toEqual([]);
  });

  it('MeritBadgeAward_FailsGating_WhenSomeButNotAllRequirementsAreAlreadyCompleted', async () => {
    // MB_PARTIAL_ID: requirement 1 completed via fixture, requirement 2 never
    // touched. Checking only the award should NOT bypass — partial progress
    // means the full leaf check still applies, same as pre-fix behavior.
    const errors = await validateAwardRows(admin, [
      {
        scout_id: SCOUT_ID,
        kind: 'merit_badge_award',
        code: `MB:${MB_PARTIAL_ID}`,
        label: 'ZZVitest Partial Badge',
        unit: 'award'
      }
    ]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].awardLabel).toBe(`${MB_PARTIAL_ID} merit badge`);
    // Requirement 1 (completed) shouldn't be the one flagged — requirement 2 is.
    expect(errors.some((e) => e.parentCode === '2')).toBe(true);
    expect(errors.some((e) => e.parentCode === '1')).toBe(false);
  });

  it('MeritBadgeAward_PassesGating_WhenTheRemainingRequirementIsCheckedInTheSameBatch', async () => {
    // Same partially-completed badge, but the leader also checks the one
    // outstanding requirement in this batch — the pre-existing "reqs + award
    // in one click" path, unaffected by the clean-slate bypass.
    const errors = await validateAwardRows(admin, [
      {
        scout_id: SCOUT_ID,
        kind: 'merit_badge_award',
        code: `MB:${MB_PARTIAL_ID}`,
        label: 'ZZVitest Partial Badge',
        unit: 'award'
      },
      {
        scout_id: SCOUT_ID,
        kind: 'merit_badge_requirement',
        code: `${MB_PARTIAL_ID}-2`,
        label: 'Requirement 2',
        unit: 'requirement'
      }
    ]);
    expect(errors).toEqual([]);
  });

  it('RankAward_StillFailsGating_WhenNoRequirementIsCompletedOrPending', async () => {
    // Regression guard: the fix must not have weakened rank-award gating,
    // which is intentionally still leaf-gated (see validateAwardRows' header
    // comment). Uses a real catalog rank — Tenderfoot always has more than
    // zero requirements — with a scout who has completed none of them.
    const errors = await validateAwardRows(admin, [
      { scout_id: SCOUT_ID, kind: 'rank_award', code: 'tenderfoot', label: 'Tenderfoot', unit: 'award' }
    ]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].awardLabel).toBe('tenderfoot rank');
  });

  it('ScoutRankTerminal_FailsGating_WhenOtherRequirementsAreIncomplete', async () => {
    // Scout rank has no Board of Review row in the picker — requirement 7
    // (Scoutmaster Conference) is its stand-in terminal step. Checking it
    // alone, with all 16 other Scout requirements untouched, must be denied
    // exactly like an ungated rank_award would be (Patrick, 2026-08-19:
    // "There's never a scenario where a requirement is missing and a BoR is
    // valid").
    const errors = await validateAwardRows(admin, [
      { scout_id: SCOUT_ID, kind: 'rank_requirement', code: 'scout-7', label: 'Scoutmaster Conference', unit: 'requirement' }
    ]);
    expect(errors.length).toBe(SCOUT_OTHER_CODES.length);
    expect(errors[0].awardLabel).toBe('Scoutmaster Conference (Scout rank)');
    // Requirement 7 itself is never one of the flagged codes — it's the
    // thing being submitted, not a dependency of itself.
    expect(errors.some((e) => e.parentCode === '7')).toBe(false);
  });

  it('ScoutRankTerminal_PassesGating_WhenAllOtherRequirementsArePendingInTheSameBatch', async () => {
    // Realistic one-shot Scout-First submission: a leader checks every
    // requirement including the Scoutmaster Conference on the same visit.
    const items = [
      ...SCOUT_OTHER_CODES.map((code) => ({
        scout_id: SCOUT_ID,
        kind: 'rank_requirement' as const,
        code: `scout-${code}`,
        label: code,
        unit: 'requirement'
      })),
      { scout_id: SCOUT_ID, kind: 'rank_requirement' as const, code: 'scout-7', label: 'Scoutmaster Conference', unit: 'requirement' }
    ];
    const errors = await validateAwardRows(admin, items);
    expect(errors).toEqual([]);
  });
});
