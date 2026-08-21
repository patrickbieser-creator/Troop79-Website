'use client';

/**
 * Live demo for the shared Dialog component on /admin/styleguide/admin (the spec
 * was approved by Patrick 2026-08-21 and shipped as _components/dialog the
 * same day). The one interactive piece of an otherwise static page: the
 * navy-tinted blurred backdrop and the @starting-style entry motion only
 * exist on a real open <dialog>, so a static specimen can't show them.
 */
import { useRef } from 'react';
import sg from './styleguide.module.css';
import { Dialog, DialogHeader, DialogBody, DialogActions } from '../../_components/dialog';

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
