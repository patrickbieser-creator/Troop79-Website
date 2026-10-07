import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminNumberBox } from '../src/app/admin/_components/admin-number-box';

/** AdminNumberBox: the admin twin of the shared NumberBox (admin tokens only, so the admin/public firewall stays shut). */
describe('AdminNumberBox', () => {
  it('AdminNumberBox_CommitsOnBlur_AndClampsToTheRange', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<AdminNumberBox id="n" value={2} min={1} max={9} ariaLabel="Count" onCommit={onCommit} />);
    const box = screen.getByRole('spinbutton', { name: 'Count' });
    await user.clear(box);
    await user.type(box, '40');
    await user.tab();
    expect([onCommit.mock.calls.at(-1), (box as HTMLInputElement).value]).toEqual([[9], '9']);
  });

  it('AdminNumberBox_CommitsOnEnter', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<AdminNumberBox id="n" value={2} min={1} max={9} ariaLabel="Count" onCommit={onCommit} />);
    const box = screen.getByRole('spinbutton', { name: 'Count' });
    await user.clear(box);
    await user.type(box, '4{Enter}');
    expect(onCommit.mock.calls.at(-1)).toEqual([4]);
  });

  it('AdminNumberBox_RestoresTheValue_WhenLeftEmpty', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<AdminNumberBox id="n" value={2} min={1} max={9} ariaLabel="Count" onCommit={onCommit} />);
    const box = screen.getByRole('spinbutton', { name: 'Count' }) as HTMLInputElement;
    await user.clear(box);
    await user.tab();
    expect([onCommit.mock.calls.length, box.value]).toEqual([0, '2']);
  });
});
