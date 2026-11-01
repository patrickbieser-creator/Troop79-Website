import { describe, it, expect } from 'vitest';
import { DEFAULT_INVITE_DIGEST, renderInviteDigest, type DigestItem } from '../src/lib/meeting-invite-email';

/** The teacher email for a group of the night (Patrick, 2026-10-31): the group by name (its rank, and Group n when
 *  split) with its requirements, then "Scouts:", a blank line and each scout's full name on a line of its own (a
 *  private email); questions go to the troop's address. */
const item = (o: Partial<DigestItem> = {}): DigestItem => ({
  kind: 'teach',
  inviteeName: 'Patrick B',
  aboutRecipient: true,
  code: '4a, 4b, 5, 6, 7',
  topic: 'Scout Group 2',
  minutes: 'about 60 min',
  url: 'https://x/i/teach/t',
  scouts: ['Aubrey Reinelt', 'Piper Kingston'],
  ...o
});
const md = (i: DigestItem) => renderInviteDigest(DEFAULT_INVITE_DIGEST, { name: 'Patrick', people: 'you', day: 'Sunday, November 1' }, [i]).md;

describe('teacher email for a group', () => {
  it('NamesTheGroupAndRank_WithItsRequirements', () => {
    expect(md(item())).toContain('- **Scout Group 2**: 4a, 4b, 5, 6, 7 (about 60 min)');
  });

  it('ListsTheScouts_OneFullNameALine_AfterABlankLine', () => {
    expect(md(item())).toContain('**Scouts:**\n\n- Aubrey Reinelt\n- Piper Kingston');
  });

  it('NoScoutsPlacedYet_SaysSo', () => {
    expect(md(item({ scouts: [] }))).toContain('**Scouts:**\n\nNone placed in this group yet.');
  });

  it('APlannedTeacher_IsAskedToConfirm_NotAskedIfTheyCan', () => {
    expect([md(item({ planned: true })).includes('**You’re planned to teach:**'), md(item({ planned: true })).includes('Can you teach?'), md(item()).includes('**Can you teach?**')]).toEqual([true, false, true]);
  });

  it('Questions_GoToTheTroopsAddress', () => {
    expect(md(item())).toContain('Questions? Reply to bsatroop79bg@gmail.com.');
  });
});

describe('teacherCardOf', () => {
  it('UsesTheGroupTitle_FullNames_AndLeavesOutCantCome', async () => {
    const { teacherCardOf } = await import('../src/lib/teacher-email-card');
    const view = {
      groups: [
        {
          key: 'fr:scout~2',
          kind: 'badge',
          title: 'Scout Group 2',
          columns: [{ code: '5' }, { code: '6' }],
          members: [
            { personId: 1, name: 'Aubrey R', intent: null },
            { personId: 2, name: 'Piper K', intent: 'coming' },
            { personId: 3, name: 'Todd M', intent: 'not_coming' }
          ]
        }
      ]
    } as never;
    const input = { scouts: [{ personId: 1, name: 'Aubrey Reinelt' }, { personId: 2, name: 'Piper Kingston' }, { personId: 3, name: 'Todd Manke' }] } as never;
    const card = teacherCardOf(view, input, 'fr:scout~2', { ranks: [], rankRequirements: [], meritBadges: [], meritBadgeRequirements: [] })!;
    expect([card.title, card.codes, card.scouts]).toEqual(['Scout Group 2', '5, 6', ['Aubrey Reinelt', 'Piper Kingston']]);
  });
});
