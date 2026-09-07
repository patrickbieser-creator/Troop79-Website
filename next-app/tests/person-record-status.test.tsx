import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusCard } from '../src/app/admin/(workspace)/advancement/roster/[personId]/status-card';
import { setPersonActive } from '../src/app/admin/(workspace)/advancement/roster/person-actions';
import { setScoutActive } from '../src/app/admin/(workspace)/advancement/roster/[personId]/scout-status-actions';

/**
 * Person Editor Rethink, Phase 1 (Plans/Person-Editor-Rethink.md) — the
 * Marita bug. Status is ONE read row with ONE Edit; Edit opens an inline
 * panel (reason → "Mark inactive…" → confirm dialog), and after the change
 * the card returns to the read row with a "Saved just now" stamp. No Save /
 * Saved button exists anywhere in the card, so a leader who just changed
 * Status can never see a grey "Saved" and conclude nothing happened. The
 * same component, the same flow, for scouts and adults.
 */
vi.mock('../src/app/admin/(workspace)/advancement/roster/person-actions', () => ({
  setPersonActive: vi.fn(async () => ({ ok: true }))
}));
vi.mock('../src/app/admin/(workspace)/advancement/roster/[personId]/scout-status-actions', () => ({
  setScoutActive: vi.fn(async () => ({ ok: true }))
}));

beforeEach(() => {
  vi.mocked(setPersonActive).mockClear().mockResolvedValue({ ok: true });
  vi.mocked(setScoutActive).mockClear().mockResolvedValue({ ok: true });
});

function renderAdult(over: { active?: boolean; reason?: string | null } = {}) {
  const onChanged = vi.fn();
  render(
    <StatusCard
      personId={401}
      scoutId={null}
      kind="adult"
      name="Dana Whitlock"
      active={over.active ?? true}
      reason={over.reason ?? null}
      onChanged={onChanged}
    />
  );
  return { onChanged };
}

function renderScout(over: { active?: boolean; reason?: string | null } = {}) {
  const onChanged = vi.fn();
  render(
    <StatusCard
      personId={402}
      scoutId="Z99"
      kind="scout"
      name="Corey Whitlock"
      active={over.active ?? true}
      reason={over.reason ?? null}
      onChanged={onChanged}
    />
  );
  return { onChanged };
}

const card = () => screen.getByRole('region', { name: 'Status' });

describe('StatusCard — read row → Edit → reason → confirm → read row', () => {
  it('Leader_MarksAdultInactive_SeesConfirmThenReadRow', async () => {
    const user = userEvent.setup();
    const { onChanged } = renderAdult();

    // Read row: one pill, one Edit — no radios, no Save.
    expect(within(card()).getByText('Active')).toBeTruthy();
    expect(within(card()).queryByRole('radio')).toBeNull();
    await user.click(within(card()).getByRole('button', { name: 'Edit' }));

    // Adult: free-text optional reason, then the gated step.
    await user.type(within(card()).getByLabelText(/Reason/), 'Moved to Chicago');
    await user.click(within(card()).getByRole('button', { name: 'Mark inactive…' }));

    // Confirm dialog names the consequences before anything is written.
    const dialog = await screen.findByRole('dialog', { name: /Mark Dana Whitlock inactive\?/ });
    expect(within(dialog).getByText(/No longer offered in the family signup picker/)).toBeTruthy();
    expect(within(dialog).getByText(/Moved to Chicago/)).toBeTruthy();
    expect(setPersonActive).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Mark inactive' }));

    await waitFor(() => expect(setPersonActive).toHaveBeenCalledWith(401, false, 'Moved to Chicago'));
    // Back to the read row, stamped, with the new state and its reason.
    await within(card()).findByText('Saved just now');
    expect(within(card()).getByText('Inactive')).toBeTruthy();
    expect(within(card()).getByText(/Moved to Chicago/)).toBeTruthy();
    expect(within(card()).getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(onChanged).toHaveBeenCalledWith({ active: false, reason: 'Moved to Chicago' });
  });

  it('Leader_MarksScoutInactive_SameFlowAsAdult', async () => {
    const user = userEvent.setup();
    const { onChanged } = renderScout();

    await user.click(within(card()).getByRole('button', { name: 'Edit' }));

    // Scout: the reason is a required pick from the fixed list, and the gated
    // step is greyed with a reason until one is chosen.
    const markBtn = within(card()).getByRole('button', { name: 'Mark inactive…' });
    expect((markBtn as HTMLButtonElement).disabled).toBe(true);
    expect(markBtn.getAttribute('title')).toBe('Pick a reason first');

    const select = within(card()).getByLabelText(/Reason/);
    expect(select.tagName).toBe('SELECT');
    await user.selectOptions(select, 'moved_away');
    expect((markBtn as HTMLButtonElement).disabled).toBe(false);
    expect(markBtn.getAttribute('title')).toBeNull();

    await user.click(markBtn);
    const dialog = await screen.findByRole('dialog', { name: /Mark Corey Whitlock inactive\?/ });
    expect(within(dialog).getByText(/Leaves rosters, dashboards and the Fast Entry picker/)).toBeTruthy();
    expect(within(dialog).getByText(/Moved away/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Mark inactive' }));

    await waitFor(() => expect(setScoutActive).toHaveBeenCalledWith('Z99', false, 'moved_away'));
    expect(setPersonActive).not.toHaveBeenCalled();
    await within(card()).findByText('Saved just now');
    expect(within(card()).getByText('Inactive')).toBeTruthy();
    expect(within(card()).getByText(/Moved away/)).toBeTruthy();
    expect(onChanged).toHaveBeenCalledWith({ active: false, reason: 'moved_away' });
  });

  it('Leader_ReactivatesPerson_ReasonCleared', async () => {
    const user = userEvent.setup();
    const { onChanged } = renderAdult({ active: false, reason: 'Moved to Chicago' });

    expect(within(card()).getByText('Inactive')).toBeTruthy();
    expect(within(card()).getByText(/Moved to Chicago/)).toBeTruthy();
    await user.click(within(card()).getByRole('button', { name: 'Edit' }));

    // Reactivation names what it clears, and needs no confirm dialog.
    expect(within(card()).getByText(/The recorded reason .*Moved to Chicago.* is cleared/)).toBeTruthy();
    await user.click(within(card()).getByRole('button', { name: 'Mark active' }));

    await waitFor(() => expect(setPersonActive).toHaveBeenCalledWith(401, true, ''));
    await within(card()).findByText('Saved just now');
    expect(within(card()).getByText('Active')).toBeTruthy();
    expect(within(card()).queryByText(/Moved to Chicago/)).toBeNull();
    expect(onChanged).toHaveBeenCalledWith({ active: true, reason: null });
  });

  it('Leader_SeesNoContradictorySave_WhenStatusJustChanged', async () => {
    const user = userEvent.setup();
    renderAdult();

    await user.click(within(card()).getByRole('button', { name: 'Edit' }));
    await user.click(within(card()).getByRole('button', { name: 'Mark inactive…' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Mark inactive' }));
    await within(card()).findByText('Saved just now');

    // The Marita bug: no "Save" / "Saved" / "Save changes" button, enabled or
    // disabled, anywhere in the card after the status changed.
    const saveLike = within(card())
      .queryAllByRole('button', { hidden: true })
      .filter((b) => /^(Save|Saved|Save changes)$/.test(b.textContent?.trim() ?? ''));
    expect(saveLike).toEqual([]);
  });

  it('Leader_CancelsStatusEdit_NothingWritten', async () => {
    const user = userEvent.setup();
    const { onChanged } = renderAdult();

    await user.click(within(card()).getByRole('button', { name: 'Edit' }));
    await user.click(within(card()).getByRole('button', { name: 'Cancel' }));

    expect(within(card()).getByText('Active')).toBeTruthy();
    expect(within(card()).getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(setPersonActive).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
