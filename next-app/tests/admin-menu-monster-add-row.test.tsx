import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { AdminAddRow } from '../src/app/admin/(workspace)/library/menu-monster/admin-add-row';

/**
 * AdminAddRow — the admin twin of the scout planner's AddRow (Plans/Menu-Monster-Add-Pattern.md, Phase 2): a quiet
 * link at rest, the caller's search on tap, a visible quiet Cancel at the row's right end, focus back to the link.
 * Admin tokens only (the admin/public firewall), so it is its own component.
 */

const actions = [
  { id: 'ing', label: 'Ingredient', content: <input aria-label="Find an ingredient" /> },
  { id: 'line', label: 'Line', content: <input aria-label="Find a line" /> }
];

describe('AdminAddRow', () => {
  it('AdminAddRow_ShowsLinksAtRest_AndNoSearch', () => {
    render(<AdminAddRow actions={actions} />);
    expect([screen.getByRole('button', { name: '+ Ingredient' }) != null, screen.queryByRole('textbox'), screen.queryByRole('button', { name: 'Cancel' })]).toEqual([true, null, null]);
  });

  it('AdminAddRow_Tap_OpensTheSearch_WithFocusInIt_AndACancel', async () => {
    const user = userEvent.setup();
    render(<AdminAddRow actions={actions} />);
    await user.click(screen.getByRole('button', { name: '+ Ingredient' }));
    expect([document.activeElement === screen.getByRole('textbox', { name: 'Find an ingredient' }), screen.getByRole('button', { name: 'Cancel' }) != null]).toEqual([true, true]);
  });

  it('AdminAddRow_Cancel_RestoresTheLink_AndFocusesIt', async () => {
    const user = userEvent.setup();
    render(<AdminAddRow actions={actions} />);
    await user.click(screen.getByRole('button', { name: '+ Ingredient' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect([screen.queryByRole('textbox'), document.activeElement]).toEqual([null, screen.getByRole('button', { name: '+ Ingredient' })]);
  });

  it('AdminAddRow_Esc_WithNothingTyped_RestoresTheLink', async () => {
    const user = userEvent.setup();
    render(<AdminAddRow actions={actions} />);
    await user.click(screen.getByRole('button', { name: '+ Line' }));
    await user.keyboard('{Escape}');
    expect([screen.queryByRole('textbox'), document.activeElement]).toEqual([null, screen.getByRole('button', { name: '+ Line' })]);
  });

  it('AdminAddRow_BlurWhenEmpty_RestoresTheLink', async () => {
    const user = userEvent.setup();
    render(
      <>
        <AdminAddRow actions={actions} />
        <button type="button">elsewhere</button>
      </>
    );
    await user.click(screen.getByRole('button', { name: '+ Ingredient' }));
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('AdminAddRow_BlurWithTextTyped_KeepsTheSearchOpen', async () => {
    const user = userEvent.setup();
    render(
      <>
        <AdminAddRow actions={actions} />
        <button type="button">elsewhere</button>
      </>
    );
    await user.click(screen.getByRole('button', { name: '+ Ingredient' }));
    await user.type(screen.getByRole('textbox'), 'egg');
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('AdminAddRow_Controlled_ReportsClosing_AndOpenAtMountDoesNotStealFocus', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState<string | null>('ing');
      return <AdminAddRow actions={actions} open={open} onOpenChange={(id, why) => { onOpenChange(id, why); setOpen(id); }} />;
    }
    render(<Host />);
    const stole = document.activeElement !== document.body;
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect([stole, onOpenChange.mock.calls, screen.queryByRole('textbox')]).toEqual([false, [[null, 'cancel']], null]);
  });

  it('AdminAddRow_Open_FocusesFirstButton_WhenContentHasNoInput', async () => {
    const user = userEvent.setup();
    render(<AdminAddRow actions={[{ id: 'diet', label: 'Diet', content: <div><button type="button">Nut-free</button></div> }]} />);
    await user.click(screen.getByRole('button', { name: '+ Diet' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Nut-free' }));
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '+ Diet' }));
  });
});
