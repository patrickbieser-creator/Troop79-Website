import { describe, it, expect } from 'vitest';
import { DEFAULT_TEACHER_ASK, DEFAULT_TEACHER_PLANNED, renderTeacherEmail, type TeacherEmailGroup } from '../src/lib/meeting-invite-email';

/** The teacher email for a group of the night (Patrick, 2026-10-31): the group by name (its rank, and Group n when
 *  split) with its requirements, then "Scouts:", a blank line and each scout's full name on a line of its own (a
 *  private email); questions go to the troop's address. Since 2026-11-01 its one button opens the family link's teacher
 *  card (Plans/Planner-Teacher-Email-To-Family-Card.md). */
const group = (o: Partial<TeacherEmailGroup> = {}): TeacherEmailGroup => ({ title: 'Scout Group 2', codes: '4a, 4b, 5, 6, 7', minutes: 'about 60 min', scouts: ['Aubrey Reinelt', 'Piper Kingston'], ...o });
const md = (g: TeacherEmailGroup, planned = false) =>
  renderTeacherEmail(planned ? DEFAULT_TEACHER_PLANNED : DEFAULT_TEACHER_ASK, { name: 'Patrick', day: 'Sunday, November 1' }, g, { planned }).md;

describe('teacher email for a group', () => {
  it('NamesTheGroupAndRank_WithItsRequirements', () => {
    expect(md(group())).toContain('- **Scout Group 2**: 4a, 4b, 5, 6, 7 (about 60 min)');
  });

  it('ListsTheScouts_OneFullNameALine_AfterABlankLine', () => {
    expect(md(group())).toContain('**Scouts:**\n\n- Aubrey Reinelt\n- Piper Kingston');
  });

  it('NoScoutsPlacedYet_SaysSo', () => {
    expect(md(group({ scouts: [] }))).toContain('**Scouts:**\n\nNone placed in this group yet.');
  });

  it('APlannedTeacher_IsAskedToConfirm_NotAskedIfTheyCan', () => {
    expect([md(group(), true).includes('**You’re planned to teach:**'), md(group(), true).includes('Can you teach?'), md(group()).includes('**Can you teach?**')]).toEqual([true, false, true]);
  });

  it('Questions_GoToTheTroopsAddress', () => {
    expect([md(group()), md(group(), true)].every((m) => m.includes('Questions? Reply to bsatroop79bg@gmail.com.'))).toBe(true);
  });

  it('Body_CarriesNoLinkOfItsOwn_TheButtonIsTheEmailsAction', () => {
    expect([md(group()), md(group(), true)].some((m) => m.includes(']('))).toBe(false);
  });

  it('NeitherEmail_SaysAnswerYesOrNo', () => {
    expect([md(group()), md(group(), true)].some((m) => /yes or no with the button|Answer yes or no/i.test(m))).toBe(false);
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
