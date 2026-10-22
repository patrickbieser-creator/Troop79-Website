import { describe, it, expect } from 'vitest';
import { likelyFit, unfinishedMembers } from '../src/lib/build-plan';
import { chipLabel, defaultTicks, inviteChips, sendPlan, tickId, ticksAfterSend, DIGEST_EMAIL_CAP, type InvitePerson, type InviteSection } from '../src/lib/meeting-invite-digest';
import { rankTrees } from '../src/lib/meeting-board-picklist';

/**
 * Build a Plan B6 (Plans/Build-A-Plan.md "B6: Invite tab"), the pure half: the one likely rule, the status chips from
 * the meeting's invite history, the re-ask rule and the per-send caps. No database.
 */
const RANKS = [
  { id: 'scout', display_name: 'Scout', sort_order: 1 },
  { id: 'tenderfoot', display_name: 'Tenderfoot', sort_order: 2 },
  { id: 'second-class', display_name: 'Second Class', sort_order: 3 },
  { id: 'first-class', display_name: 'First Class', sort_order: 4 }
] as Parameters<typeof likelyFit>[2];
const BADGES = [{ id: 'first-aid', name: 'First Aid' }];

const person = (personId: number, o: Partial<InvitePerson> = {}): InvitePerson => ({ personId, name: `P${personId}`, reason: '', likely: true, recipients: [personId + 1000], blocked: null, ...o });

describe('the likely rule (B6)', () => {
  it('InviteTab_LikelyScouts_ExcludesLowerRankForFocusSet', () => {
    // A mix of First Class 4a and 5c: a Second Class scout (working on First Class) is likely; a Tenderfoot scout
    // (working on Second Class) is not, though nothing rules them out.
    const members = ['first-class-4a', 'first-class-5c'];
    const fit = (currentRank: string) => likelyFit({ currentRank, unfinished: members }, 'fg:7', RANKS).likely;
    expect([fit('second-class'), fit('tenderfoot')]).toEqual([true, false]);
  });

  it('InviteTab_LikelyMix_NamesThePartsItCovers', () => {
    expect(likelyFit({ currentRank: 'second-class', unfinished: ['first-class-4a', 'first-class-5c'] }, 'fg:7', RANKS).covers).toEqual(['4a', '5c']);
  });

  it('InviteTab_FinishedMembers_DontCount', () => {
    const trees = rankTrees([{ id: 1, rank_id: 'first-class', parent_id: null, code: '4a', label: 'x', sort_order: 1 }] as never);
    const open = unfinishedMembers(['first-class-4a'], { currentRank: 'second-class', ranks: RANKS, trees, rankCodes: new Set(['first-class-4a']), awardedMbs: new Set(), badges: BADGES });
    expect(open).toEqual([]);
  });

  it('InviteTab_MbLikely_RequiresBadgeInProgress', () => {
    const fit = (inProgress: string[]) => likelyFit({ currentRank: 'first-class', badgesInProgress: new Set(inProgress) }, 'first-aid-9', RANKS, BADGES).likely;
    expect([fit([]), fit(['first-aid'])]).toEqual([false, true]);
  });
});

describe('status chips (B6)', () => {
  const now = new Date('2026-10-22T18:00:00Z');
  const row = (sent_at: string, response: string | null = null) => ({ kind: 'pick' as const, topic_key: 'tenderfoot-4a', invitee_person_id: 7, response, sent_at });

  it('InviteTab_StatusChips_ShowEarlierAsks', () => {
    const c = inviteChips([row('2026-10-20T15:00:00Z')], now).get(tickId('pick', 'tenderfoot-4a', 7));
    expect(chipLabel(c?.chip, c?.at, () => 'Tue')).toBe('Asked Tue');
  });

  it('InviteTab_StatusChips_LatestAnswerWins', () => {
    const c = inviteChips([row('2026-10-19T15:00:00Z', 'declined'), row('2026-10-20T15:00:00Z', 'accepted')], now).get(tickId('pick', 'tenderfoot-4a', 7));
    expect(chipLabel(c?.chip, c?.at, () => 'Tue')).toBe('Yes');
  });

  it('InviteTab_StatusChips_FreshAskIsUnder24h', () => {
    const c = inviteChips([row('2026-10-22T10:00:00Z')], now).get(tickId('pick', 'tenderfoot-4a', 7));
    expect(chipLabel(c?.chip, c?.at, () => 'Thu')).toBe('Asked <24h');
  });
});

describe('default ticks (B6)', () => {
  it('InviteTab_ReAsk_After24h_IsUnticked', () => {
    const sections: InviteSection[] = [{ key: 'tenderfoot-4a', teachers: [], scouts: [person(1, { chip: 'asked', askedAt: '2026-10-20T15:00:00Z' }), person(2)] }];
    expect([...defaultTicks(sections, () => true)]).toEqual([tickId('pick', 'tenderfoot-4a', 2)]);
  });

  it('InviteTab_Teachers_TickedOnlyWithNoTeacherAndNoPendingAsk', () => {
    const sections: InviteSection[] = [
      { key: 'a', teachers: [person(1, { tier: 'top' })], scouts: [] },
      { key: 'b', teachers: [person(2, { tier: 'pending', chip: 'asked' }), person(3, { tier: 'top' })], scouts: [] },
      { key: 'c', teachers: [person(4, { tier: 'top' })], scouts: [] }
    ];
    expect([...defaultTicks(sections, (k) => k === 'c')]).toEqual([tickId('teach', 'a', 1)]);
  });

  it('InviteTab_Teachers_PastTheTopFive_StartUnticked', () => {
    const sections: InviteSection[] = [{ key: 'a', teachers: [person(1, { tier: 'top' }), person(2, { tier: 'more' }), person(3, { tier: 'scout', blocked: 'Ask a scout in person' })], scouts: [] }];
    expect([...defaultTicks(sections, () => false)]).toEqual([tickId('teach', 'a', 1)]);
  });
});

describe('per-send caps (B6)', () => {
  it('InviteTab_Caps_MarkOverflowAndSendTheRest', () => {
    const scouts = Array.from({ length: DIGEST_EMAIL_CAP + 3 }, (_, i) => person(i + 1));
    const sections: InviteSection[] = [{ key: 'a', teachers: [], scouts }];
    const ticks = new Set(scouts.map((p) => tickId('pick', 'a', p.personId)));
    const plan = sendPlan(sections, ticks, {});
    expect([plan.emails, plan.overflow.size]).toEqual([DIGEST_EMAIL_CAP, 3]);
  });

  it('InviteTab_Caps_TwentyOfferingsASend', () => {
    const sections: InviteSection[] = Array.from({ length: 22 }, (_, i) => ({ key: `k${i}`, teachers: [], scouts: [person(1)] }));
    const ticks = new Set(sections.map((s) => tickId('pick', s.key, 1)));
    expect(sendPlan(sections, ticks, {}).offerings).toBe(20);
  });

  it('InviteTab_SendPlan_CountsFamilies', () => {
    const sections: InviteSection[] = [{ key: 'a', teachers: [person(9, { recipients: [9] })], scouts: [person(1, { recipients: [40, 41] }), person(2, { recipients: [40] })] }];
    const ticks = new Set([tickId('teach', 'a', 9), tickId('pick', 'a', 1), tickId('pick', 'a', 2)]);
    const plan = sendPlan(sections, ticks, { 9: { family: 'h1' }, 40: { family: 'h2' }, 41: { family: 'h2' } });
    expect([plan.emails, plan.families]).toEqual([3, 2]);
  });
});

/** B6 qa follow-ups (2026-10-22). */
describe('B6 qa follow-ups (pure)', () => {
  it('InviteTab_MixMember_HeldBackByRankRules_DoesntCover', () => {
    // First Class 12 is the Scoutmaster conference: held back until 95% of the rank, so it covers nothing yet.
    const trees = rankTrees([
      { id: 1, rank_id: 'first-class', parent_id: null, code: '4a', label: 'x', sort_order: 1 },
      { id: 2, rank_id: 'first-class', parent_id: null, code: '12', label: 'SMC', sort_order: 2 }
    ] as never);
    const open = unfinishedMembers(['first-class-4a', 'first-class-12'], { currentRank: 'second-class', ranks: RANKS, trees, rankCodes: new Set(), awardedMbs: new Set(), badges: BADGES });
    expect(open).toEqual(['first-class-4a']);
  });

  it('InviteTab_Send_OverflowAndSkippedStayTicked', () => {
    // 1 was sent (the refreshed data shows a fresh ask), 2 was skipped by the server (no chip), 3 was past the cap.
    const sections: InviteSection[] = [{ key: 'a', teachers: [], scouts: [person(1, { chip: 'recent', blocked: 'Asked in the last day' }), person(2), person(3)] }];
    const ticks = new Set([1, 2, 3].map((id) => tickId('pick', 'a', id)));
    expect([...ticksAfterSend(ticks, sections)]).toEqual([tickId('pick', 'a', 2), tickId('pick', 'a', 3)]);
  });
});
