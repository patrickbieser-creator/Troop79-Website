import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ThisWeek, TwTeacher } from '../src/lib/this-week';

/** This week's Adults teaching card (Patrick, 2026-10-31): each adult once, as a chip, with every group or class they
 *  teach; Junior Leaders (scouts) aren't listed; nobody yet says so. */
const m = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../src/app/(public)/planner/planner-client', () => ({
  usePlanner: () => ({ canEdit: true, canEmail: false, openPerson: m.open, sync: { run: (w: () => Promise<unknown>) => w() } }),
  SAVE_FAILED: 'That didn’t save.'
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
const { AdultsCard } = await import('../src/app/(public)/planner/this-week-client');

const t = (personId: number, name: string, kind: TwTeacher['kind'] = 'adult'): TwTeacher => ({ personId, name, kind, intent: null, note: null, formal: name });
const view = (groups: { key: string; title: string; teachers: TwTeacher[]; kind?: string; name?: string }[], extras: { key: string; title: string; teachers: TwTeacher[] }[] = []) =>
  ({ groups, extras }) as unknown as Pick<ThisWeek, 'groups' | 'extras'>;

afterEach(cleanup);

describe('AdultsCard', () => {
  it('EachAdult_Once_WithEverythingTheyTeach', () => {
    render(
      <AdultsCard
        view={view(
          [
            { key: 'fr:scout', title: 'Scout Group 1', teachers: [t(1, 'Patrick B')] },
            { key: 'fr:scout~2', title: 'Scout Group 2', teachers: [t(1, 'Patrick B'), t(2, 'Dan B')] },
            { key: 'fr:mb:first-aid', title: 'First Aid merit badge', kind: 'badge', name: 'First Aid', teachers: [t(2, 'Dan B')] }
          ],
          [{ key: 'ff:1', title: 'Knife safety', teachers: [t(2, 'Dan B'), t(9, 'Lee P', 'junior')] }]
        )}
      />
    );
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual(['Dan BScout Group 2, First Aid, Knife safety', 'Patrick BScout Group 1, Scout Group 2']);
  });

  it('ClickingAnAdult_OpensTheirPanel', () => {
    render(<AdultsCard view={view([{ key: 'fr:scout', title: 'Scout group', teachers: [t(4, 'Mindy S')] }])} />);
    screen.getByRole('button', { name: 'Mindy S, adult' }).click();
    expect(m.open).toHaveBeenCalledWith(4);
  });

  it('NobodyYet_SaysSo', () => {
    render(<AdultsCard view={view([{ key: 'fr:scout', title: 'Scout group', teachers: [] }])} />);
    expect(screen.getByText('No adults teaching yet. Pick teachers on the group cards.')).toBeTruthy();
  });
});
