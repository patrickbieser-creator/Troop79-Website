import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { TeachPageLine } from '../src/lib/meeting-teach-pages';
import type { InterestHit } from '../src/lib/teaching-interests';

/**
 * Build a Plan B10c/B10d, as it renders: the answer page's "What else would you enjoy teaching" only while the page is
 * open; the picker's "Also this Sunday" (requirements only, at most 5); notes stay plain text; the Invite tab's
 * collapsed "New talent (n)". Server actions are mocked; their rules are in b10c-teaching-interests-db.test.ts.
 */
const m = vi.hoisted(() => ({ search: vi.fn(), save: vi.fn() }));
vi.mock('../src/app/(public)/i/teach/actions', () => ({ answerTeachPageAction: vi.fn(), searchTeachInterestsAction: m.search, saveTeachInterestsAction: m.save }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('../src/app/(public)/member/teaching/actions', () => ({}));
const { TeachPageCard } = await import('../src/app/(public)/i/teach/[token]/teach-page-card');
const { InterestPicker } = await import('../src/app/(public)/member/teaching/interest-picker');
const { NewTalent } = await import('../src/app/(public)/planner/invite/new-talent');

afterEach(() => {
  cleanup();
  m.search.mockReset();
  m.save.mockReset();
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
    const { container } = render(<NewTalent groups={groups} />);
    expect(container.querySelector('a')).toBeNull();
  });
});
