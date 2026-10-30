import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OfferChoices, TeachView, WantedItem } from '../src/lib/meeting-board-supply';

/**
 * /member/meeting (Phase 2): "Teach at a meeting". Saves on tap; a third commitment says why in place; topics outside
 * the person's skills can still be taken; a Junior Leader answers in the scout section and never gets an adults-only
 * button; "Offer something" marks problems in place and posts one row per date. The server actions are the mock
 * boundary.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('../src/app/(public)/member/meeting/actions', () => ({
  meetingAddPickAction: vi.fn(),
  meetingRemovePickAction: vi.fn(),
  meetingSetOrderAction: vi.fn(),
  meetingSetNoteAction: vi.fn(),
  meetingSetIntentAction: vi.fn()
}));
const calls = vi.hoisted(() => ({ teach: vi.fn(), unteach: vi.fn(), withdraw: vi.fn(), intent: vi.fn(), offer: vi.fn() }));
vi.mock('../src/app/(public)/member/meeting/teach-actions', () => ({
  meetingTeachAction: calls.teach,
  meetingUnteachAction: calls.unteach,
  meetingWithdrawOfferAction: calls.withdraw,
  meetingTeacherIntentAction: calls.intent,
  meetingPostOfferAction: calls.offer
}));

const { TeachBoard } = await import('../src/app/(public)/member/meeting/teach-board');

const wanted = (key: string, label: string, over: Partial<WantedItem> = {}): WantedItem => ({
  key,
  label,
  codeLabel: `Tenderfoot ${key.split('-')[1]}`,
  scouts: 2,
  names: ['Finn P', 'Leo M'],
  weeks: 2,
  teachers: [],
  qualified: true,
  flags: [],
  refused: false,
  ...over
});
const VIEW: TeachView = {
  personId: 9,
  kind: 'adult',
  intent: null,
  count: 0,
  items: [],
  wanted: [wanted('tenderfoot-3a', 'Knots'), wanted('tenderfoot-4a', 'First aid', { qualified: false, flags: ['not in what you’ve said you can teach'], minutes: 25, parts: [{ code: '4a.1', label: 'Simple cuts', minutes: 5 }, { code: '4a.2', label: 'Blisters', minutes: 20 }] })],
  hasSkills: true,
  canAdd: true
};
const CHOICES: OfferChoices = {
  skills: [{ id: 'knots', name: 'Knots & Lashings' }],
  requirements: [{ rank: 'Tenderfoot', options: [{ key: 'tenderfoot-3a', label: '3a Knots' }] }],
  dates: [
    { entryId: 1, label: 'Nov 1' },
    { entryId: 2, label: 'Nov 8' }
  ]
};
const ok = (view: Partial<TeachView>) => ({ ok: true as const, view: { ...VIEW, ...view } });

function board(view: Partial<TeachView> = {}, over: Partial<Parameters<typeof TeachBoard>[0]> = {}) {
  return render(
    <TeachBoard
      entryId={1}
      subject={{ personId: 9, firstName: 'Dan', name: 'Dan Vest', isSelf: true }}
      initial={{ ...VIEW, ...view }}
      choices={CHOICES}
      onBehalf={false}
      readOnly={false}
      {...over}
    />
  );
}

beforeEach(() => {
  for (const f of Object.values(calls)) f.mockReset();
});

describe('TeachBoard', () => {
  it('Parent_CanCommitToTeachTopic_OnTap', async () => {
    calls.teach.mockResolvedValue(ok({ count: 1 }));
    board();
    const row = screen.getByText('Knots').closest('div')!.parentElement!;
    await userEvent.click(within(row).getByRole('button', { name: 'I’ll teach this' }));
    expect(calls.teach).toHaveBeenCalledWith({ entryId: 1, personId: 9, onBehalf: false, key: 'tenderfoot-3a' });
  });

  it('Adult_TeachingTwo_CanStillTakeAThird', async () => {
    calls.teach.mockResolvedValue(ok({ count: 3 }));
    board({ count: 2 });
    const row = screen.getByText('Knots').closest('div')!.parentElement!;
    await userEvent.click(within(row).getByRole('button', { name: 'I’ll teach this' }));
    expect(calls.teach.mock.calls.length).toBe(1);
  });

  it('Adult_SeesHowLongATopicTakes_AndItsParts', () => {
    board();
    const row = screen.getByText('First aid').closest('div')!;
    const parts = within(row).getByRole('list', { name: 'First aid, its parts' });
    expect([row.textContent?.includes('about 25 min'), parts.querySelectorAll('li').length]).toEqual([true, 2]);
  });

  it('Adult_SeesWantedTopics_WithCountsAndNames', () => {
    board();
    expect(screen.getByText('Knots').closest('div')!.textContent).toContain('2 scouts · asked 2 weeks');
  });

  it('Adult_CanStillTakeATopicOutsideTheirSkills_Flagged', () => {
    board();
    const other = screen.getByText('Other things scouts asked for').closest('details')!;
    expect([within(other).getByText(/not in what you’ve said you can teach/) != null, within(other).getAllByRole('button', { name: 'I’ll teach this' }).length]).toEqual([true, 1]);
  });

  it('JuniorLeader_SeesHelpTeach_WithNoIntentControl_AndNoAdultsOnlyButton', () => {
    board({ kind: 'junior', wanted: [wanted('tenderfoot-4a', 'First aid', { qualified: false, refused: true })] });
    expect([screen.getByText('Junior Leader') != null, screen.queryByRole('radiogroup', { name: /coming/ }), screen.queryAllByRole('button', { name: 'I’ll teach this' }).length]).toEqual([true, null, 0]);
  });

  it('Adult_NotSureYet_SavesOnTap_AndSaysWellFindSomething', async () => {
    calls.intent.mockResolvedValue(ok({ intent: 'undecided' }));
    board();
    await userEvent.click(screen.getByRole('radio', { name: 'Not sure yet' }));
    expect([calls.intent.mock.calls[0][0].intent, await screen.findByText('We’ll find something that fits.')]).toEqual(['undecided', expect.anything()]);
  });

  it('Adult_SkillOffer_CountsAsOne_AndCanBeWithdrawn', async () => {
    calls.withdraw.mockResolvedValue(ok({}));
    board({ count: 1, items: [{ kind: 'offer', key: 'knots', label: 'Knots & Lashings', sub: 'Any requirement', scouts: 0, names: [], flags: [], note: null, alsoOn: ['Nov 8'] }] });
    expect(screen.queryByText('1 of 2')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw Knots & Lashings' }));
    expect(calls.withdraw.mock.calls[0][0]).toMatchObject({ skillId: 'knots' });
  });

  it('Offer_WithNothingChosen_MarksTheFieldInPlace', async () => {
    board();
    await userEvent.click(screen.getByRole('button', { name: 'Offer something' }));
    await userEvent.click(screen.getByRole('button', { name: 'Post offer' }));
    expect([screen.getByText('Choose a skill.') != null, calls.offer.mock.calls.length]).toEqual([true, 0]);
  });

  it('Offer_SeveralDates_PostsEachDate', async () => {
    calls.offer.mockResolvedValue(ok({}));
    board();
    await userEvent.click(screen.getByRole('button', { name: 'Offer something' }));
    await userEvent.selectOptions(screen.getByLabelText('Skill'), 'knots');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Nov 8' }));
    await userEvent.type(screen.getByLabelText(/Note/), 'Bring rope');
    await userEvent.click(screen.getByRole('button', { name: 'Post offer' }));
    expect(calls.offer.mock.calls[0][0]).toEqual({ entryId: 1, personId: 9, onBehalf: false, what: { type: 'skill', skillId: 'knots' }, entryIds: [1, 2], note: 'Bring rope' });
  });

  it('Offer_FullDate_FromTheServer_MarksTheDatesField', async () => {
    calls.offer.mockResolvedValue({ ok: false, error: 'You’re teaching 2 on Nov 8. Remove one there, or pick other dates.', field: 'dates' });
    board();
    await userEvent.click(screen.getByRole('button', { name: 'Offer something' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Something else' }));
    await userEvent.type(screen.getByLabelText('What you’ll teach'), 'Knife sharpening');
    await userEvent.click(screen.getByRole('button', { name: 'Post offer' }));
    const shown = await screen.findAllByText('You’re teaching 2 on Nov 8. Remove one there, or pick other dates.');
    expect([shown.some((el) => el.tagName === 'P' && el.getAttribute('aria-live') == null), screen.getByRole('form', { name: 'Offer something' }) != null]).toEqual([true, true]);
  });

  it('NoLongerQualified_SeesOnlyTheirRows_WithRemove', async () => {
    calls.unteach.mockResolvedValue(ok({ canAdd: false, count: 0, items: [] }));
    board({ canAdd: false, intent: 'not_coming', count: 1, wanted: [], items: [{ kind: 'topic', key: 'tenderfoot-3a', label: 'Knots', sub: 'Tenderfoot 3a', scouts: 0, names: [], flags: [], note: null, alsoOn: [] }] });
    expect([screen.queryByRole('button', { name: 'Offer something' }), screen.queryByRole('radio', { name: 'Coming' })]).toEqual([null, null]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Knots' }));
    expect(calls.unteach.mock.calls[0][0]).toMatchObject({ key: 'tenderfoot-3a' });
  });

  it('Adult_ClearThisAnswer_ResetsToNoAnswer', async () => {
    calls.intent.mockResolvedValue(ok({ intent: null }));
    board({ intent: 'undecided' });
    await userEvent.click(screen.getByRole('button', { name: /Clear this answer/ }));
    expect([calls.intent.mock.calls[0][0].intent, await screen.findByText('Needs an answer')]).toEqual([null, expect.anything()]);
  });

  it('Adult_NoStoredAnswer_HasNothingToClear', () => {
    board();
    expect(screen.queryByRole('button', { name: /Clear this answer/ })).toBeNull();
  });

  it('ScoutsAskingFor_IsItsOwnCard', () => {
    board();
    expect(screen.getByRole('heading', { name: 'Scouts are asking for these' }).closest('section')).not.toBe(screen.getByRole('heading', { name: 'Dan Vest' }).closest('section'));
  });

  it('OfferSomething_IsOneLinkUnderTheTeachingList', () => {
    board();
    expect([screen.getAllByText('Offer something').length, screen.queryByRole('heading', { name: 'Offer something' })]).toEqual([1, null]);
  });

  it('NotComing_HidesTheTeachLists', () => {
    board({ intent: 'not_coming' });
    expect([screen.queryByText('Scouts are asking for these'), screen.getByText('Got it. Thanks for letting us know.') != null]).toEqual([null, true]);
  });
});
