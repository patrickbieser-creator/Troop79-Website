import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OfferChoices, TeachView, WantedItem } from '../src/lib/meeting-board-supply';
import type { MyClass, TeacherClass, TeacherWeek } from '../src/lib/teacher-week';

/**
 * The family page's teacher card (Plans/Meeting-Planner-III-Family.md, F3 + F4; prototypes/meeting-plan-III/
 * Family.dc.html): three answers like a scout's card, "{name}'s Sunday" with the 3-class / 60-minute limit, the open
 * class list for someone with nothing assigned, and "Not sure yet" asking first when a planner assigned the class.
 * The server actions are the mock boundary.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const calls = vi.hoisted(() => ({ teach: vi.fn(), unteach: vi.fn(), withdraw: vi.fn(), intent: vi.fn(), offer: vi.fn(), clear: vi.fn(), note: vi.fn() }));
vi.mock('../src/app/(public)/member/meeting/teach-actions', () => ({
  meetingTeachAction: calls.teach,
  meetingUnteachAction: calls.unteach,
  meetingWithdrawOfferAction: calls.withdraw,
  meetingTeacherIntentAction: calls.intent,
  meetingPostOfferAction: calls.offer,
  meetingTeacherClearAction: calls.clear,
  meetingTeacherNoteAction: calls.note
}));
const { TeacherCard } = await import('../src/app/(public)/member/meeting/teacher-card');

const cls = (key: string, label: string, o: Partial<TeacherClass> = {}): TeacherClass => ({
  key,
  label,
  line: `${label} - 30 min · 4 scouts`,
  min: 30,
  scouts: 4,
  parts: [],
  teachers: [],
  adultsOnly: false,
  ...o
});
const mine = (key: string, label: string, o: Partial<MyClass> = {}): MyClass => ({ ...cls(key, label), role: 'teach', preassigned: false, ...o });
const WEEK: TeacherWeek = {
  entryId: 1,
  personId: 9,
  firstName: 'Dan',
  junior: false,
  intent: null,
  note: null,
  mine: [],
  other: [],
  needs: [cls('fr:second-class', 'Second Class group'), cls('fr:mb:first-aid', 'First Aid merit badge', { adultsOnly: true, min: 45 })],
  taught: [cls('fr:tenderfoot', 'Tenderfoot group', { teachers: ['Mr. B'] })],
  load: { classes: 0, minutes: 0 }
};
const wanted = (key: string, label: string): WantedItem => ({ key, label, codeLabel: 'Tenderfoot 3a', scouts: 2, names: ['Finn P'], weeks: 1, teachers: [], qualified: true, flags: [], refused: false, minutes: 15 });
const VIEW: TeachView = { personId: 9, kind: 'adult', intent: null, count: 0, items: [], wanted: [wanted('tenderfoot-3a', 'Knots')], hasSkills: true, canAdd: true };
const CHOICES: OfferChoices = { skills: [], requirements: [], dates: [{ entryId: 1, label: 'Nov 1' }] };
const ok = (week: Partial<TeacherWeek> = {}) => ({ ok: true as const, view: VIEW, week: { ...WEEK, ...week } });

function card(week: Partial<TeacherWeek> = {}, isSelf = true) {
  // Every write answers with this same card, so a tap doesn't swap in another person's.
  for (const f of Object.values(calls)) f.mockResolvedValue(ok(week));
  return render(<TeacherCard entryId={1} date="2099-11-01" isSelf={isSelf} initial={{ ...WEEK, ...week }} view={VIEW} choices={CHOICES} onBehalf={false} readOnly={false} />);
}
const teaching = { mine: [mine('fr:second-class', 'Second Class group')], needs: [], intent: 'coming' as const, load: { classes: 1, minutes: 30 } };

beforeEach(() => {
  for (const f of Object.values(calls)) f.mockReset().mockResolvedValue(ok());
});

describe('the teacher card', () => {
  it('Teacher_SeesThreeAnswers_LikeAScoutCard', () => {
    card(teaching);
    expect(screen.getAllByRole('radio').map((r) => r.querySelector('span span')?.textContent)).toEqual(['This plan looks good', 'Change my plan', 'Can’t make it this week']);
  });

  it('Teacher_CardTitle_IsFirstNameOnly', () => {
    card(teaching);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Dan’s plan');
  });

  it('Teacher_Line_SaysWhatTheyTeach', () => {
    card({ ...teaching, mine: [mine('fr:second-class', 'Second Class group'), mine('fr:tenderfoot', 'Tenderfoot group', { role: 'help' })] });
    expect(screen.getByText('Teaching the Second Class group · helping teach the Tenderfoot group')).toBeTruthy();
  });

  it('Teacher_NeverSeesComing', () => {
    const { container } = card(teaching);
    expect(container.textContent).not.toMatch(/coming/i);
  });

  it('Teacher_LooksGood_SavesComing', async () => {
    card({ ...teaching, intent: null });
    await userEvent.click(screen.getByRole('radio', { name: /This plan looks good/ }));
    expect(calls.intent).toHaveBeenCalledWith({ entryId: 1, personId: 9, onBehalf: false, intent: 'coming' });
  });

  it('Teacher_ChangeMyPlan_ShowsTheLoadMeter', async () => {
    card(teaching);
    await userEvent.click(screen.getByRole('radio', { name: /Change my plan/ }));
    expect(screen.getByText('1 of 3 classes · 30 of 60 minutes')).toBeTruthy();
  });

  it('Teacher_TakesAClassThatNeedsATeacher', async () => {
    card({ intent: 'coming' });
    await userEvent.click(screen.getByRole('radio', { name: /Change my plan/ }));
    await userEvent.click(screen.getAllByRole('button', { name: 'I’ll teach this' })[0]);
    expect(calls.teach).toHaveBeenCalledWith({ entryId: 1, personId: 9, onBehalf: false, key: 'fr:second-class' });
  });

  it('Teacher_HelpsTeachAClassWithATeacher', async () => {
    card({ intent: 'coming' });
    await userEvent.click(screen.getByRole('radio', { name: /Change my plan/ }));
    await userEvent.click(screen.getByRole('button', { name: 'I’ll help teach' }));
    expect(calls.teach).toHaveBeenCalledWith({ entryId: 1, personId: 9, onBehalf: false, key: 'fr:tenderfoot' });
  });

  it('Teacher_AtThreeClasses_CannotTakeAnother', async () => {
    card({ intent: 'coming', mine: [mine('a', 'A'), mine('b', 'B'), mine('c', 'C')], load: { classes: 3, minutes: 45 } });
    await userEvent.click(screen.getByRole('radio', { name: /Change my plan/ }));
    expect(screen.getAllByRole('button', { name: /I’ll (teach this|help teach)/ }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it('Teacher_ClassPast60Minutes_SaysWhy', async () => {
    card({ intent: 'coming', mine: [mine('a', 'A')], load: { classes: 1, minutes: 45 } });
    await userEvent.click(screen.getByRole('radio', { name: /Change my plan/ }));
    expect(screen.getAllByText('This would make 75 minutes. Teaching is capped at 60 minutes on a Sunday.').length).toBeGreaterThan(0);
  });

  it('JuniorLeader_CannotTake_AnAdultsOnlyClass', async () => {
    card({ intent: 'coming', junior: true });
    await userEvent.click(screen.getByRole('radio', { name: /Change my plan/ }));
    const button = screen.getAllByRole('button', { name: 'I’ll teach this' }).find((x) => x.parentElement?.textContent?.includes('First Aid merit badge'));
    expect([button?.parentElement?.textContent?.includes('Adults only'), (button as HTMLButtonElement).disabled]).toEqual([true, true]);
  });
});

describe('nothing assigned yet', () => {
  it('Teacher_NothingAssigned_SeesOpenClassListFirst', () => {
    card();
    expect([!!screen.getByText(/you’re not signed up for anything yet/), screen.getAllByRole('button', { name: 'I’ll teach this' }).length > 0, screen.queryByRole('radio', { name: /This plan looks good/ })]).toEqual([true, true, null]);
  });

  it('Teacher_NothingAssigned_StillHasCantMakeIt', () => {
    card();
    expect(screen.getByRole('radio', { name: /Can’t make it this week/ })).toBeTruthy();
  });
});

describe('Not sure yet', () => {
  it('Teacher_ClearWithOnlyOwnSignups_ClearsAtOnce', async () => {
    card(teaching);
    await userEvent.click(screen.getByRole('button', { name: 'Not sure yet? Clear Dan’s answer' }));
    expect(calls.clear).toHaveBeenCalledWith({ entryId: 1, personId: 9, onBehalf: false, takeOff: false });
  });

  it('Teacher_Preassigned_ClearAsksFirst', async () => {
    card({ ...teaching, mine: [mine('fr:second-class', 'Second Class group', { preassigned: true })] });
    await userEvent.click(screen.getByRole('button', { name: 'Not sure yet? Clear Dan’s answer' }));
    expect([screen.getByText('Should we take you off Sunday’s plan for now?') != null, calls.clear.mock.calls.length]).toEqual([true, 0]);
  });

  it('Teacher_Preassigned_TakeMeOff_ReleasesTheClass', async () => {
    card({ ...teaching, mine: [mine('fr:second-class', 'Second Class group', { preassigned: true })] });
    await userEvent.click(screen.getByRole('button', { name: 'Not sure yet? Clear Dan’s answer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, take me off the plan for now' }));
    expect(calls.clear).toHaveBeenCalledWith({ entryId: 1, personId: 9, onBehalf: false, takeOff: true });
  });

  it('Teacher_Preassigned_NeverMind_ChangesNothing', async () => {
    card({ ...teaching, mine: [mine('fr:second-class', 'Second Class group', { preassigned: true })] });
    await userEvent.click(screen.getByRole('button', { name: 'Not sure yet? Clear Dan’s answer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Never mind, keep my answer' }));
    expect([calls.clear.mock.calls.length, screen.getByText('✓ Plan looks good') != null]).toEqual([0, true]);
  });
});

describe('Can’t make it note', () => {
  it('Teacher_CantMakeIt_OpensTheNote', async () => {
    card(teaching);
    await userEvent.click(screen.getByRole('radio', { name: /Can’t make it this week/ }));
    expect(screen.getByLabelText('No problem. Anything you’d like us to know?')).toBeTruthy();
  });

  it('Teacher_Note_SendsWithItsOwnButton', async () => {
    card({ ...teaching, intent: 'not_coming' });
    await userEvent.type(screen.getByLabelText('No problem. Anything you’d like us to know?'), 'Sick');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(calls.note).toHaveBeenCalledWith({ entryId: 1, personId: 9, onBehalf: false, note: 'Sick' });
  });

  it('Teacher_Note_SendIsGreyedUntilItChanges', () => {
    card({ ...teaching, intent: 'not_coming', note: 'Sick' });
    expect((screen.getByRole('button', { name: 'Sent' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Teacher_Note_CountsCharactersLeft', () => {
    card({ ...teaching, intent: 'not_coming', note: 'Sick' });
    expect(screen.getByText('236 characters left · up to 3 lines')).toBeTruthy();
  });
});
