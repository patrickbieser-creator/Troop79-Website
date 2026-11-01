import { describe, it, expect } from 'vitest';
import { answerOf, emailWords, initialsOf, scoutAnswerWord, teacherAnswerWord, toHint } from '../src/lib/meeting-email-log';

/** The Sent log's words (Patrick, 2026-11-01): one line per email, saying what it was, who it went to (more on hover),
 *  how it landed, and what they've answered since. */
describe('what the email was', () => {
  it('APlanEmail_IsTheScoutsPlan', () => {
    expect(emailWords({ kind: 'plan', scoutNames: ['Fiona K', 'Jameson K'], groupTitle: null, planned: false })).toBe('Fiona K and Jameson K’s plan');
  });

  it('ATeacherEmail_ToAPlannedTeacher_AsksThemToConfirm', () => {
    expect(emailWords({ kind: 'teacher', scoutNames: [], groupTitle: 'Scout Group 2', planned: true })).toBe('Planned to teach Scout Group 2: confirm');
  });

  it('ATeacherEmail_ToSomeoneElse_AsksThemToTeach', () => {
    expect(emailWords({ kind: 'teacher', scoutNames: [], groupTitle: 'First Class group', planned: false })).toBe('Ask to teach First Class group');
  });

  it('ATeacherEmail_ForAGroupGoneFromThePlan_SaysSo', () => {
    expect(emailWords({ kind: 'teacher', scoutNames: [], groupTitle: null, planned: false })).toBe('Ask to teach a group no longer on the plan');
  });

  it('AReminder_IsComingSunday', () => {
    expect(emailWords({ kind: 'reminder', scoutNames: ['Ben B'], groupTitle: null, planned: false })).toBe('Coming Sunday? reminder');
  });
});

describe('who it went to, on hover', () => {
  it('AParent_IsNamedAsTheScoutsParent_WithTheAddress', () => {
    expect(toHint({ sentTo: 'melissa@example.com', recipientIsScout: false, scoutNames: ['Solomon R'], cc: [] })).toBe('Parent of Solomon R · melissa@example.com');
  });

  it('AScoutsOwnAddress_SaysSo', () => {
    expect(toHint({ sentTo: 'sol@example.com', recipientIsScout: true, scoutNames: ['Solomon R'], cc: [] })).toBe('Solomon R’s own address · sol@example.com');
  });

  it('ACopiedEmail_NamesTheCopies', () => {
    expect(toHint({ sentTo: 'oliver@example.com', recipientIsScout: true, scoutNames: [], cc: ['nate@example.com', 'becky@example.com'] })).toBe('oliver@example.com · copies nate@example.com, becky@example.com');
  });
});

describe('who sent it', () => {
  it('Initials_AreFirstAndLastName', () => {
    expect([initialsOf('Patrick Bieser'), initialsOf('Mary Ann van Dyke'), initialsOf('Cher')]).toEqual(['PB', 'MD', 'C']);
  });
});

describe('what they answered', () => {
  it('AScoutsAnswer_ReadsAsTheFamilySaidIt', () => {
    expect([scoutAnswerWord('confirmed', 'coming'), scoutAnswerWord('changed', 'coming'), scoutAnswerWord(undefined, 'coming'), scoutAnswerWord(undefined, 'undecided'), scoutAnswerWord(undefined, 'not_coming'), scoutAnswerWord(undefined, null)]).toEqual([
      'Plan looks good ✓',
      'Changed plan',
      'Coming',
      'Not sure',
      'Not this week',
      'No answer yet'
    ]);
  });

  it('ATeachersAnswer_ReadsAsTheTeacherSaidIt', () => {
    expect([
      teacherAnswerWord({ state: 'confirmed', saidNo: false, intent: null }),
      teacherAnswerWord({ state: 'changed', saidNo: false, intent: null }),
      teacherAnswerWord({ state: undefined, saidNo: true, intent: null }),
      teacherAnswerWord({ state: 'planned', saidNo: false, intent: 'not_coming' }),
      teacherAnswerWord({ state: 'planned', saidNo: false, intent: null })
    ]).toEqual(['I’ll teach ✓', 'Changed plan', 'Not this week', 'Not this week', 'No answer yet']);
  });

  it('OneEmailForTwoScouts_WhoAnsweredAlike_IsOneWord', () => {
    expect(answerOf([{ name: 'Fiona K', word: 'Coming' }, { name: 'Jameson K', word: 'Coming' }])).toEqual({ word: 'Coming', answered: true });
  });

  it('OneEmailForTwoScouts_WhoAnsweredDifferently_NamesEach', () => {
    expect(answerOf([{ name: 'Fiona K', word: 'Coming' }, { name: 'Jameson K', word: 'No answer yet' }])).toEqual({ word: 'Fiona K: Coming · Jameson K: No answer yet', answered: true });
  });

  it('NoAnswerFromAnyone_IsNotAnswered', () => {
    expect(answerOf([{ name: 'Ben B', word: 'No answer yet' }]).answered).toBe(false);
  });
});
