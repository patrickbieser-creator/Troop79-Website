import { describe, it, expect } from 'vitest';
import { scoutsHelped, type HelpedCandidate } from '../src/lib/meeting-invite-digest';
import { DEFAULT_INVITE_DIGEST, renderInviteDigest, type DigestItem } from '../src/lib/meeting-invite-email';

/**
 * Build a Plan B10a (Plans/Build-A-Plan.md "B10 spec"): each class line in the teacher digest says how many scouts it
 * would help and names them (first name + last initial: it goes to adults). Picked scouts first, then the likely ones
 * (the one likely rule); Can't-make-it scouts never; five names, then "and N more". Pure: no database.
 */
const cand = (name: string, o: Partial<HelpedCandidate> = {}): HelpedCandidate => ({ name, picked: false, likely: true, ...o });

describe('scoutsHelped', () => {
  it('ScoutsHelped_PicksBeforeLikely', () => {
    const h = scoutsHelped([cand('Anjali Smith'), cand('Zoe Young', { picked: true, likely: false }), cand('Finn Parker', { likely: false })]);
    expect(h.names).toEqual(['Zoe Y', 'Anjali S']);
  });

  it('ScoutsHelped_CapsAtFivePlusMore', () => {
    const h = scoutsHelped(['Al A', 'Bo B', 'Cy C', 'Di D', 'Ed E', 'Fy F', 'Gu G'].map((n) => cand(n)));
    expect(h).toEqual({ count: 7, names: ['Al A', 'Bo B', 'Cy C', 'Di D', 'Ed E'], more: 2 });
  });

  it('ScoutsHelped_ExcludesNotComing', () => {
    const h = scoutsHelped([cand('Finn Parker', { picked: true, intent: 'not_coming' }), cand('Leo King', { intent: 'coming' })]);
    expect(h.names).toEqual(['Leo K']);
  });
});

describe('the teacher digest', () => {
  const teach = (o: Partial<DigestItem>): DigestItem => ({
    kind: 'teach',
    inviteeName: 'Kim L',
    aboutRecipient: true,
    code: 'Tenderfoot 3a',
    topic: 'Square Knot use',
    minutes: 'about 20 min',
    url: 'https://example.com/i/x',
    ...o
  });

  it('Digest_TeachLine_NoScoutsYet', () => {
    const { md } = renderInviteDigest(DEFAULT_INVITE_DIGEST, { name: 'Kim', people: 'you', day: 'Sunday' }, [teach({ minutes: '', helped: scoutsHelped([]) })]);
    expect(md).toContain('- **Ten 3a** Square Knot use: no scouts yet');
  });
});
