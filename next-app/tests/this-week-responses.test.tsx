import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { responsesOf, type TwPerson, type TwResponses } from '../src/lib/this-week';
import type { Intent } from '../src/lib/meeting-board-shared';

/** This week's "Responses this week" card (Patrick, 2026-11-01): everyone who has answered, scouts and adults, grouped
 *  coming on top, not sure in the middle, can't come at the bottom. */
const m = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../src/app/(public)/planner/planner-client', () => ({
  usePlanner: () => ({ canEdit: true, canEmail: false, openPerson: m.open, sync: { run: (w: () => Promise<unknown>) => w() } }),
  SAVE_FAILED: 'That didn’t save.'
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
const { ResponsesCard } = await import('../src/app/(public)/planner/this-week-client');

const scout = (personId: number, name: string, intent: Intent | null): TwPerson => ({ personId, name, rank: 'scout', rankName: 'Scout', intent });
const scouts = [scout(1, 'Zoe A', 'coming'), scout(2, 'Ann B', 'coming'), scout(3, 'Bo C', 'not_coming'), scout(4, 'Cy D', null), scout(5, 'Di E', 'undecided')];
const intents = new Map<number, Intent>([
  [1, 'coming'],
  [2, 'coming'],
  [3, 'not_coming'],
  [5, 'undecided'],
  [20, 'coming'],
  [21, 'not_coming'],
  [22, 'undecided'],
  [99, 'coming']
]);
const adults = new Map([
  [20, 'Mindy Stollenwerk'],
  [21, 'Mike Bieser'],
  [22, 'Jason Porter']
]);

describe('responsesOf', () => {
  it('Scouts_AreGroupedByTheirAnswer_ByName', () => {
    const r = responsesOf(scouts, intents, adults);
    expect([r.coming.scouts, r.undecided.scouts, r.not_coming.scouts].map((xs) => xs.map((x) => x.name))).toEqual([['Ann B', 'Zoe A'], ['Di E'], ['Bo C']]);
  });

  it('AScoutWithNoAnswer_IsNotListed', () => {
    const r = responsesOf(scouts, intents, adults);
    expect([r.coming, r.undecided, r.not_coming].some((g) => g.scouts.some((x) => x.personId === 4))).toBe(false);
  });

  it('Adults_AreGroupedByTheirAnswer_WithTheirBoardName', () => {
    const r = responsesOf(scouts, intents, adults);
    expect([r.coming.adults, r.undecided.adults, r.not_coming.adults].map((xs) => xs.map((x) => x.personId))).toEqual([[20], [22], [21]]);
  });

  it('AnAnswerFromSomeoneNotInTheDirectory_IsLeftOut', () => {
    expect(responsesOf(scouts, intents, adults).coming.adults.some((x) => x.personId === 99)).toBe(false);
  });
});

const R = (o: Partial<Record<Intent, Partial<TwResponses[Intent]>>>): TwResponses => ({
  coming: { scouts: [], adults: [], ...o.coming },
  undecided: { scouts: [], adults: [], ...o.undecided },
  not_coming: { scouts: [], adults: [], ...o.not_coming }
});

afterEach(cleanup);

describe('ResponsesCard', () => {
  it('ComingOnTop_NotSureInTheMiddle_CantComeAtTheBottom', () => {
    render(
      <ResponsesCard
        responses={R({
          not_coming: { adults: [{ personId: 21, name: 'Mike B' }] },
          coming: { scouts: [scout(2, 'Ann B', 'coming')], adults: [{ personId: 20, name: 'Mindy S' }] },
          undecided: { scouts: [scout(5, 'Di E', 'undecided')] }
        })}
      />
    );
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Coming 2', 'Not sure 1', 'Can’t come 1']);
  });

  it('EachGroup_ListsItsScoutsThenItsAdults', () => {
    render(<ResponsesCard responses={R({ coming: { scouts: [scout(2, 'Ann B', 'coming')], adults: [{ personId: 20, name: 'Mindy S' }] } })} />);
    const group = screen.getByRole('group', { name: 'Coming' });
    expect(within(group).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Ann B, Scout', 'Mindy S, adult']);
  });

  it('AnEmptyAnswer_HasNoHeading', () => {
    render(<ResponsesCard responses={R({ coming: { adults: [{ personId: 20, name: 'Mindy S' }] } })} />);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Coming 1']);
  });

  it('NoAnswersYet_SaysSo', () => {
    render(<ResponsesCard responses={R({})} />);
    expect(screen.getByText('No answers yet.')).toBeTruthy();
  });

  it('ClickingAnAdult_OpensTheirPanel', () => {
    render(<ResponsesCard responses={R({ coming: { adults: [{ personId: 20, name: 'Mindy S' }] } })} />);
    screen.getByRole('button', { name: 'Mindy S, adult' }).click();
    expect(m.open).toHaveBeenCalledWith(20);
  });
});
