import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/** The planner's pull-downs (the teacher list, Place…): a click anywhere off the open menu closes it and does nothing
 *  else (Patrick, 2026-10-31): the click never reaches what's underneath. */
vi.mock('../src/app/(public)/planner/planner-client', () => ({
  usePlanner: () => ({ canEdit: true, canEmail: false, sync: { run: (w: () => Promise<unknown>) => w() } }),
  SAVE_FAILED: 'That didn’t save.'
}));
const { Popover } = await import('../src/app/(public)/planner/this-week-parts');

afterEach(cleanup);

function page() {
  const underneath = vi.fn();
  render(
    <>
      <Popover label="Teacher ▾" triggerClass="t" ariaLabel="Teachers">
        {() => <button type="button">Dan B</button>}
      </Popover>
      <button type="button" onClick={underneath}>
        Oliver K
      </button>
    </>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Teacher ▾' }));
  return underneath;
}

describe('Popover', () => {
  it('ClickingOffTheMenu_ClosesIt', () => {
    page();
    fireEvent.click(screen.getByTestId('pop-backdrop'));
    expect(screen.queryByRole('region', { name: 'Teachers' })).toBeNull();
  });

  it('TheClickOff_CoversThePage_SoNothingUnderneathRuns', () => {
    page();
    const backdrop = screen.getByTestId('pop-backdrop');
    expect([backdrop.getAttribute('aria-hidden'), screen.getByRole('region', { name: 'Teachers' }) != null]).toEqual(['true', true]);
  });
});
