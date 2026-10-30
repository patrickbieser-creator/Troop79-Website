import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DATA } from './helpers/suggestions-fixture';

/**
 * Planner III Suggestions (prototypes/meeting-plan-III/README.md, "Screen: Suggestions"), the view: the III groups,
 * the toolbar's For / View / group pills / focus / on-plan filters, ticks that carry across views into one Add, Save
 * as a focus set inline, By scout's reasons, Teaching's confirm, and Needs another setting. Viewers read it with no
 * controls. The server actions are the mock boundary.
 */
const calls = vi.hoisted(() => ({ add: vi.fn(), teach: vi.fn(), saveSet: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: calls.refresh, push: vi.fn() }) }));
vi.mock('../src/app/(public)/planner/suggestions/actions', () => ({ suggestAddAction: calls.add }));
vi.mock('../src/app/(public)/planner/this-week-actions', () => ({ twSetTeacherAction: calls.teach }));
vi.mock('../src/app/(public)/planner/focus-actions', () => ({ focusSaveSetAction: calls.saveSet }));

const { SuggestionsView } = await import('../src/app/(public)/planner/suggestions/suggestions-client');

const MEETINGS = [
  { entryId: 1, label: 'Sun, Nov 1', short: 'Nov 1', onPlan: [] as string[], focus: ['tenderfoot-4a'], focusNames: ['First aid'], teachers: {} as Record<string, number[]> },
  { entryId: 2, label: 'Sun, Nov 8', short: 'Nov 8', onPlan: ['scout-2'], focus: [] as string[], focusNames: [] as string[], teachers: {} as Record<string, number[]> }
];

function view(o: { canSeed?: boolean; canEdit?: boolean } = {}) {
  return render(<SuggestionsView data={DATA} meetings={MEETINGS} canSeed={o.canSeed ?? true} canEdit={o.canEdit ?? true} lookupsHref="/admin/advancement/lookups?card=adult-skills" />);
}
const cardOf = (title: string) => screen.getByRole('heading', { name: new RegExp(title) }).closest('article')!;

beforeEach(() => {
  for (const f of Object.values(calls)) f.mockReset();
  calls.add.mockResolvedValue({ ok: true, stamp: 's', seeded: [] });
  calls.teach.mockResolvedValue({ ok: true, stamp: 's' });
  calls.saveSet.mockResolvedValue({ ok: true, id: 9 });
});
afterEach(cleanup);

describe('Group sessions', () => {
  it('Cards_SitUnderTheirIIIGroup_InThisWeeksOrder', () => {
    view();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Scout group', 'Tenderfoot group', 'Merit badge group']);
  });

  it('Card_InTheFocus_IsTaggedAndReadsOnThePlan', () => {
    view();
    const c = cardOf('First aid');
    expect([within(c).queryByText('In this week’s focus') != null, within(c).getByText(/On Nov 1 plan · Tenderfoot group/) != null]).toEqual([true, true]);
  });

  it('Viewer_SeesNoTicksAndNoAdd', () => {
    view({ canSeed: false, canEdit: false });
    expect([screen.queryAllByRole('checkbox', { name: /^Tick/ }).length, screen.queryAllByRole('button', { name: /Add to/ }).length]).toEqual([0, 0]);
  });

  it('OnlyThisWeeksFocus_HidesTheRest', async () => {
    view();
    await userEvent.click(screen.getByRole('checkbox', { name: /Only this week’s focus \(First aid\)/ }));
    expect([screen.queryByRole('heading', { name: /Flag/ }), screen.getByRole('heading', { name: /First aid/ }) != null]).toEqual([null, true]);
  });

  it('ShowWhatsOnThePlan_Off_HidesThePlannedCard', async () => {
    view();
    await userEvent.click(screen.getByRole('checkbox', { name: /Show what’s on the plan/ }));
    expect(screen.queryByRole('heading', { name: /First aid/ })).toBeNull();
  });

  it('GroupPill_ShowsOnlyThatGroup', async () => {
    view();
    await userEvent.click(screen.getByRole('button', { name: 'Merit badges' }));
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Merit badge group']);
  });

  it('For_AnotherMeeting_ReadsThatMeetingsPlan', async () => {
    view();
    await userEvent.click(screen.getByRole('button', { name: 'Sun, Nov 8' }));
    expect([within(cardOf('Flag')).getByText(/On Nov 8 plan · Scout group/) != null, within(cardOf('First aid')).getByRole('button', { name: /Add to Nov 8/ }) != null]).toEqual([true, true]);
  });

  it('AddOne_SendsItToThatMeeting_AndSaysWhichGroup', async () => {
    view();
    await userEvent.click(within(cardOf('Flag')).getByRole('button', { name: /Add to Nov 1/ }));
    expect([calls.add.mock.calls[0][0], await screen.findByText(/Added 1 requirement to the Sun, Nov 1 plan: Scout group/)]).toEqual([{ entryId: 1, keys: ['scout-2'] }, expect.anything()]);
  });

  it('SoloNeeds_ListWhatOnlyOneScoutNeeds', () => {
    view();
    const solo = screen.getByText(/Solo needs/).closest('details')!;
    expect(within(solo).getAllByRole('checkbox').length).toBe(3);
  });
});

describe('ticks', () => {
  it('Ticks_CarryAcrossViews_IntoOneAdd', async () => {
    view();
    await userEvent.click(within(cardOf('Flag')).getByRole('checkbox'));
    await userEvent.click(screen.getByRole('tab', { name: 'By scout' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Tick Tenderfoot 3a for Anjali S/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add 2 to the Sun, Nov 1 plan' }));
    expect(calls.add.mock.calls[0][0]).toEqual({ entryId: 1, keys: ['scout-2', 'tenderfoot-3a'] });
  });

  it('SaveAsAFocusSet_AsksForANameInline_ThenSavesTheTicks', async () => {
    view();
    await userEvent.click(within(cardOf('Flag')).getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Save as a focus set…' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.type(screen.getByRole('textbox', { name: 'Focus set name' }), 'Flags');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(calls.saveSet.mock.calls[0][0]).toEqual({ id: null, name: 'Flags', labels: [], items: ['scout-2'] });
  });

  it('ViewAndFilterChanges_RunNoAction', async () => {
    view();
    await userEvent.click(screen.getByRole('tab', { name: 'Teaching' }));
    await userEvent.click(screen.getByRole('button', { name: 'Tenderfoot' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sun, Nov 8' }));
    expect([calls.add.mock.calls.length, calls.teach.mock.calls.length, calls.saveSet.mock.calls.length]).toEqual([0, 0, 0]);
  });
});

describe('By scout', () => {
  it('Scout_WithNothing_SaysWhy', async () => {
    view();
    await userEvent.click(screen.getByRole('tab', { name: 'By scout' }));
    expect(screen.getByText('No merit badge in progress or with a counselor')).toBeTruthy();
  });

  it('Scout_ItemOnThePlan_ReadsOnPlan', async () => {
    view();
    await userEvent.click(screen.getByRole('tab', { name: 'By scout' }));
    expect(screen.getByRole('checkbox', { name: /Tick Tenderfoot 4a for Anjali S/ }).closest('label')!.textContent).toContain('on plan');
  });
});

describe('Teaching', () => {
  it('Chip_NotOnThePlan_AddsItWithThemTeaching', async () => {
    view();
    await userEvent.click(screen.getByRole('tab', { name: 'Teaching' }));
    await userEvent.click(screen.getByRole('button', { name: /Scout 2/ }));
    expect(screen.getByText('Add Scout 2 Flag to the Nov 1 plan (Scout group), with Dan K teaching?')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Add with Dan teaching' }));
    expect([calls.add.mock.calls[0][0], calls.teach.mock.calls[0][0]]).toEqual([
      { entryId: 1, keys: ['scout-2'] },
      { entryId: 1, key: 'scout-2', personId: 7, on: true }
    ]);
  });

  it('Chip_InTheFocus_MakesThemTheGroupsTeacher', async () => {
    view();
    await userEvent.click(screen.getByRole('tab', { name: 'Teaching' }));
    await userEvent.click(screen.getByRole('button', { name: /Tenderfoot 4a/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Make Dan the teacher' }));
    expect([calls.add.mock.calls.length, calls.teach.mock.calls[0][0]]).toEqual([0, { entryId: 1, key: 'fr:tenderfoot', personId: 7, on: true }]);
  });

  it('Chip_AddedButTheTeacherFails_SaysWhy_AndKeepsTheConfirmOpen', async () => {
    calls.teach.mockResolvedValue({ ok: false, error: 'Couldn’t save that. Try again.' });
    view();
    await userEvent.click(screen.getByRole('tab', { name: 'Teaching' }));
    await userEvent.click(screen.getByRole('button', { name: /Scout 2/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add with Dan teaching' }));
    expect([await screen.findByRole('alert'), screen.queryByText(/^✓ Added/), screen.getByRole('button', { name: 'Cancel' }) != null]).toEqual([expect.anything(), null, true]);
  });

  it('EditWithoutSeed_GetsNoControlOnAChipNotOnThePlan', async () => {
    view({ canSeed: false, canEdit: true });
    await userEvent.click(screen.getByRole('tab', { name: 'Teaching' }));
    expect([screen.queryByRole('button', { name: /Scout 2/ }), screen.getByRole('button', { name: /Tenderfoot 4a/ }) != null]).toEqual([null, true]);
  });

  it('LookupsLink_ForThoseWhoMayEditSkills', async () => {
    view();
    await userEvent.click(screen.getByRole('tab', { name: 'Teaching' }));
    expect(screen.getByRole('link', { name: 'Edit teaching skills in Lookups' }).getAttribute('href')).toBe('/admin/advancement/lookups?card=adult-skills');
  });
});

describe('Needs another setting', () => {
  it('ListsWhatAMeetingCantCover_ByClass_WithNoAdd', () => {
    view();
    const footer = screen.getByText(/Needs another setting/).closest('details')!;
    expect([within(footer).getByText(/Campout · 1/) != null, within(footer).getByText('Spend a night camping') != null, within(footer).queryAllByRole('checkbox').length]).toEqual([true, true, 0]);
  });
});
