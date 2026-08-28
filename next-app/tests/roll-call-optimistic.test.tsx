import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RollCall } from '../src/app/admin/(workspace)/calendar/[id]/roll-call/roll-call';
import type { AttendeeCandidate, AttendanceRow } from '../src/lib/attendance-shared';

/**
 * A tap on the Roll Call sheet used to disable every checkbox, await the
 * write, then `router.refresh()` the whole workbench — ten queries and a
 * full re-render per person, thirty times a meeting
 * (Plans/Performance-Review-2026-08-27.md #6). Now the box flips at once,
 * only that person is busy, and the refresh is coalesced.
 */
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() })
}));

function person(personId: number, displayName: string): AttendeeCandidate {
  return { personId, displayName, scoutId: `s${personId}`, tab: 'active_scout', signedUp: false };
}
const candidates = [person(1, 'Avery Scout'), person(2, 'Blake Scout')];
const attendance: AttendanceRow[] = [{ id: 1, personId: 1, qty: null, source: 'manual', note: null }];

function renderSheet(over: Partial<React.ComponentProps<typeof RollCall>> = {}) {
  return render(
    <RollCall
      entryId={109}
      entryTitle="PLC Meeting"
      creditKind={null}
      creditUnit={null}
      countsAsActivity={false}
      defaultQty={1}
      hasSignup={false}
      candidates={candidates}
      attendance={attendance}
      onMark={vi.fn(async () => ({ ok: true }))}
      onUnmark={vi.fn(async () => ({ ok: true }))}
      onSetQty={vi.fn()}
      onSeed={vi.fn()}
      {...over}
    />
  );
}

describe('Roll Call — optimistic checkbox', () => {
  it('Checkbox_FlipsAtOnce_AndOthersStayEnabled_WhileTheWriteIsInFlight', async () => {
    let settle: (r: { ok: boolean }) => void = () => {};
    const onMark = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => (settle = resolve)));
    renderSheet({ onMark });

    const blake = screen.getByLabelText(/Blake Scout/) as HTMLInputElement;
    const avery = screen.getByLabelText(/Avery Scout/) as HTMLInputElement;
    await userEvent.click(blake);

    expect(blake.checked).toBe(true);
    expect(blake.disabled).toBe(true);
    expect(avery.disabled).toBe(false);
    expect(screen.getByRole('tab', { name: /Scouts/ }).textContent).toBe('Scouts2');

    settle({ ok: true });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(blake.disabled).toBe(false);
  });

  it('Checkbox_RevertsAndExplains_WhenTheWriteFails', async () => {
    refresh.mockClear();
    renderSheet({ onMark: vi.fn(async () => ({ ok: false, error: 'That entry no longer exists.' })) });

    const blake = screen.getByLabelText(/Blake Scout/) as HTMLInputElement;
    await userEvent.click(blake);

    await waitFor(() => expect(blake.checked).toBe(false));
    expect(screen.getByRole('alert').textContent).toContain('That entry no longer exists.');
    expect(refresh).not.toHaveBeenCalled();
  });
});
