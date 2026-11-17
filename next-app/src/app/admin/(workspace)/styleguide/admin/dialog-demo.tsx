'use client';

/**
 * Live demo for the shared Dialog component on /admin/styleguide/admin (the spec
 * was approved by Patrick 2026-08-21 and shipped as _components/dialog the
 * same day). The one interactive piece of an otherwise static page: the
 * navy-tinted blurred backdrop and the @starting-style entry motion only
 * exist on a real open <dialog>, so a static specimen can't show them.
 */
import { useRef, useState } from 'react';
import sg from './styleguide.module.css';
import { Dialog, DialogHeader, DialogBody, DialogActions } from '../../_components/dialog';
import { AdminDrawer } from '../../_components/admin-drawer';

export function DialogDemo() {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className={sg.demoBtn} onClick={() => ref.current?.showModal()}>
        Open live demo →
      </button>
      <Dialog ref={ref}>
        <DialogHeader title="Edit calendar entry" sub="Changes apply immediately when saved." />
        <DialogBody>
          The entry motion you just saw, the navy-tinted backdrop, and the blur behind this box
          are the parts of the spec a static specimen can&rsquo;t show. Press Esc, click the
          backdrop, or use either button to close.
        </DialogBody>
        <DialogActions>
          <button type="button" className={sg.ghostBtn} onClick={() => ref.current?.close()}>
            Cancel
          </button>
          <button type="button" className={sg.demoBtn} onClick={() => ref.current?.close()}>
            Save
          </button>
        </DialogActions>
      </Dialog>
    </>
  );
}

/**
 * Live demo for AdminDrawer (2026-11-15, Health Forms): a right-side sheet over a full-width list, or with `wide` a
 * centred 860px dialog with two panes and a footer (the health record sheet, 2026-11-16). Behaviour is
 * lib/use-drawer-dialog, shared with the public Drawer; the component is markup and admin tokens only.
 */
export function AdminDrawerDemo({ wide = false }: { wide?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={sg.demoBtn} onClick={() => setOpen(true)}>
        {wide ? 'Open wide drawer demo →' : 'Open drawer demo →'}
      </button>
      {open && (
        <AdminDrawer
          wide={wide}
          title="Ben Adams"
          sub="Scout · Last upload Nov 2, 2026"
          onClose={() => setOpen(false)}
          footer={
            wide ? (
              <>
                <span>Not reviewed · Viewing is logged.</span>
                <button type="button" className={sg.ghostBtn} onClick={() => setOpen(false)}>
                  Close
                </button>
              </>
            ) : undefined
          }
        >
          {wide
            ? 'A centred 860px dialog for a record that needs two panes; the full screen below 768px. Header and footer stay put, only the body scrolls.'
            : 'The list behind stays mounted, so ticks and scroll survive. 480px wide, the full screen below 768px.'}{' '}
          Esc, ✕ or a click on the dimmed page closes it, and focus returns to the button that opened it.
        </AdminDrawer>
      )}
    </>
  );
}
