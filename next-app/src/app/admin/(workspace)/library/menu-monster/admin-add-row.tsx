'use client';

/**
 * The admin twin of the scout planner's AddRow (Plans/Menu-Monster-Add-Pattern.md, Phase 2). Admin never imports the
 * public component or its tokens (the firewall), so this is the same pattern on --admin-* tokens:
 *
 *   At rest   a list ends in a quiet link — "+ Ingredient". A real <button>.
 *   Opened    the row swaps to that link's content (the caller's search) and a quiet "Cancel" sits at its right end.
 *   Leaving   Cancel and Esc (nothing typed) close it and hand focus back to the link; so does focus leaving the row
 *             while the search is empty. Closing is discarding — a typed query is never kept.
 *
 * Uncontrolled by default; pass `open` (an action id, or null) + `onOpenChange` to drive it — the way picking a
 * result closes the row. Opening by a tap moves focus into the content's first input; a row that starts open
 * (defaultOpen / open at mount) does not steal focus. Specimen: /admin/styleguide/admin -> Add row.
 */

import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '../../../_components/button';
import s from './admin-add-row.module.css';

export interface AdminAddAction {
  id: string;
  /** The verb or noun after the plus: "Ingredient" renders "+ Ingredient". Never the container's name. */
  label: string;
  /** What the row shows while this action is open (a search, usually). */
  content: ReactNode;
}

/** Why the row asked to change: a tap on a link, Cancel, Esc, or focus leaving it empty. */
export type AdminAddRowReason = 'open' | 'cancel' | 'esc' | 'blur';

export function AdminAddRow({
  actions,
  open: controlled,
  defaultOpen = null,
  onOpenChange,
  className
}: {
  actions: readonly AdminAddAction[];
  /** Controlled: the open action's id, or null when resting. Omit for the row to manage itself. */
  open?: string | null;
  defaultOpen?: string | null;
  onOpenChange?: (id: string | null, reason: AdminAddRowReason) => void;
  className?: string;
}) {
  const [own, setOwn] = useState<string | null>(defaultOpen);
  const open = controlled !== undefined ? controlled : own;
  const rowRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const linkRefs = useRef(new Map<string, HTMLButtonElement>());
  const lastOpened = useRef<string | null>(null);
  /** A tap on a link asked for focus in the content. */
  const wantFocus = useRef(false);
  /** The link to hand focus back to once the row has rested (Cancel / Esc). */
  const restore = useRef<string | null>(null);

  const setOpen = (id: string | null, reason: AdminAddRowReason) => {
    if (controlled === undefined) setOwn(id);
    onOpenChange?.(id, reason);
  };

  useEffect(() => {
    if (open != null && wantFocus.current) {
      wantFocus.current = false;
      // The content's first field or button (a diet list is only buttons); never Cancel or the other links.
      contentRef.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    }
    if (open == null && restore.current) {
      const id = restore.current;
      restore.current = null;
      linkRefs.current.get(id)?.focus();
    }
  }, [open]);

  const close = (reason: Exclude<AdminAddRowReason, 'open'>) => {
    restore.current = reason !== 'blur' ? (open ?? lastOpened.current) : null;
    setOpen(null, reason);
  };

  // Esc with nothing typed leaves; with text typed the field's own Escape (restore the pick) comes first.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.value !== '') return;
    close('esc');
  };
  // Focus leaving the row with the search empty closes it; text typed keeps it (the leader may come back).
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (open == null) return;
    const next = e.relatedTarget as Node | null;
    if (next && rowRef.current?.contains(next)) return;
    const input = rowRef.current?.querySelector<HTMLInputElement>('input[type="text"], input:not([type])');
    if (input && input.value !== '') return;
    close('blur');
  };

  const current = actions.find((a) => a.id === open);
  const link = (a: AdminAddAction) => (
    <Button
      key={a.id}
      variant="quiet"
      size="sm"
      ref={(el: HTMLButtonElement | null) => {
        if (el) linkRefs.current.set(a.id, el);
        else linkRefs.current.delete(a.id);
      }}
      onClick={() => {
        lastOpened.current = a.id;
        wantFocus.current = true;
        setOpen(a.id, 'open');
      }}
    >
      + {a.label}
    </Button>
  );
  return (
    <div ref={rowRef} className={`${s.row} ${className ?? ''}`} data-state={current ? 'open' : 'rest'} onKeyDown={current ? onKeyDown : undefined} onBlur={current ? onBlur : undefined}>
      {current ? (
        <>
          <div ref={contentRef} className={s.content}>{current.content}</div>
          <Button variant="quiet" size="sm" className={s.cancel} onClick={() => close('cancel')}>
            Cancel
          </Button>
        </>
      ) : (
        actions.map(link)
      )}
    </div>
  );
}
