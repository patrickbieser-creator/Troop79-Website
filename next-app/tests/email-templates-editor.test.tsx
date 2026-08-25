import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmailTemplatesEditor } from '../src/app/admin/(workspace)/advancement/lookups/email-templates-editor';
import { samplePreviewContext } from '../src/lib/signup-confirmation-preview';
import { TEMPLATE_KINDS } from '../src/lib/email-templates';

const ok = async () => ({ ok: true });

/** Lookups & Admin → Email templates (Plans/Signup-Confirmation-Email.md). */
describe('EmailTemplatesEditor', () => {
  it('TemplateLibrary_GroupsByKind_AddEditRetire', async () => {
    const user = userEvent.setup();
    const onRetire = vi.fn(ok);
    const onCreate = vi.fn(ok);
    render(
      <EmailTemplatesEditor
        rows={[
          { id: 1, name: 'Campout confirmation', kind: 'signup.family', subject: 'Signed up: [event]', body: 'Hi', retired_at: null },
          { id: 2, name: 'Money watch', kind: 'signup.leader', subject: '[event]', body: 'x', retired_at: '2026-01-01T00:00:00Z' }
        ]}
        previewCtx={samplePreviewContext()}
        onCreate={onCreate}
        onUpdate={vi.fn(ok)}
        onRetire={onRetire}
        onRestore={vi.fn(ok)}
      />
    );
    const family = screen.getByRole('region', { name: TEMPLATE_KINDS[0].label });
    const leader = screen.getByRole('region', { name: TEMPLATE_KINDS[1].label });
    expect(within(family).getByText('Campout confirmation')).toBeTruthy();
    expect(within(family).queryByText('Money watch')).toBeNull();
    expect(within(leader).getByText('Money watch')).toBeTruthy();
    expect(within(leader).getByText('Retired')).toBeTruthy();
    expect(within(leader).getByRole('button', { name: 'Restore' })).toBeTruthy();

    await user.click(within(family).getByRole('button', { name: 'Retire' }));
    expect(onRetire).toHaveBeenCalled();
    expect((onRetire.mock.calls[0] as unknown as [FormData])[0].get('id')).toBe('1');

    await user.click(within(family).getByRole('button', { name: '+ New template' }));
    await user.type(screen.getByLabelText('Name'), 'Meeting RSVP');
    await user.type(screen.getByLabelText('Subject'), 'See you at [event]');
    await user.type(screen.getByLabelText('Message'), 'Hi [name]');
    await user.click(screen.getByRole('button', { name: 'Save message' }));
    const fd = (onCreate.mock.calls[0] as unknown as [FormData])[0];
    expect(fd.get('kind')).toBe('signup.family');
    expect(fd.get('name')).toBe('Meeting RSVP');
  });
});
