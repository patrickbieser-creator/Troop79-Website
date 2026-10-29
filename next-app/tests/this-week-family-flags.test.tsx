import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TwRow } from '../src/lib/this-week';

/** Emails E2: This week flags what a family changed or suggested, and shows teachers' "Not this week" notes. */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/planner', useSearchParams: () => new URLSearchParams() }));
const { FamilyFlags, DeclineNotes } = await import('../src/app/(public)/planner/this-week-client');

const row = (o: Partial<TwRow>): TwRow => ({ familySuggestions: [], familyUnticked: [], ...o }) as TwRow;

describe('family flags', () => {
  it('PlannerRow_FlagsSuggestions', () => {
    render(<FamilyFlags row={row({ familySuggestions: ['Merit badge Cooking'] })} />);
    expect(screen.getByText('Family suggests: Merit badge Cooking')).toBeTruthy();
  });

  it('PlannerRow_FlagsUnticks', () => {
    render(<FamilyFlags row={row({ familyUnticked: ['6a', '6c'] })} />);
    expect(screen.getByText('Family took off 6a, 6c')).toBeTruthy();
  });

  it('PlannerRow_NoFamilyChanges_ShowsNothing', () => {
    const { container } = render(<FamilyFlags row={row({})} />);
    expect(container.textContent).toBe('');
  });

  it('TeacherSlot_ShowsADeclineNote', () => {
    render(<DeclineNotes notes={[{ name: 'Dan V', note: 'December works' }]} />);
    expect(screen.getByRole('list').textContent).toContain('December works');
  });
});
