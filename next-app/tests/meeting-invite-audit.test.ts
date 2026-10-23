import { describe, it, expect } from 'vitest';
import { inviteAnswerSummary } from '../src/lib/meeting-invite-audit';

/**
 * An invite answered from its link names who, for whom, what and when (Patrick, 2026-10-22). The DB-backed half is in
 * tests/meeting-invites-db.test.ts and tests/meeting-pick-invites-db.test.ts.
 */
const base = { recipient: 'Patrick B', invitee: 'Patrick B', self: true, topic: 'Star 6 · Cyber Chip', day: 'Oct 25' };

describe('inviteAnswerSummary', () => {
  it('TeachYes_NamesTeacherTopicAndDay', () => {
    expect(inviteAnswerSummary({ ...base, kind: 'teach', response: 'accepted' })).toBe('Patrick B said yes to teaching Star 6 · Cyber Chip (Oct 25)');
  });

  it('TeachNo_SaysNotThisWeek', () => {
    expect(inviteAnswerSummary({ ...base, kind: 'teach', response: 'declined' })).toBe('Patrick B said not this week to teaching Star 6 · Cyber Chip (Oct 25)');
  });

  it('ParentForScout_NamesBoth', () => {
    expect(inviteAnswerSummary({ kind: 'pick', response: 'declined', recipient: 'Dana W', invitee: 'Anjali S', self: false, topic: 'Ten 3a · Square Knot', day: 'Oct 25' })).toBe(
      'Dana W said not this week for Anjali S: Ten 3a · Square Knot (Oct 25)'
    );
  });

  it('ScoutForThemself_NamesOnlyThem', () => {
    expect(inviteAnswerSummary({ kind: 'pick', response: 'accepted', recipient: 'Anjali S', invitee: 'Anjali S', self: true, topic: 'Ten 3a · Square Knot', day: 'Oct 25' })).toBe(
      'Anjali S said yes to Ten 3a · Square Knot (Oct 25)'
    );
  });
});
