import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResourceEntryForm } from '../src/app/admin/(workspace)/library/resource-entry-form';
import { TopicRow } from '../src/app/admin/(workspace)/library/topic-row';

/**
 * Two asks from Patrick, 2026-09-20, on the Library workstation:
 *
 *  1. The Topics (shelves) tab had a permanently-live "Save" that looked the
 *     same whether or not anything had been typed, and no way back from a
 *     half-made edit — the one admin edit form the 2026-08-24 Save standard
 *     never reached.
 *  2. Publishing a resource with no shelf picked produced something live that
 *     appeared on no page. The likelier of the two mistakes is choosing a
 *     shelf in the dropdown and never pressing "+ Place", so the refusal has
 *     to tell those apart.
 *
 * Draft stays allowed without a placement on purpose — parking a resource
 * before deciding where it goes is what a draft is for.
 */

const TARGET_GROUPS = [
  { group: 'Shelves', options: [{ value: 'topic:camping', label: 'Camping' }] }
];

function renderEntryForm() {
  const onCreate = vi.fn();
  const onUploadDocument = vi.fn(async () => ({ ok: true as const, url: '', filename: '' }));
  render(
    <ResourceEntryForm
      targetGroups={TARGET_GROUPS}
      onCreate={onCreate}
      onUploadDocument={onUploadDocument}
    />
  );
  return { onCreate };
}

describe('Add a resource — publishing needs a placement', () => {
  it('refuses to publish when nothing has been placed, and says why', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderEntryForm();

    await user.click(screen.getByRole('button', { name: 'Publish' }));

    expect(screen.getByRole('alert').textContent).toMatch(/pick a shelf or requirement/i);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('names the real mistake when a shelf is chosen but never added', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderEntryForm();

    await user.selectOptions(screen.getByRole('combobox', { name: /where it shows up/i }), 'topic:camping');
    await user.click(screen.getByRole('button', { name: 'Publish' }));

    expect(screen.getByRole('alert').textContent).toMatch(/\+ Place/i);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('clears the warning once the shelf is actually placed', async () => {
    const user = userEvent.setup();
    renderEntryForm();

    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(screen.queryByRole('alert')).not.toBeNull();

    await user.selectOptions(screen.getByRole('combobox', { name: /where it shows up/i }), 'topic:camping');
    await user.click(screen.getByRole('button', { name: '+ Place' }));

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still lets an unplaced resource be saved as a draft', async () => {
    const user = userEvent.setup();
    renderEntryForm();

    await user.click(screen.getByRole('button', { name: 'Save as draft' }));

    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Topics tab — Save follows the admin save standard', () => {
  function renderRow() {
    const updateAction = vi.fn();
    const toggleRetiredAction = vi.fn();
    render(
      <TopicRow updateAction={updateAction} toggleRetiredAction={toggleRetiredAction} retired={false}>
        <input name="title" defaultValue="Camping" aria-label="Title" />
      </TopicRow>
    );
    return { updateAction, toggleRetiredAction };
  }

  it('starts clean: Save reads "Saved" and is off', () => {
    renderRow();
    const save = screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.title).toBe('No changes to save yet');
  });

  it('offers Save changes once the row is edited', async () => {
    const user = userEvent.setup();
    renderRow();

    await user.type(screen.getByLabelText('Title'), '!');

    const save = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });

  it('offers Discard changes only once dirty, and it restores the last saved value', async () => {
    const user = userEvent.setup();
    renderRow();

    const discard = () => screen.getByRole('button', { name: 'Discard changes' }) as HTMLButtonElement;
    expect(discard().disabled).toBe(true);

    const title = screen.getByLabelText('Title') as HTMLInputElement;
    await user.type(title, ' Trip');
    expect(discard().disabled).toBe(false);

    await user.click(discard());
    expect(title.value).toBe('Camping');
    expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps Retire outside the dirty gate — a one-click action is its own gate', () => {
    renderRow();
    expect((screen.getByRole('button', { name: 'Retire' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
