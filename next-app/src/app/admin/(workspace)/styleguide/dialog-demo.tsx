'use client';

/**
 * Live demo for the APPROVED dialog spec on /admin/styleguide (proposed and
 * approved by Patrick 2026-08-21 — see styleguide.module.css). The one
 * interactive piece of an otherwise static page: the navy-tinted blurred
 * backdrop and the @starting-style entry motion only exist on a real open
 * <dialog>, so a static specimen can't show them.
 */
import { useRef } from 'react';
import sg from './styleguide.module.css';

export function DialogDemo() {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className={sg.demoBtn} onClick={() => ref.current?.showModal()}>
        Open live demo →
      </button>
      <dialog ref={ref} className={sg.dialogSpec}>
        <div className={sg.dialogSpecHeader}>
          <h3 className={sg.dialogSpecTitle}>Edit calendar entry</h3>
          <p className={sg.dialogSpecSub}>Changes apply immediately when saved.</p>
        </div>
        <div className={sg.dialogSpecBody}>
          The entry motion you just saw, the navy-tinted backdrop, and the blur behind this box
          are the parts of the spec a static specimen can&rsquo;t show. Press Esc or either
          button to close.
        </div>
        <div className={sg.dialogSpecActions}>
          <button type="button" className={sg.ghostBtn} onClick={() => ref.current?.close()}>
            Cancel
          </button>
          <button type="button" className={sg.demoBtn} onClick={() => ref.current?.close()}>
            Save
          </button>
        </div>
      </dialog>
    </>
  );
}
