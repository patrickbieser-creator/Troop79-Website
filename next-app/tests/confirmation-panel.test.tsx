import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmationPanel, recipientErrors } from '../src/app/admin/(workspace)/events/[id]/confirmation-panel';
import { samplePreviewContext } from '../src/lib/signup-confirmation-preview';

const updateConfirmation = vi.fn(async () => ({ ok: true }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('../src/app/admin/(workspace)/events/actions', () => ({
  updateConfirmation: (...args: unknown[]) => updateConfirmation(...(args as []))
}));

const templates = [
  { id: 1, name: 'Campout confirmation', kind: 'signup.family', subject: 'Signed up: [event]', body: 'Hi [name]', retired_at: null },
  { id: 2, name: 'New signup', kind: 'signup.leader', subject: '[household]', body: '[going]', retired_at: null },
  { id: 3, name: 'Old one', kind: 'signup.family', subject: 'x', body: 'y', retired_at: '2026-01-01T00:00:00Z' }
];

function renderPanel(signup: Record<string, unknown> = {}) {
  return render(
    <ConfirmationPanel signupId={1} calendarEntryId={2} signup={signup} templates={templates} previewCtx={samplePreviewContext()} />
  );
}

/** The builder's Confirmation email block (Plans/Signup-Confirmation-Email.md). */
describe('ConfirmationPanel', () => {
  it('ConfirmationBlock_IsOffByDefault_AndShowsFamilyAndLeaderPanelsWhenOn', async () => {
    const user = userEvent.setup();
    renderPanel();
    const master = screen.getByRole('checkbox', { name: /send confirmation emails/i }) as HTMLInputElement;
    expect(master.checked).toBe(false);
    expect(screen.queryByText('Family receipt')).toBeNull();
    await user.click(master);
    expect(screen.getByText('Family receipt')).toBeTruthy();
    expect(screen.getByText('Leader notification')).toBeTruthy();
  });

  it('ConfirmationBlock_TemplatePicker_IsFilteredByKind_AndHidesRetired', async () => {
    const user = userEvent.setup();
    renderPanel({ confirm_family_enabled: true });
    const picker = screen.getByLabelText('Template') as HTMLSelectElement;
    const labels = Array.from(picker.options).map((o) => o.textContent);
    expect(labels).toEqual(['Built-in default', 'Campout confirmation']);
    await user.selectOptions(picker, '1');
    expect(screen.getByText(/Subject:/).closest('p')!.textContent).toContain('Signed up: Fall Campout');
  });

  it('ConfirmationBlock_LeaderPanel_HidesPicker_WhenUseTheFamilyMessage', async () => {
    const user = userEvent.setup();
    renderPanel({ confirm_leader_enabled: true });
    expect(screen.getByLabelText('Template')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: /use the family message/i }));
    expect(screen.queryByLabelText('Template')).toBeNull();
    expect(screen.getByText('Leaders receive exactly what the family receives.')).toBeTruthy();
    expect(screen.getByText('Reply-To is the first address.')).toBeTruthy();
  });

  it('ConfirmationBlock_LeaderRecipients_ShowFieldError_OnBadEmail_AndCapAtFive', async () => {
    const user = userEvent.setup();
    renderPanel({ confirm_leader_enabled: true });
    const inputs = screen.getAllByLabelText(/Leader address \d/) as HTMLInputElement[];
    expect(inputs).toHaveLength(5);
    expect(screen.queryByLabelText('Leader address 6')).toBeNull();
    await user.type(inputs[0], 'not-an-email');
    expect(screen.getByText('Not an email address.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(inputs[0]);
    await user.type(inputs[0], 'a@b.com');
    await user.type(inputs[1], 'A@B.com');
    expect(screen.getByText('Listed twice.')).toBeTruthy();
  });

  it('ConfirmationBlock_Customize_MarksTheMessageCustomized_AndResetRestoresTheTemplate', async () => {
    const user = userEvent.setup();
    renderPanel({ confirm_family_enabled: true, confirm_family_subject: 'Custom: [event]', confirm_family_body: 'Custom body' });
    expect(screen.getByText('Customized')).toBeTruthy();
    expect(screen.getByText(/Subject:/).closest('p')!.textContent).toContain('Custom: Fall Campout');
    await user.click(screen.getByRole('button', { name: 'Reset to template' }));
    expect(screen.queryByText('Customized')).toBeNull();
    expect(screen.getByText(/Subject:/).closest('p')!.textContent).toContain('Signed up: Fall Campout');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(updateConfirmation).toHaveBeenCalledWith(1, 2, expect.objectContaining({ familySubject: null, familyBody: null, familyEnabled: true }));
  });

  it('RecipientErrors_MirrorTheServerRule', () => {
    expect(recipientErrors(['', 'bad', 'a@b.com', ' A@B.COM '])).toEqual([null, 'Not an email address.', null, 'Listed twice.']);
  });
});
