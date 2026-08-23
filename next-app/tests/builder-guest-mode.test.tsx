import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BuilderPanels } from '../src/app/admin/(workspace)/events/[id]/builder-panels';

const updateSignup = vi.fn(async () => ({ ok: true }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
}));
vi.mock('../src/app/admin/(workspace)/events/actions', () => ({
  updateSignup: (...args: unknown[]) => updateSignup(...(args as [])),
  addPrice: vi.fn(), deletePrice: vi.fn(), updatePrice: vi.fn(), backfillPrices: vi.fn(),
  addSlot: vi.fn(), deleteSlot: vi.fn(), updateSlot: vi.fn(), addQuestion: vi.fn(), deleteQuestion: vi.fn(),
  disableSignup: vi.fn(), addGroupSet: vi.fn(), updateGroupSet: vi.fn(), deleteGroupSet: vi.fn(),
  setQuestionPrintAllowed: vi.fn()
}));

/**
 * Guests as People (Plans/Guests-As-People.md): the Builder's Guests block is
 * a three-way MODE — none / count only / named — with an editable family
 * prompt, and a warning when a priced event is left in count mode (a counted
 * guest can't be charged).
 */
function renderBuilder(signup: Record<string, unknown>, prices: Record<string, unknown>[] = []) {
  return render(
    <BuilderPanels
      signupId={1}
      calendarEntryId={2}
      entryDate="2026-10-09"
      endDate="2026-10-11"
      signup={{ attendance_enabled: true, status: 'open', ...signup }}
      prices={prices}
      slots={[]}
      questions={[]}
      sets={[]}
    />
  );
}

describe('Builder — Guests is a three-way mode', () => {
  it('GuestMode_RendersThreeChoices_WithTheSavedOneChecked_AndSavesGuestMode', async () => {
    const user = userEvent.setup();
    renderBuilder({ guest_mode: 'count' });
    const group = screen.getByRole('radiogroup', { name: /guest mode/i });
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual(['none', 'count', 'named']);
    expect(radios[1].checked).toBe(true);
    expect(screen.queryByRole('checkbox', { name: /^guests/i })).toBeNull(); // the old toggle is gone
    await user.click(within(group).getByRole('radio', { name: /named guests/i }));
    expect(updateSignup).toHaveBeenCalledWith(1, 2, { guest_mode: 'named' });
  });

  it('GuestMode_None_HidesThePromptField_OtherModesShowIt_WithAModeDefaultPlaceholder', () => {
    const { unmount } = renderBuilder({ guest_mode: 'none' });
    expect(screen.queryByLabelText(/prompt shown to families/i)).toBeNull();
    unmount();
    renderBuilder({ guest_mode: 'named', guest_prompt: null });
    const prompt = screen.getByLabelText(/prompt shown to families/i) as HTMLInputElement;
    expect(prompt.placeholder).toBe('Bringing anyone else?');
  });

  it('GuestMode_Count_OnAPricedEvent_WarnsThatGuestsCannotBeCharged', () => {
    const { unmount } = renderBuilder({ guest_mode: 'count' }, [{ id: 1, label: 'Scout', amount: 30, per: 'event', applies_to: 'scouts' }]);
    expect(screen.getByText(/guests can’t be charged as a count/i)).toBeTruthy();
    unmount();
    renderBuilder({ guest_mode: 'count' }, []);
    expect(screen.queryByText(/guests can’t be charged as a count/i)).toBeNull();
  });

  it('GuestMode_Missing_ReadsAsNone', () => {
    renderBuilder({});
    const group = screen.getByRole('radiogroup', { name: /guest mode/i });
    expect((within(group).getByRole('radio', { name: /no guests/i }) as HTMLInputElement).checked).toBe(true);
  });
});
