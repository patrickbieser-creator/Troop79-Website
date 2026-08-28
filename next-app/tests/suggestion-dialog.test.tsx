import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SuggestionButton } from '../src/app/admin/(workspace)/advancement/dashboard/suggestion-button';
import type { SuggestionResult } from '../src/app/admin/(workspace)/advancement/dashboard/suggestion-actions';

/**
 * The "Make a Suggestion" dialog (Leader Dashboard, 2026-08-28). The leader
 * is already signed in, so their name and email are shown read-only — the
 * form only asks for the suggestion itself.
 */

type Action = (text: string) => Promise<SuggestionResult>;

function setup(action: ReturnType<typeof vi.fn<Action>> = vi.fn<Action>(async () => ({ ok: true }))) {
  render(<SuggestionButton actorName="Becky Vest" actorEmail="becky@example.com" action={action} />);
  return { action, user: userEvent.setup() };
}

describe('SuggestionButton', () => {
  it('Dialog_PrefillsWhoIsAsking_WhenOpened', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Make a Suggestion' }));
    expect(screen.getByText('Becky Vest')).toBeTruthy();
    expect(screen.getByText('becky@example.com')).toBeTruthy();
    expect(screen.getByLabelText(/Your suggestion/)).toBeTruthy();
  });

  it('Submit_SendsTrimmedText_WhenFilledIn', async () => {
    const { user, action } = setup();
    await user.click(screen.getByRole('button', { name: 'Make a Suggestion' }));
    await user.type(screen.getByLabelText(/Your suggestion/), '  Remember my roster tab.  ');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(action).toHaveBeenCalledWith('Remember my roster tab.'));
    expect(await screen.findByText(/Thanks — your suggestion was sent/)).toBeTruthy();
  });

  it('Submit_DoesNotCallAction_WhenBlank', async () => {
    const { user, action } = setup();
    await user.click(screen.getByRole('button', { name: 'Make a Suggestion' }));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/write your suggestion/);
  });

  it('Submit_ShowsServerError_WhenActionFails', async () => {
    const { user } = setup(vi.fn<Action>(async () => ({ ok: false, error: 'Email is not configured.' })));
    await user.click(screen.getByRole('button', { name: 'Make a Suggestion' }));
    await user.type(screen.getByLabelText(/Your suggestion/), 'hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Email is not configured.');
  });
});
