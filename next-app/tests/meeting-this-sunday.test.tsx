import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';

/**
 * Meeting Plan › This Sunday (Phase 1): the live demand board, and the poller that keeps it live (every ~10 s, only
 * refreshing when the stamp changed, paused while the tab is hidden).
 */
const refresh = vi.hoisted(() => vi.fn());
const stamp = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/advancement-catalog', () => ({ loadAdvancementCatalog: async () => ({}) }));
vi.mock('../src/app/admin/(workspace)/advancement/meeting-plan/actions', () => ({ boardStampAction: stamp }));

const { ThisSundayView } = await import('../src/app/admin/(workspace)/advancement/meeting-plan/this-sunday');
const { BoardPoller, POLL_MS, JITTER_MS } = await import('../src/app/admin/(workspace)/advancement/meeting-plan/board-poller');

const data = {
  meeting: { entryId: 5, title: 'Troop Meeting', mode: 'rank' as const, dateLabel: 'Sunday, October 25, 2026' },
  stamp: '1:0:1:100',
  counts: { coming: 3, undecided: 1, notComing: 1, noAnswer: 20, picks: 4, held: 2 },
  adults: { coming: 2, undecided: 1, notComing: 1, teaching: 2 },
  topics: [
    { key: 'tenderfoot-4a', label: 'First aid', codeLabel: 'Tenderfoot 4a', names: ['Anjali S', 'Finn P'], teachers: [{ personId: 40, name: 'Dan V', notes: ['from a First Aid offer'] }] },
    { key: 'tenderfoot-3a', label: 'Knots', codeLabel: 'Tenderfoot 3a', names: ['Leo M'], teachers: [] }
  ],
  wanted: [{ key: 'tenderfoot-3a', label: 'Knots', codeLabel: 'Tenderfoot 3a', names: ['Leo M'], weeks: 3, canTeach: [{ personId: 41, name: 'Karen O', note: 'not sure yet' }] }],
  offered: [{ key: 'ff:knife sharpening', label: 'Knife sharpening', codeLabel: 'Offered this week', teachers: [{ personId: 42, name: 'Mike H', notes: [] }] }],
  skillOffers: [{ personId: 40, name: 'Dan V', skill: 'First Aid', note: null, scouts: 2 }],
  undecidedAdults: [{ personId: 41, name: 'Karen O', fits: ['Tenderfoot 3a'] }],
  notComingAdults: [{ personId: 43, name: 'Sue D' }],
  undecided: [{ personId: 1, name: 'Leo M' }],
  notComing: [{ personId: 2, name: 'Zoe W', held: 2 }],
  comingNothing: [],
  noAnswer: [{ personId: 3, name: 'Theo P' }],
  scouts: [{ personId: 1, name: 'Leo M' }],
  adultPeople: [{ personId: 40, name: 'Dan V' }]
};

beforeEach(() => {
  refresh.mockReset();
  stamp.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ThisSundayView', () => {
  it('Leader_SeesWhoPickedEachTopic_ByName', () => {
    render(<ThisSundayView data={data} />);
    const row = screen.getByText('First aid').closest('tr')!;
    expect([row.textContent?.includes('Anjali S, Finn P'), row.textContent?.includes('2')]).toEqual([true, true]);
  });

  it('Leader_SeesIntentCounts_IncludingNoAnswer', () => {
    render(<ThisSundayView data={data} />);
    expect(['Scouts coming', 'Not sure yet', 'Can’t make it', 'No answer'].map((l) => screen.getAllByText(l)[0].previousSibling?.textContent)).toEqual(['3', '1', '1', '20']);
  });

  it('Leader_EntersForAScout_ThroughTheirMemberPage', () => {
    render(<ThisSundayView data={data} />);
    expect(screen.getByRole('link', { name: 'Theo P' }).getAttribute('href')).toBe('/member/meeting?for=3');
  });

  it('Leader_SeesTeachersPerTopic_AndWantedNoTeacher', () => {
    render(<ThisSundayView data={data} />);
    const taught = screen.getByText('First aid').closest('tr')!;
    const untaught = screen.getAllByText('Knots')[0].closest('tr')!;
    expect([taught.textContent?.includes('Dan V (from a First Aid offer)'), untaught.textContent?.includes('No teacher yet')]).toEqual([true, true]);
  });

  it('Leader_SeesWhoCanTeachAWantedTopic', () => {
    render(<ThisSundayView data={data} />);
    const row = screen.getByText(/asked 3 weeks/).closest('tr')!;
    expect(row.textContent).toContain('Karen O (not sure yet)');
  });

  it('Leader_SeesOfferedNoTakers_AndSkillOffers', () => {
    render(<ThisSundayView data={data} />);
    expect([screen.getByText('Knife sharpening').closest('tr')!.textContent?.includes('Mike H'), screen.getByText('First Aid').closest('tr')!.textContent?.includes('2 scouts')]).toEqual([true, true]);
  });

  it('Leader_SeesAdultIntentCounts', () => {
    render(<ThisSundayView data={data} />);
    expect(['Adults coming', 'Adults not sure yet', 'Adults can’t make it', 'Teaching', 'Wanted, no teacher'].map((l) => screen.getAllByText(l)[0].previousSibling?.textContent)).toEqual(['2', '1', '1', '2', '1']);
  });

  it('Leader_EntersForAnAdult_ThroughTheirMemberPage', () => {
    render(<ThisSundayView data={data} />);
    expect([screen.getByRole('link', { name: 'Sue D' }).getAttribute('href'), screen.getByRole('option', { name: 'Dan V' })]).toEqual(['/member/meeting?for=43', expect.anything()]);
  });

  it('ClosedBoard_SaysSo', () => {
    render(<ThisSundayView data={{ ...data, meeting: { ...data.meeting, mode: 'closed' } }} />);
    expect(screen.getByText(/Closed: no board this week/)).toBeTruthy();
  });
});

describe('BoardPoller', () => {
  it('Poller_RefreshesOnlyWhenTheStampChanges', async () => {
    vi.useFakeTimers();
    stamp.mockResolvedValueOnce({ ok: true, stamp: 'a' }).mockResolvedValueOnce({ ok: true, stamp: 'b' });
    render(<BoardPoller entryId={5} stamp="a" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS + JITTER_MS);
    });
    const afterFirst = refresh.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS + JITTER_MS);
    });
    expect([stamp.mock.calls.length, afterFirst, refresh.mock.calls.length]).toEqual([2, 0, 1]);
  });

  it('Poller_IsPaused_WhileTheTabIsHidden', async () => {
    vi.useFakeTimers();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    stamp.mockResolvedValue({ ok: true, stamp: 'b' });
    render(<BoardPoller entryId={5} stamp="a" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync((POLL_MS + JITTER_MS) * 3);
    });
    hidden.mockRestore();
    expect(stamp.mock.calls.length).toBe(0);
  });
});
