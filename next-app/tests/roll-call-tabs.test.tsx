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

  // "Also an agenda option" (Patrick, 2026-08-24): a meeting-template entry
  // with no agenda yet — a PLC, a committee meeting — offers Add agenda right
  // in the list, the same action the entry's workbench has.
  it('AddAgenda_IsOfferedOnlyWhereTheCategoryUsesAnAgenda_AndNoneExistsYet', async () => {
    const user = userEvent.setup();
    const onAddAgenda = vi.fn().mockResolvedValue({ ok: true, id: 99 });
    const plc = { ...row('2026-08-30', 'PLC Meeting'), category: 'Leadership / Planning', canAddAgenda: true };
    const campout = { ...row('2026-09-12', 'Fall campout'), category: 'Campout / Overnight', canAddAgenda: false };
    const withAgenda = { ...row('2026-09-06', 'Next meeting'), agendaId: 7, agendaStatus: 'draft', canAddAgenda: false };
    render(<AttendanceList rows={[plc, campout, withAgenda]} today={TODAY} onDeleteAgenda={vi.fn()} onAddAgenda={onAddAgenda} />);
    const buttons = screen.getAllByRole('button', { name: 'Add agenda' });
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0]);
    expect(onAddAgenda).toHaveBeenCalledTimes(1);
    const fd = onAddAgenda.mock.calls[0][0] as FormData;
    expect(fd.get('calendar_entry_id')).toBe(String(plc.entryId));
    expect(fd.get('title')).toBe('PLC Meeting');
  });

  it('DateToggle_FlipsTheViewsNaturalOrder', async () => {
    const user = userEvent.setup();
    render(<AttendanceList rows={rows} today={TODAY} onDeleteAgenda={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Toggle date sort direction' }));
    expect(titlesInOrder()).toEqual(['Far out', 'Next meeting', 'Today']);
  });
});
