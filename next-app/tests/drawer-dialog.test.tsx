import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { Drawer } from '../src/app/_components/drawer';
import { AdminDrawer } from '../src/app/admin/(workspace)/_components/admin-drawer';

/**
 * One drawer behaviour, two skins (Plans/Admin-Health-Forms.md, Reuse → New): lib/use-drawer-dialog owns showModal,
 * focus return, scroll lock and the backdrop/Esc close; the public Drawer and the AdminDrawer only differ in markup
 * and tokens (the admin↔public firewall forbids sharing the component itself).
 */

afterEach(cleanup);

function Harness({ kind }: { kind: 'public' | 'admin' }) {
  const [open, setOpen] = useState(false);
  const D = kind === 'public' ? Drawer : AdminDrawer;
  return (
    <>
      <button onClick={() => setOpen(true)}>Open it</button>
      {open && (
        <D title="Ben Adams" onClose={() => setOpen(false)}>
          <p>Body</p>
        </D>
      )}
    </>
  );
}

describe.each(['public', 'admin'] as const)('%s drawer', (kind) => {
  it('Drawer_LocksPageScroll_WhileOpen', () => {
    render(<Harness kind={kind} />);
    fireEvent.click(screen.getByText('Open it'));
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('Drawer_ReturnsFocusToItsOpener_AndUnlocksScroll_WhenClosed', () => {
    render(<Harness kind={kind} />);
    const opener = screen.getByText('Open it');
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect([document.activeElement === opener, document.body.style.overflow]).toEqual([true, '']);
  });

  it('Drawer_IsLabelledByItsTitle', () => {
    render(<Harness kind={kind} />);
    fireEvent.click(screen.getByText('Open it'));
    expect(screen.getByRole('dialog', { hidden: true, name: 'Ben Adams' })).toBeTruthy();
  });
});
