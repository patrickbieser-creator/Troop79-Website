import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { AddRow } from '../src/app/(public)/library/menu-monster/_components/add-row';

/**
 * AddRow — the one add pattern per container (Plans/Menu-Monster-Add-Pattern.md, Decisions 3-5): quiet links at
 * rest, a tap opens that action's search, and a visible Cancel at the row's right end is always there to leave.
 */

const actions = [
  { id: 'food', label: 'Food', content: <input aria-label="Find a food" /> },
  { id: 'gear', label: 'Gear', content: <input aria-label="Find gear" /> }
];

describe('AddRow', () => {
  it('AddRow_ShowsLinksAtRest_AndNoSearch', () => {
    render(<AddRow actions={actions} />);
    expect([screen.getByRole('button', { name: '+ Food' }) != null, screen.getByRole('button', { name: '+ Gear' }) != null, screen.queryByRole('textbox'), screen.queryByRole('button', { name: 'Cancel' })]).toEqual([true, true, null, null]);
  });

  it('AddRow_TapFood_OpensTheSearch_WithFocusInIt', async () => {
    const user = userEvent.setup();
    render(<AddRow actions={actions} />);
    await user.click(screen.getByRole('button', { name: '+ Food' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Find a food' }));
  });

  it('AddRow_Cancel_RestoresTheLinks_AndFocusesTheLink', async () => {
    const user = userEvent.setup();
    render(<AddRow actions={actions} />);
    await user.click(screen.getByRole('button', { name: '+ Food' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect([screen.queryByRole('textbox'), document.activeElement]).toEqual([null, screen.getByRole('button', { name: '+ Food' })]);
  });

  it('AddRow_Esc_RestoresTheLinks', async () => {
    const user = userEvent.setup();
    render(<AddRow actions={actions} />);
    await user.click(screen.getByRole('button', { name: '+ Gear' }));
    await user.keyboard('{Escape}');
    expect([screen.queryByRole('textbox'), document.activeElement]).toEqual([null, screen.getByRole('button', { name: '+ Gear' })]);
  });

  it('AddRow_BlurWhenEmpty_RestoresTheLinks', async () => {
    const user = userEvent.setup();
    render(
      <>
        <AddRow actions={actions} />
        <button type="button">elsewhere</button>
      </>
    );
    await user.click(screen.getByRole('button', { name: '+ Food' }));
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('AddRow_BlurWithTextTyped_KeepsTheSearchOpen', async () => {
    const user = userEvent.setup();
    render(
      <>
        <AddRow actions={actions} />
        <button type="button">elsewhere</button>
      </>
    );
    await user.click(screen.getByRole('button', { name: '+ Food' }));
    await user.type(screen.getByRole('textbox'), 'pan');
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('AddRow_Open_StillShowsTheOtherLinks_SoOneTapSwitches', async () => {
    const user = userEvent.setup();
    render(<AddRow actions={actions} />);
    await user.click(screen.getByRole('button', { name: '+ Food' }));
    await user.click(screen.getByRole('button', { name: '+ Gear' }));
    expect([screen.queryByRole('textbox', { name: 'Find a food' }), document.activeElement]).toEqual([null, screen.getByRole('textbox', { name: 'Find gear' })]);
  });

  it('AddRow_OpenedByTheCaller_DoesNotMoveFocus', () => {
    const { rerender } = render(<AddRow actions={actions} open={null} />);
    rerender(<AddRow actions={actions} open="food" />);
    expect(document.activeElement).toBe(document.body);
  });

  it('AddRow_Open_ShowsTheCallersExtraControl_BeforeCancel', async () => {
    const user = userEvent.setup();
    render(<AddRow actions={actions} trailing={<select aria-label="for"><option>Everyone</option></select>} />);
    await user.click(screen.getByRole('button', { name: '+ Food' }));
    const order = [screen.getByRole('combobox', { name: 'for' }), screen.getByRole('button', { name: 'Cancel' })];
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('AddRow_Controlled_OpensWhenTheCallerSaysSo_AndReportsClosing', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState<string | null>('food');
      return <AddRow actions={actions} open={open} onOpenChange={(id) => { onOpenChange(id); setOpen(id); }} />;
    }
    render(<Host />);
    expect(screen.getByRole('textbox', { name: 'Find a food' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect([onOpenChange.mock.calls, screen.queryByRole('textbox')]).toEqual([[[null]], null]);
  });

  it('AddRow_OpenAtMount_DoesNotStealFocus', () => {
    render(<AddRow actions={actions} defaultOpen="food" />);
    expect(document.activeElement).toBe(document.body);
  });

  it('AddRow_Open_FocusesFirstButton_WhenContentHasNoInput', async () => {
    const user = userEvent.setup();
    render(<AddRow actions={[{ id: 'diet', label: 'Diet', content: <div><button type="button">Nut-free</button></div> }]} />);
    await user.click(screen.getByRole('button', { name: '+ Diet' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Nut-free' }));
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '+ Diet' }));
  });
});
