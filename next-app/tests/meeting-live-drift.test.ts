import { describe, it, expect } from 'vitest';
import { driftText, liveDrift, type DriftClass } from '../src/lib/meeting-live-shared';

/**
 * Rotations L0 (Plans/Build-A-Plan.md, "Rotations: one arrangement over the live plan"): where the plan and a started
 * arrangement disagree. Pure: the loader hands in what the Live page already loaded. The real case (Oct 25, entry 133):
 * Live started, then Patrick was made Star 6's teacher and Anjali picked Star 6; Live had no Star 6 class.
 */
const PAT = 1;
const MARIA = 2;
const ANJALI = 10;
const BEN = 11;
const CAL = 12;
const NAMES: Record<number, string> = { [PAT]: 'Patrick B', [MARIA]: 'Maria L', [ANJALI]: 'Anjali S', [BEN]: 'Ben T', [CAL]: 'Cal R' };
const LABELS: Record<string, string> = { 'star-6': 'Star 6', 'scout-1a': 'Scout 1a', 'tenderfoot-4a': 'Ten 4a', 'ff:campfire': 'Campfire' };

const cls = (o: Partial<DriftClass> & Pick<DriftClass, 'id' | 'topicKey'>): DriftClass => ({ title: LABELS[o.topicKey] ?? o.topicKey, teacherId: null, memberIds: [], version: 1, merged: false, ...o });
const pick = (key: string, later = false) => ({ key, later });

function drift(o: Partial<Parameters<typeof liveDrift>[0]> = {}) {
  return liveDrift({
    classes: [cls({ id: 'c:1', topicKey: 'scout-1a', teacherId: MARIA, memberIds: [BEN] })],
    board: [{ personId: BEN, intent: 'coming', picks: [pick('scout-1a')] }],
    topicTeachers: [{ key: 'scout-1a', personId: MARIA }],
    notComing: new Set(),
    seeded: new Set(),
    freeform: new Set(),
    labelOf: (k) => LABELS[k] ?? k,
    nameOf: (id) => NAMES[id] ?? '',
    ...o
  });
}
const texts = (o: Partial<Parameters<typeof liveDrift>[0]> = {}) => drift(o).map(driftText);

describe('liveDrift', () => {
  it('Drift_InStep_IsEmpty', () => {
    expect(drift()).toEqual([]);
  });

  it('Drift_OfferingWithNoClass_Shows', () => {
    expect(texts({ topicTeachers: [{ key: 'scout-1a', personId: MARIA }, { key: 'star-6', personId: PAT }] })).toEqual(['Star 6 has no class']);
  });

  it('Drift_PickWithNoClass_Shows', () => {
    const board = [
      { personId: BEN, intent: 'coming' as const, picks: [pick('scout-1a')] },
      { personId: ANJALI, intent: null, picks: [pick('star-6')] }
    ];
    expect(texts({ board, topicTeachers: [{ key: 'scout-1a', personId: MARIA }, { key: 'star-6', personId: PAT }] })).toEqual(['Star 6 has no class', 'Anjali S picked Star 6 · no class']);
  });

  it('Drift_PickWithNoClass_PlacedScout_IsNotFlagged', () => {
    const board = [{ personId: BEN, intent: 'coming' as const, picks: [pick('scout-1a'), pick('tenderfoot-4a')] }];
    expect(texts({ board })).toEqual([]);
  });

  it('Drift_LaterPick_IsNotFlagged', () => {
    const board = [
      { personId: BEN, intent: 'coming' as const, picks: [pick('scout-1a')] },
      { personId: CAL, intent: 'coming' as const, picks: [pick('star-6', true)] }
    ];
    expect(texts({ board })).toEqual([]);
  });

  it('Drift_CantMakeIt_Placed_Shows', () => {
    expect(texts({ board: [{ personId: BEN, intent: 'not_coming', picks: [pick('scout-1a')] }] })).toEqual(['Ben T said Can’t make it · in Scout 1a']);
  });

  it('Drift_DroppedPick_Shows', () => {
    expect(texts({ board: [{ personId: BEN, intent: 'coming', picks: [pick('tenderfoot-4a')] }] })).toEqual(['Ben T doesn’t pick Scout 1a']);
  });

  it('Drift_DroppedPick_MergedClass_IsNotFlagged', () => {
    const classes = [cls({ id: 'c:1', topicKey: 'scout-1a', teacherId: MARIA, memberIds: [BEN], merged: true })];
    expect(texts({ classes, board: [{ personId: BEN, intent: 'coming', picks: [pick('scout-1b')] }] })).toEqual([]);
  });

  it('Drift_TeacherMismatch_Shows', () => {
    const classes = [cls({ id: 'c:1', topicKey: 'scout-1a', teacherId: MARIA, memberIds: [BEN] })];
    expect(texts({ classes, topicTeachers: [{ key: 'scout-1a', personId: PAT }] })).toEqual(['Scout 1a: the plan says Patrick B, the class has Maria L']);
  });

  // Rotations L2 (Decision 4): a repeat of a class keeps its own teacher, so its differing from the plan isn't drift.
  it('Drift_TeacherOnARepeat_IsNotFlagged', () => {
    const classes = [
      cls({ id: 'c:1', topicKey: 'scout-1a', teacherId: MARIA, memberIds: [BEN] }),
      cls({ id: 'c:2', topicKey: 'scout-1a', teacherId: PAT })
    ];
    expect(drift({ classes }).filter((d) => d.kind === 'teacher')).toEqual([]);
  });

  it('Drift_TeacherOnPlan_CantMakeIt_IsNotThePlanTeacher', () => {
    expect(texts({ topicTeachers: [{ key: 'scout-1a', personId: MARIA }, { key: 'scout-1a', personId: PAT }], notComing: new Set([PAT]) })).toEqual([]);
  });

  it('Drift_OrphanClass_Shows', () => {
    const classes = [cls({ id: 'c:1', topicKey: 'scout-1a', teacherId: MARIA, memberIds: [BEN] }), cls({ id: 'c:2', topicKey: 'tenderfoot-4a' })];
    expect(texts({ classes })).toEqual(['Ten 4a is no longer on the plan']);
  });

  it('Drift_SeededClass_IsNotAnOrphan', () => {
    const classes = [cls({ id: 'c:1', topicKey: 'scout-1a', teacherId: MARIA, memberIds: [BEN] }), cls({ id: 'c:2', topicKey: 'tenderfoot-4a' })];
    expect(texts({ classes, seeded: new Set(['tenderfoot-4a']) })).toEqual([]);
  });

  it('Drift_FreeformClass_IsNotAnOrphan', () => {
    const classes = [cls({ id: 'c:1', topicKey: 'scout-1a', teacherId: MARIA, memberIds: [BEN] }), cls({ id: 'c:2', topicKey: 'ff:campfire' })];
    expect(texts({ classes, freeform: new Set(['ff:campfire']) })).toEqual([]);
  });

  it('Drift_Ids_AreStable', () => {
    const o = { topicTeachers: [{ key: 'scout-1a', personId: MARIA }, { key: 'star-6', personId: PAT }] };
    expect(drift(o).map((d) => d.id)).toEqual(drift(o).map((d) => d.id));
  });
});
