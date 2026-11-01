import { describe, it, expect } from 'vitest';
import { askedAtOf, scoutState, teacherChanged, teacherSnapOf, teacherState, type TeacherAnswer } from '../src/lib/plan-states';
import type { ScoutPlanSent } from '../src/lib/meeting-email-build';

/**
 * Planned, asked, confirmed (Plans/Meeting-Planner-III-Confirmations.md, C1): everything on the plan is a proposal until
 * the person answers. One pure state per teacher slot and per scout plan. Times are ISO strings.
 */
const card = (o: Partial<{ key: string; title: string; columns: { key: string }[] }> = {}) => ({
  key: 'fr:scout',
  title: 'Scout Group 1',
  columns: [{ key: 'scout-2a' }, { key: 'scout-1a' }],
  ...o
});
const snap = teacherSnapOf(card());
const yes = (at: string, plan = snap): TeacherAnswer => ({ answer: 'yes', answeredAt: at, plan, note: null });
const base = { onCard: true, hiddenByIntent: false, answer: null, askedAt: null, slotSince: '2026-10-30T10:00:00Z', now: snap };

describe('teacher snapshot', () => {
  it('Snapshot_IsTheCanonicalGroupAndSortedItemKeys', () => {
    expect(teacherSnapOf(card({ key: 'fr:scout~2' }), new Set(['fr:scout']))).toEqual({ group: 'fr:scout', itemKeys: ['scout-1a', 'scout-2a'], title: 'Scout Group 1' });
  });

  it('Changed_WhenTheRequirementsDiffer_NotWhenOnlyTheTitleDoes', () => {
    expect([
      teacherChanged(snap, teacherSnapOf(card({ title: 'Scout group' }))),
      teacherChanged(snap, teacherSnapOf(card({ columns: [{ key: 'scout-1a' }] }))),
      teacherChanged(snap, teacherSnapOf(card({ key: 'fr:tenderfoot' })))
    ]).toEqual([false, true, true]);
  });
});

describe('teacherState', () => {
  it('OnACard_NobodyTold_IsPlanned', () => {
    expect(teacherState(base)).toBe('planned');
  });

  it('EmailedAfterTheyWerePlanned_IsAsked', () => {
    expect(teacherState({ ...base, askedAt: '2026-10-30T12:00:00Z' })).toBe('asked');
  });

  it('AnEmailFromBeforeTheyWerePlanned_DoesNotCount', () => {
    expect(teacherState({ ...base, askedAt: '2026-10-29T12:00:00Z' })).toBe('planned');
  });

  it('SaidYes_IsConfirmed', () => {
    expect(teacherState({ ...base, askedAt: '2026-10-30T12:00:00Z', answer: yes('2026-10-30T13:00:00Z') })).toBe('confirmed');
  });

  it('SaidYes_ThenTheCardChanged_IsChanged', () => {
    expect(teacherState({ ...base, answer: yes('2026-10-30T13:00:00Z'), now: teacherSnapOf(card({ columns: [{ key: 'scout-3a' }] })) })).toBe('changed');
  });

  it('AskedAgainAfterAChangedYes_IsAsked', () => {
    expect(teacherState({ ...base, answer: yes('2026-10-30T13:00:00Z'), askedAt: '2026-10-30T15:00:00Z', now: teacherSnapOf(card({ columns: [{ key: 'scout-3a' }] })) })).toBe('asked');
  });

  it('SaidNo_IsOffTheCard_AndSaidNo', () => {
    expect(teacherState({ ...base, onCard: false, answer: { answer: 'no', answeredAt: '2026-10-30T13:00:00Z', plan: null, note: 'Out of town' } })).toBe('said_no');
  });

  it('PutBackOnTheCardAfterANo_IsPlannedAgain', () => {
    expect(teacherState({ ...base, slotSince: '2026-10-30T14:00:00Z', answer: { answer: 'no', answeredAt: '2026-10-30T13:00:00Z', plan: null, note: null } })).toBe('planned');
  });

  it('CantMakeItTheWholeMeeting_IsHidden_NotANo', () => {
    expect(teacherState({ ...base, hiddenByIntent: true, answer: yes('2026-10-30T13:00:00Z') })).toBe('hidden');
  });
});

describe('askedAtOf', () => {
  it('NewestEmailForThatPersonAndGroup_ReadingMergedKeysAsOne', () => {
    const sent = [
      { personId: 82, group: 'fr:scout~2', at: '2026-10-30T12:00:00Z' },
      { personId: 82, group: 'fr:scout', at: '2026-10-30T11:00:00Z' },
      { personId: 5, group: 'fr:scout', at: '2026-10-30T16:00:00Z' },
      { personId: 82, group: 'fr:tenderfoot', at: '2026-10-30T17:00:00Z' }
    ];
    expect([askedAtOf(sent, { personId: 82, groupKey: 'fr:scout', merged: new Set(['fr:scout']) }), askedAtOf(sent, { personId: 82, groupKey: 'fr:scout' })]).toEqual([
      '2026-10-30T12:00:00Z',
      '2026-10-30T11:00:00Z'
    ]);
  });
});

describe('scoutState', () => {
  const plan: ScoutPlanSent = { name: 'Lily', kind: 'rank', group: 'fr:scout~2', groupName: 'Scout', teachers: [], items: [{ key: 'scout-5', code: '5', label: 'x' }], helpName: null };
  const s = { intent: null, answer: null, askedAt: null, now: plan } as const;

  it('NotEmailed_IsPlanned_Emailed_IsAsked', () => {
    expect([scoutState(s), scoutState({ ...s, askedAt: '2026-10-30T12:00:00Z' })]).toEqual(['planned', 'asked']);
  });

  it('LooksGood_IsConfirmed_UntilThePlanChanges', () => {
    const answer = { answeredAt: '2026-10-30T13:00:00Z', plan };
    expect([scoutState({ ...s, answer }), scoutState({ ...s, answer, now: { ...plan, items: [{ key: 'scout-6', code: '6', label: 'y' }] } })]).toEqual(['confirmed', 'changed']);
  });

  it('CantMakeIt_IsSaidNo', () => {
    expect(scoutState({ ...s, intent: 'not_coming' })).toBe('said_no');
  });
});
