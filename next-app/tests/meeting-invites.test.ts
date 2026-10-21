import { describe, it, expect } from 'vitest';
import { countInvites, inviteCountsText, inviteExpiresAt, inviteState } from '../src/lib/meeting-invites';

/** Meeting invites, P1 (Plans/Matcher-Tune-Up.md T-5): the pure rules. */

describe('invite expiry', () => {
  it('Invite_ExpiresAtSixPmCentral_OnTheMeetingDay_InDaylightTime', () => {
    expect(inviteExpiresAt('2026-10-25')).toBe('2026-10-25T23:00:00.000Z');
  });

  it('Invite_ExpiresAtSixPmCentral_OnTheMeetingDay_InStandardTime', () => {
    expect(inviteExpiresAt('2026-11-08')).toBe('2026-11-09T00:00:00.000Z');
  });

  it('Invite_ExpiresAtSixPmCentral_OnTheDstChangeDay', () => {
    // Sunday Nov 1 2026: clocks fall back at 2 AM, so 6 PM is already CST.
    expect(inviteExpiresAt('2026-11-01')).toBe('2026-11-02T00:00:00.000Z');
  });
});

describe('invite state', () => {
  const now = new Date('2026-10-25T20:00:00Z');
  const row = (o: Partial<{ expires_at: string; consumed_at: string | null; response: 'accepted' | 'declined' | null }> = {}) => ({
    expires_at: '2026-10-25T23:00:00Z',
    consumed_at: null,
    response: null,
    ...o
  });

  it('Link_IsOpen_BeforeItsTime_AndUnanswered', () => {
    expect(inviteState(row(), now)).toBe('open');
  });

  it('Link_SaysAnswered_NotBroken_OnceSomeoneSaidYes', () => {
    expect(inviteState(row({ consumed_at: '2026-10-25T19:00:00Z', response: 'accepted' }), now)).toBe('answered');
  });

  it('Link_IsExpired_AfterSixPm', () => {
    expect(inviteState(row({ expires_at: '2026-10-25T19:00:00Z' }), now)).toBe('expired');
  });

  it('Link_IsVoid_WhenSpentWithoutAnAnswer', () => {
    expect(inviteState(row({ consumed_at: '2026-10-25T19:00:00Z' }), now)).toBe('void');
  });

  it('Link_IsUnknown_WithNoRow', () => {
    expect(inviteState(null, now)).toBe('unknown');
  });
});

describe('board counts', () => {
  it('Board_CountsEachPersonOnce_ByTheirAnswer', () => {
    const c = countInvites([
      { topic_key: 'a', invitee_person_id: 1, response: null },
      { topic_key: 'a', invitee_person_id: 1, response: 'accepted' },
      { topic_key: 'a', invitee_person_id: 2, response: 'declined' },
      { topic_key: 'a', invitee_person_id: 3, response: null }
    ]);
    expect(inviteCountsText(c.get('a'))).toBe('Invited 3 · 1 yes · 1 no');
  });

  it('Board_CountsAScoutOnce_ThoughBothParentsWereEmailed_AndBothSaidNo', () => {
    const c = countInvites([
      { topic_key: 'a', invitee_person_id: 7, response: 'declined' },
      { topic_key: 'a', invitee_person_id: 7, response: 'declined' },
      { topic_key: 'a', invitee_person_id: 8, response: 'declined' },
      { topic_key: 'a', invitee_person_id: 8, response: 'accepted' }
    ]);
    expect(inviteCountsText(c.get('a'), 'Offered to')).toBe('Offered to 2 · 1 yes · 1 no');
  });

  it('Board_SaysNothing_WhenNobodyWasInvited', () => {
    expect(inviteCountsText(undefined)).toBe('');
  });
});
