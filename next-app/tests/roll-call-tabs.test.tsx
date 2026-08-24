import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttendanceList, type AttendanceListRow } from '../src/app/admin/(workspace)/advancement/meetings/meetings-list';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
}));

/** Roll Call list — Current / Past tabs (Patrick, 2026-08-24). */
function row(entryDate: string, title: string): AttendanceListRow {
  return { entryId: Number(entryDate.replace(/-/g, '')), title, entryDate, category: 'Troop Meeting', agendaId: null, agendaStatus: null, scoutCount: 0, adultCount: 0 };
}
const rows = [row('2027-01-10', 'Far out'), row('2026-09-06', 'Next meeting'), row('2026-08-24', 'Today'), row('2026-08-23', 'Yesterday'), row('2025-12-14', 'Last winter')];
const TODAY = '2026-08-24';

function titlesInOrder(): string[] {
  return within(screen.getByRole('table')).getAllByRole('link', { name: /Far out|Next meeting|Today|Yesterday|Last winter/ }).map((l) => l.textContent ?? '');
}

describe('Roll Call — Current and Past tabs', () => {
  it('OpensOnCurrent_TodayOnTop_ThenSoonest', () => {
    render(<AttendanceList rows={rows} today={TODAY} onDeleteAgenda={vi.fn()} />);
    expect(titlesInOrder()).toEqual(['Today', 'Next meeting', 'Far out']);
  });

  it('PastTab_MostRecentOnTop', async () => {
    const user = userEvent.setup();
    render(<AttendanceList rows={rows} today={TODAY} onDeleteAgenda={vi.fn()} />);
    await user.click(screen.getByRole('tab', { name: /Past/ }));
    expect(titlesInOrder()).toEqual(['Yesterday', 'Last winter']);
  });

  it('YearFilter_OffersOnlyTheYearsInTheView_AndDropsAStaleChoiceOnSwitch', async () => {
    const user = userEvent.setup();
    render(<AttendanceList rows={rows} today={TODAY} onDeleteAgenda={vi.fn()} />);
    const yearSelect = () => screen.getByLabelText('Filter by year') as HTMLSelectElement;
    const options = () => Array.from(yearSelect().options).map((o) => o.value);
    expect(options()).toEqual(['all', '2027', '2026']); // no 2025 on Current
    await user.selectOptions(yearSelect(), '2027');
    expect(titlesInOrder()).toEqual(['Far out']);
    await user.click(screen.getByRole('tab', { name: /Past/ }));
    expect(options()).toEqual(['all', '2026', '2025']); // no 2027 on Past
    expect(yearSelect().value).toBe('all'); // 2027 doesn't exist here, so the filter let go
    expect(titlesInOrder()).toEqual(['Yesterday', 'Last winter']);
  });

  it('DateToggle_FlipsTheViewsNaturalOrder', async () => {
    const user = userEvent.setup();
    render(<AttendanceList rows={rows} today={TODAY} onDeleteAgenda={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Toggle date sort direction' }));
    expect(titlesInOrder()).toEqual(['Far out', 'Next meeting', 'Today']);
  });
});
