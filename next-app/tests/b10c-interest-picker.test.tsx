import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { TeachPageLine } from '../src/lib/meeting-teach-pages';
import type { InterestHit } from '../src/lib/teaching-interests';

/**
 * Build a Plan B10c/B10d, as it renders: the answer page's "What else would you enjoy teaching" only while the page is
 * open; the picker's "Also this Sunday" (requirements only, at most 5); notes stay plain text; the Invite tab's
 * collapsed "New talent (n)". Server actions are mocked; their rules are in b10c-teaching-interests-db.test.ts.
 */
const m = vi.hoisted(() => ({ search: vi.fn(), save: vi.fn(), remove: vi.fn(), toSkills: vi.fn() }));
vi.mock('../src/app/(public)/i/teach/actions', () => ({ answerTeachPageAction: vi.fn(), searchTeachInterestsAction: m.search, saveTeachInterestsAction: m.save }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('../src/app/(public)/member/teaching/actions', () => ({
  addInterestToSkillsAction: m.toSkills,
  addMyInterestsAction: vi.fn(),
  removeMyInterestAction: m.remove,
  searchMyInterestsAction: vi.fn()
}));
const { TeachPageCard } = await import('../src/app/(public)/i/teach/[token]/teach-page-card');
const { InterestPicker } = await import('../src/app/(public)/member/teaching/interest-picker');
const { NewTalent } = await import('../src/app/(public)/planner/invite/new-talent');
const { MyInterests } = await import('../src/app/(public)/member/teaching/my-interests');

afterEach(() => {
  cleanup();
  m.search.mockReset();
  m.save.mockReset();
  m.remove.mockReset();
  m.toSkills.mockReset();
});

const line: TeachPageLine = {
  inviteId: 1,
  key: 'tenderfoot-3a',
  code: 'Tenderfoot 3a',
  topic: 'Square Knot use',
  minutes: 20,
  helped: { count: 0, names: [], more: 0 },
  answer: null,
  available: true
};
const card = (state: 'open' | 'expired' | 'superseded' | 'void' | 'unknown') =>
  render(<TeachPageCard state={state} token={'a'.repeat(64)} recipientName="Dan B" day="Sunday" lines={state === 'open' ? [line] : []} err={null} saved={false} failed={[]} />);

const hit = (key: string, o: Partial<InterestHit> = {}): InterestHit => ({ key, kind: 'rank', sourceName: 'Tenderfoot', code: key.split('-').pop() ?? '', label: `Req ${key}`, ...o });

async function pickAll(hits: InterestHit[], allowNow = true) {
  const search = vi.fn(async () => ({ ok: true as const, rows: hits }));
  const save = vi.fn(async () => ({ ok: true as const, message: 'Saved.' }));
  render(<InterestPicker allowNow={allowNow} search={search} save={save} />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'knot' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => screen.getAllByRole('button', { name: /^Add / }));
  for (const b of screen.getAllByRole('button', { name: /^Add / })) fireEvent.click(b);
  await waitFor(() => screen.getAllByRole('button', { name: /^Remove / }));
  return save;
}

describe('the answer page', () => {
  it('ClosedPage_HasNoPicker', () => {
    card('expired');
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('OpenPage_ShowsThePicker', () => {
    card('open');
    expect(screen.getByRole('heading', { name: 'What else would you enjoy teaching, now or in the future?' })).toBeTruthy();
  });
});

describe('the picker', () => {
  it('NowToggle_NotOfferedForAWholeBadge', async () => {
    await pickAll([hit('mb:first-aid', { kind: 'badge', sourceName: 'First Aid', code: null, label: 'First Aid' })]);
    expect(screen.queryByRole('checkbox', { name: /Also this Sunday/ })).toBeNull();
  });

  it('NowToggle_StopsAtFive', async () => {
    await pickAll(['1a', '1b', '1c', '2a', '2b', '2c'].map((c) => hit(`tenderfoot-${c}`)));
    for (const b of screen.getAllByRole('checkbox', { name: /Also this Sunday/ }).slice(0, 5)) fireEvent.click(b);
    expect((screen.getAllByRole('checkbox', { name: /Also this Sunday/ })[5] as HTMLInputElement).disabled).toBe(true);
  });

  it('Picker_SavesPicksWithNotesAndNowKeys', async () => {
    const save = await pickAll([hit('tenderfoot-3a')]);
    fireEvent.change(screen.getByRole('textbox', { name: 'Note (optional)' }), { target: { value: ' Eagle, 1998 ' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Also this Sunday/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save interests' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]).toEqual([[{ key: 'tenderfoot-3a', note: 'Eagle, 1998' }], ['tenderfoot-3a']]);
  });

  it('MemberPicker_HasNoNowToggle', async () => {
    await pickAll([hit('tenderfoot-3a')], false);
    expect(screen.queryByRole('checkbox', { name: /Also this Sunday/ })).toBeNull();
  });
});

describe('New talent on the Invite tab', () => {
  const groups = [{ personId: 7, name: 'Dana Walsh', items: [{ id: 1, short: 'Ten 3a · Square Knot use', note: '<a href="x">link</a>', createdAt: '2026-10-20T15:00:00Z' }] }];

  it('NewTalent_IsCollapsedWithACount', () => {
    const { container } = render(<NewTalent groups={groups} />);
    expect([container.querySelector('details')?.open, container.querySelector('summary')?.textContent]).toEqual([false, 'New talent (1)']);
  });

  it('NewTalent_NoteIsPlainText', () => {
    const evil = '<img src=x onerror="alert(1)"><b>bold</b><a href="https://x.example">link</a>';
    const { container } = render(<NewTalent groups={[{ ...groups[0], items: [{ ...groups[0].items[0], note: evil }] }]} />);
    expect([container.querySelector('img, b, a, script'), container.textContent?.includes(evil)]).toEqual([null, true]);
  });
});

/** qa-lead B10c #2–#5: what a screen reader hears, where focus goes, and a Save that explains itself. */
describe('the picker, accessibly', () => {
  it('Search_AnnouncesTheResultCount', async () => {
    await pickAll([hit('tenderfoot-3a'), hit('tenderfoot-3b')]);
    expect(screen.getByRole('status', { name: 'Search results' }).textContent).toBe('2 results');
  });

  it('Search_AnnouncesNothingMatches', async () => {
    render(<InterestPicker allowNow search={vi.fn(async () => ({ ok: true as const, rows: [] }))} save={vi.fn()} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Search results' }).textContent).toBe('Nothing matches'));
  });

  it('AddedResult_KeepsItsLabelInTheName', async () => {
    await pickAll([hit('tenderfoot-3a')]);
    expect(screen.getByRole('button', { name: 'Ten 3a · Req tenderfoot-3a, added' })).toBeTruthy();
  });

  it('RemovePick_FocusesTheNextRemove', async () => {
    await pickAll([hit('tenderfoot-3a'), hit('tenderfoot-3b')]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ten 3a · Req tenderfoot-3a' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Ten 3b · Req tenderfoot-3b' }));
  });

  it('RemoveLastPick_FocusesThePicksHeading', async () => {
    await pickAll([hit('tenderfoot-3a')]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ten 3a · Req tenderfoot-3a' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Your picks' }));
  });

  it('SaveWithNothingPicked_SaysWhyInPlace', () => {
    const save = vi.fn();
    render(<InterestPicker allowNow search={vi.fn()} save={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save interests' }));
    expect([save.mock.calls.length, screen.getByRole('alert').textContent?.includes('Add something first')]).toEqual([0, true]);
  });
});

describe('Also enjoy teaching, accessibly', () => {
  const rows = [
    { id: 1, short: 'Ten 3a · Square Knot use', note: null, createdAt: '2026-10-20T15:00:00Z', addSkill: { id: 'knots', name: 'Knots' } },
    { id: 2, short: 'First Aid (whole badge)', note: null, createdAt: '2026-10-20T15:00:00Z', addSkill: null }
  ];

  it('AddToSkills_NamesItsItem', () => {
    render(<MyInterests items={rows} readOnly={false} />);
    expect(screen.getByRole('button', { name: 'Add Ten 3a · Square Knot use to what I can teach' })).toBeTruthy();
  });

  it('RemoveInterest_FocusesTheNextRemove', async () => {
    m.remove.mockResolvedValue({ ok: true });
    render(<MyInterests items={rows} readOnly={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ten 3a · Square Knot use' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove First Aid (whole badge)' })));
  });

  it('RemoveLastInterest_FocusesTheListHeading', async () => {
    m.remove.mockResolvedValue({ ok: true });
    render(<MyInterests items={[rows[1]]} readOnly={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove First Aid (whole badge)' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Also enjoy teaching' })));
  });
});
