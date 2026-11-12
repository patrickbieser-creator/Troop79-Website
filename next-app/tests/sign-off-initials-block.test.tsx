import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InitialsBlock } from '../src/app/admin/(workspace)/advancement/roster/[personId]/initials-block';
import {
  addInitials,
  renameInitials,
  setInitialsRetired
} from '../src/app/admin/(workspace)/advancement/roster/[personId]/initials-actions';

/**
 * The person record's Sign-off initials block (Plans/Sign-Off-Initials.md).
 * Mock boundary is the server action: assert what the block sent and what it
 * showed.
 */
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
vi.mock('../src/app/admin/(workspace)/advancement/roster/[personId]/initials-actions', () => ({
  addInitials: vi.fn(async () => ({ ok: true })),
  renameInitials: vi.fn(async () => ({ ok: true })),
  setInitialsRetired: vi.fn(async () => ({ ok: true }))
}));

beforeEach(() => vi.clearAllMocks());

describe('Sign-off initials block', () => {
  it('Leader_SeesNoneAndAdd_WhenThePersonHasNoInitials', () => {
    render(<InitialsBlock personId={7} name="Kara Pitt" initials={null} suggestion="KP2" />);
    expect([screen.getByText('None').textContent, screen.getByRole('button', { name: 'Add' }).textContent]).toEqual([
      'None',
      'Add'
    ]);
  });

  it('Leader_AddsTheSuggestedInitials', async () => {
    render(<InitialsBlock personId={7} name="Kara Pitt" initials={null} suggestion="KP2" />);
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add initials' }));
    expect(addInitials).toHaveBeenCalledWith(7, 'KP2');
  });

  it('BlockedAdd_MarksTheFieldAndSaysWhy', async () => {
    render(<InitialsBlock personId={7} name="Kara Pitt" initials={null} suggestion="KP2" />);
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    const field = screen.getByLabelText('New initials');
    await userEvent.clear(field);
    await userEvent.type(field, 'K');
    await userEvent.click(screen.getByRole('button', { name: 'Add initials' }));
    expect({
      invalid: field.getAttribute('aria-invalid'),
      note: screen.getByRole('alert').textContent,
      sent: vi.mocked(addInitials).mock.calls.length
    }).toEqual({ invalid: 'true', note: 'Can’t save yet: Initials are 2–5 letters, like PB or KrP.', sent: 0 });
  });

  it('RenameConfirm_NamesTheEntryCount', async () => {
    render(
      <InitialsBlock personId={7} name="Patrick Bieser" initials={{ code: 'PB', retiredAt: null, entries: 2601 }} suggestion="" />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const field = screen.getByLabelText('Initials');
    await userEvent.clear(field);
    await userEvent.type(field, 'PJB');
    await userEvent.click(screen.getByRole('button', { name: 'Save initials' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/ledger entries signed/).textContent).toBe('2,601 ledger entries signed PB will read PJB');
  });

  it('RenameConfirm_SendsTheRename', async () => {
    render(
      <InitialsBlock personId={7} name="Patrick Bieser" initials={{ code: 'PB', retiredAt: null, entries: 3 }} suggestion="" />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const field = screen.getByLabelText('Initials');
    await userEvent.clear(field);
    await userEvent.type(field, 'PJB');
    await userEvent.click(screen.getByRole('button', { name: 'Save initials' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Rename to PJB' }));
    expect(renameInitials).toHaveBeenCalledWith(7, 'PJB');
  });

  it('Edit_ShowsSaved_UntilTheInitialsChange', async () => {
    render(
      <InitialsBlock personId={7} name="Patrick Bieser" initials={{ code: 'PB', retiredAt: null, entries: 3 }} suggestion="" />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('button', { name: 'Saved' }).hasAttribute('disabled')).toBe(true);
  });

  it('Retire_ConfirmsFirst_ThenRetires', async () => {
    render(
      <InitialsBlock personId={7} name="Summer Kimble" initials={{ code: 'SK', retiredAt: null, entries: 37 }} suggestion="" />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Retire…' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Retire SK' }));
    expect(setInitialsRetired).toHaveBeenCalledWith(7, true);
  });

  it('RetiredCode_ShowsRestore', async () => {
    render(
      <InitialsBlock
        personId={7}
        name="Summer Kimble"
        initials={{ code: 'SK', retiredAt: '2026-11-12T18:00:00Z', entries: 37 }}
        suggestion=""
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect({ text: screen.getByText(/retired/).textContent, call: vi.mocked(setInitialsRetired).mock.calls[0] }).toEqual({
      text: ', retired November 2026',
      call: [7, false]
    });
  });
});
