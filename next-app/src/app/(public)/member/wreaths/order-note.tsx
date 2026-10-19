'use client';

/**
 * The troop-only order note on Members › Wreath sale (Plans/Wreath-Sale.md W-1): one note the family and the treasurer
 * share, last edit wins ("Edited by Dan V · Oct 19"). Never shown to the customer. At rest it is the note and its stamp
 * plus one quiet control ("+ Note" / "Edit note"); opened, it is an inline row editor: Save is greyed until the text
 * differs from what is saved, and Cancel is discard. Read-only (no control) for the superuser proxy. The server action
 * re-checks who may write; hiding the control here is only courtesy.
 */

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { Field, TextArea } from '@/app/_components/form';
import { ORDER_NOTE_MAX, noteStamp } from '@/lib/wreaths/order-note';
import type { MyOrder } from '@/lib/wreaths/my-orders';
import { setOrderNoteAction } from './actions';
import styles from './wreaths.module.css';

export function OrderNote({ order: o, canEdit }: { order: Pick<MyOrder, 'id' | 'orderNumber' | 'orderNote' | 'orderNoteBy' | 'orderNoteAt'>; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(o.orderNote);
  const [draft, setDraft] = useState(o.orderNote);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const dirty = draft.trim() !== saved.trim();

  function open() {
    setSaved(o.orderNote);
    setDraft(o.orderNote);
    setProblem(null);
    setEditing(true);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('textarea')?.focus());
  }
  function close() {
    setEditing(false);
    setProblem(null);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[data-note-edit]')?.focus());
  }
  function save(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    start(async () => {
      const res = await setOrderNoteAction(o.id, draft);
      if (res.ok) {
        setSaved(draft.trim());
        router.refresh();
        close();
      } else setProblem(res.error);
    });
  }

  if (!editing) {
    if (!o.orderNote && !canEdit) return null;
    return (
      <div ref={root} className={styles.note}>
        {o.orderNote && (
          <>
            <p className={styles.noteText}>
              <span className={styles.noteLabel}>Troop note:</span> {o.orderNote}
            </p>
            <p className={styles.orderMeta}>{noteStamp(o.orderNoteBy, o.orderNoteAt)}</p>
          </>
        )}
        {canEdit && (
          <Button variant="ghost" data-note-edit aria-label={`${o.orderNote ? 'Edit the troop note on' : 'Add a troop note to'} order ${o.orderNumber}`} onClick={open}>
            {o.orderNote ? 'Edit note' : '+ Note'}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div ref={root} className={styles.note}>
      <form onSubmit={save} noValidate aria-label={`Troop note on order ${o.orderNumber}`} className={styles.editForm}>
        <Field label="Troop note" hint="Only your family and the troop see this, never the customer." problem={problem}>
          <TextArea autoComplete="off" maxLength={ORDER_NOTE_MAX} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </Field>
        <div className={styles.editFoot}>
          <Button type="submit" disabled={!dirty || pending} title={dirty ? undefined : 'No changes to save yet'}>
            {pending ? 'Saving changes…' : dirty ? 'Save changes' : 'Saved'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
