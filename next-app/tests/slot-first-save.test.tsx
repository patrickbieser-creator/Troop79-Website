import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SlotFirstForm from '../src/app/(public)/events/[id]/slot-first-form';
import { staleClaims, type SignupSlot } from '../src/lib/event-signup';
import type { Household } from '../src/lib/households';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() })
}));

/**
 * Slot-first (job board) form — saving edits (Patrick, 2026-08-23, two bug
 * reports on the Unity Church service project): "Save changes appears and is
 * active, yet does nothing" and "the name Patrick reappeared after I clicked
 * Save Changes". The board is a DRAFT: the × on a chip edits the draft, Save
 * commits it. A removed person must therefore be SENT (as declined), not
 * merely omitted, and Save is live only when the draft differs from what is
 * saved.
 */
const household: Household = {
  key: '7',
  label: 'Sankpal-Tatera',
  scouts: [{ id: 'S1', displayName: 'Maya', personId: 11 }],
  adults: [{ key: 'pe82', personId: 82, leaderCode: null, name: 'Patrick Bieser', relationship: 'Dad', email: null, defaultVehicleSeats: null }]
};
const server: SignupSlot = {
  id: 1,
  kind: 'shift',
  label: 'Server',
  description: null,
  slot_date: '2026-09-02',
  starts_at: '17:00:00',
  ends_at: '19:00:00',
  attendance_required: true,
  eligibility: 'both',
  needed: 4,
  sort: 0,
  filled: 2
};

function renderBoard(
  existingClaims: { slotId: number; personKey: string; comment?: string | null }[],
  opts: {
    guestMode?: 'none' | 'count' | 'named';
    existingGuests?: { name: string; cls: 'youth_guest' | 'adult_guest' | 'webelos' | 'cub_scout'; personId?: number | null }[];
    existingGuestCount?: { count: number; note: string };
  } = {}
) {
  return render(
    <SlotFirstForm
      eventId={35}
      signupId={9}
      household={household}
      households={[household]}
      slots={[server]}
      guestMode={opts.guestMode ?? 'none'}
      guestPrompt={null}
      existingGuests={(opts.existingGuests ?? []).map((g) => ({ personId: g.personId ?? null, name: g.name, cls: g.cls, phone: '' }))}
      existingGuestCount={opts.existingGuestCount}
      existingClaims={existingClaims}
      submitAction={vi.fn()}
      cancelAction={vi.fn()}
      gateAction={vi.fn()}
      signOutAction={vi.fn()}
      hasExisting={existingClaims.length > 0}
      gateState="ready"
      isFamilySession
      gateConfigured
    />
  );
}
const entriesField = () => JSON.parse((document.querySelector('input[name="entries"]') as HTMLInputElement).value) as { key: string; status: string }[];
const saveBtn = () => screen.getByRole('button', { name: /save changes|saved|submit family signup/i }) as HTMLButtonElement;

describe('slot-first form — saving edits', () => {
  it('Save_IsDisabledUntilTheDraftDiffersFromWhatIsSaved', async () => {
    const user = userEvent.setup();
    renderBoard([
      { slotId: 1, personKey: 's0', comment: null },
      { slotId: 1, personKey: 'a0', comment: null }
    ]);
    expect(saveBtn().disabled).toBe(true);
    expect(saveBtn().textContent).toMatch(/saved/i);
    await user.click(screen.getByRole('button', { name: 'Remove Patrick Bieser' }));
    expect(saveBtn().disabled).toBe(false);
    expect(saveBtn().textContent).toMatch(/save changes/i);
  });

  it('RemovingAPersonsLastJob_SendsThemAsDeclined_NotOmitted', async () => {
    const user = userEvent.setup();
    renderBoard([
      { slotId: 1, personKey: 's0', comment: null },
      { slotId: 1, personKey: 'a0', comment: null }
    ]);
    expect(entriesField().map((e) => [e.key, e.status])).toEqual([
      ['s0', 'yes'],
      ['a0', 'yes']
    ]);
    await user.click(screen.getByRole('button', { name: 'Remove Patrick Bieser' }));
    expect(entriesField().map((e) => [e.key, e.status])).toEqual([
      ['s0', 'yes'],
      ['a0', 'no']
    ]);
    // The recap lists only who is still helping.
    expect(screen.queryByText('Patrick Bieser', { selector: 'strong' })).toBeNull();
  });

  it('ChangingTheJobNote_MakesTheDraftDirty', async () => {
    const user = userEvent.setup();
    renderBoard([{ slotId: 1, personKey: 's0', comment: 'Running late' }]);
    expect(saveBtn().disabled).toBe(true);
    const note = screen.getByDisplayValue('Running late');
    await user.type(note, ' — ten minutes');
    expect(saveBtn().disabled).toBe(false);
  });

  it('FirstSubmit_NeedsAtLeastOneJob', () => {
    renderBoard([]);
    expect(saveBtn().textContent).toMatch(/submit family signup/i);
    expect(saveBtn().disabled).toBe(true);
  });
});

describe('slot-first form — guests (Patrick, 2026-08-23: "I added the guest Fred Pike and clicked Save Changes, nothing happened")', () => {
  // The guest WAS saved (a guest row under the host's entry) — the board just
  // never showed it again: saved guests were not seeded back into the form and
  // the recap did not mention them. Now they are, and the recap lists them.
  it('SavedGuests_AreSeededIntoTheForm_AndListedInTheRecap_SaveStaysClean', () => {
    renderBoard([{ slotId: 1, personKey: 'a0', comment: null }], { guestMode: 'named', existingGuests: [{ name: 'Fred Pike', cls: 'adult_guest', personId: 77 }] });
    expect(screen.getByDisplayValue('Fred Pike')).toBeTruthy();
    expect(screen.getByText(/Fred Pike/, { selector: 'li, li *' })).toBeTruthy(); // the recap
    expect(saveBtn().disabled).toBe(true); // nothing changed yet
  });

  it('AddingAGuest_MakesTheDraftDirty_AndRemovingItAgain_MakesItClean', async () => {
    const user = userEvent.setup();
    renderBoard([{ slotId: 1, personKey: 'a0', comment: null }], { guestMode: 'named' });
    await user.click(screen.getByRole('button', { name: /add a guest/i }));
    await user.type(screen.getByRole('textbox', { name: /guest name 1/i }), 'Fred Pike');
    expect(saveBtn().disabled).toBe(false);
    expect(screen.getByText(/Fred Pike/, { selector: 'li, li *' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /remove guest 1/i }));
    expect(saveBtn().disabled).toBe(true);
  });

  it('GuestsWithoutAHelper_CannotBeSaved_AndTheFormSaysWhy', async () => {
    // A guest row hangs off a household member who is signed up; with no job
    // claimed there is nobody to attach them to, so the action would silently
    // drop them — the form blocks Save and explains instead.
    const user = userEvent.setup();
    renderBoard([], { guestMode: 'named' });
    await user.click(screen.getByRole('button', { name: /add a guest/i }));
    await user.type(screen.getByRole('textbox', { name: /guest name 1/i }), 'Fred Pike');
    expect(saveBtn().disabled).toBe(true);
    expect(screen.getByText(/pick a job for at least one person/i)).toBeTruthy();
  });

  it('CountMode_ShowsTheNumber_HidesNamedRows_AndRidesOnTheHelpingEntry', async () => {
    const user = userEvent.setup();
    renderBoard([{ slotId: 1, personKey: 'a0', comment: null }], { guestMode: 'count' });
    expect(screen.queryByRole('button', { name: /add a guest/i })).toBeNull();
    const n = screen.getByRole('spinbutton', { name: /number of guests/i });
    await user.clear(n);
    await user.type(n, '3');
    expect(saveBtn().disabled).toBe(false);
    const host = entriesField().find((e) => e.key === 'a0') as unknown as { guest_count: number };
    expect(host.guest_count).toBe(3);
  });

  it('NamedMode_HidesTheCount', () => {
    renderBoard([{ slotId: 1, personKey: 'a0', comment: null }], { guestMode: 'named' });
    expect(screen.queryByRole('spinbutton', { name: /number of guests/i })).toBeNull();
    expect(screen.getByRole('button', { name: /add a guest/i })).toBeTruthy();
  });
});

describe('staleClaims — what the server deletes after a submit', () => {
  it('ClaimsTheFormNoLongerCarries_AreStale_TheRestStay', () => {
    const current = [
      { entryId: 100, slotId: 1 },
      { entryId: 101, slotId: 1 },
      { entryId: 101, slotId: 2 }
    ];
    const wanted = new Set(['100:1', '101:2']);
    expect(staleClaims(current, wanted)).toEqual([{ entryId: 101, slotId: 1 }]);
    expect(staleClaims(current, new Set(['100:1', '101:1', '101:2']))).toEqual([]);
  });
});
