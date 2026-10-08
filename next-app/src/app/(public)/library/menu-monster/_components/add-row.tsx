'use client';

/**
 * The one add pattern per container in Menu Monster (Plans/Menu-Monster-Add-Pattern.md, Decisions 3-5; look:
 * /admin/styleguide/public → Menu Monster planner flow → Add rows).
 *
 *   At rest   a list ends in quiet links — "+ Food  + Gear", "+ Ingredient". Real <button>s, 44px tall.
 *   Opened    the row swaps to that link's content (the caller's search) and a quiet "Cancel" sits at the row's
 *             right end. `trailing` (a "for Everyone ▾" select, say) sits just before Cancel.
 *   Leaving   Cancel and Esc (with nothing typed) close it and hand focus back to the link that opened it; so does
 *             focus leaving the row while the search is empty (no focus theft there: the scout went elsewhere).
 *             Closing is discarding — a typed query is never kept.
 *
 * Uncontrolled by default; pass `open` (an action id, or null for resting) + `onOpenChange` to drive it — the way a
 * "Swap…" from a food's ⋯ menu, or a brand-new empty meal, opens the search. Opening after mount moves focus into the
 * content's first input; a row that starts open (defaultOpen / open at mount) does not steal focus.
 * Tokens only (add-row.module.css).
 */

import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import s from './add-row.module.css';

export interface AddAction {
  id: string;
  /** The verb or noun after the plus: "Food" renders "+ Food". Never the container's name. */
  label: string;
  /** What the row shows while this action is open (a search input, usually). */
  content: ReactNode;
}

/** Why the row asked to change: a tap on a link, Cancel, Esc, or focus leaving it empty (a caller may ignore a blur while its own form is up). */
export type AddRowReason = 'open' | 'cancel' | 'esc' | 'blur';

export function AddRow({
  actions,
  open: controlled,
  defaultOpen = null,
  onOpenChange,
  trailing,
  className
}: {
  actions: readonly AddAction[];
  /** Controlled: the open action's id, or null when resting. Omit for the row to manage itself. */
  open?: string | null;
  defaultOpen?: string | null;
  onOpenChange?: (id: string | null, reason: AddRowReason) => void;
  /** Extra controls on the open row's right side, before Cancel. */
  trailing?: ReactNode;
  className?: string;
}) {
  const [own, setOwn] = useState<string | null>(defaultOpen);
  const open = controlled !== undefined ? controlled : own;
  const rowRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const linkRefs = useRef(new Map<string, HTMLButtonElement>());
  const lastOpened = useRef<string | null>(null);
  /** A tap on a link asked for focus in the content; an open the caller drives (swap, default-open) never moves it. */
  const wantFocus = useRef(false);
  /** The link to hand focus back to once the row has rested (Cancel / Esc). */
  const restore = useRef<string | null>(null);

  const setOpen = (id: string | null, reason: AddRowReason) => {
    if (controlled === undefined) setOwn(id);
    onOpenChange?.(id, reason);
  };

  // Opened after mount: focus goes into the content. Closed by Cancel or Esc: back to the link (below).
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

  const close = (reason: Exclude<AddRowReason, 'open'>) => {
    const returnFocus = reason !== 'blur';
    const id = open ?? lastOpened.current;
    restore.current = returnFocus ? id : null;
    setOpen(null, reason);
  };

  // Esc with nothing typed leaves; with text typed the caller's own Escape (clear the box) comes first.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.value !== '') return;
    close('esc');
  };
  // Focus leaving the row with the search empty closes it; text typed keeps it (the scout may come back).
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (open == null) return;
    const next = e.relatedTarget as Node | null;
    if (next && rowRef.current?.contains(next)) return;
    const input = rowRef.current?.querySelector<HTMLInputElement>('input[type="text"], input:not([type])');
    if (input && input.value !== '') return;
    close('blur');
  };

  const linkFor = (a: AddAction) => (
    <button
      key={a.id}
      type="button"
      className={s.link}
      ref={(el) => {
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
    </button>
  );
  const current = actions.find((a) => a.id === open);
  return (
    <div ref={rowRef} className={`${s.row} ${className ?? ''}`} data-state={current ? 'open' : 'rest'} onKeyDown={current ? onKeyDown : undefined} onBlur={current ? onBlur : undefined}>
      {current ? (
        <>
          <div className={s.openLine}>
            <div ref={contentRef} className={s.content}>{current.content}</div>
            {trailing && <div className={s.trailing}>{trailing}</div>}
            <button type="button" className={s.cancel} onClick={() => close('cancel')}>
              Cancel
            </button>
          </div>
          {/* The other actions sit on their own line BELOW the open content, never beside the search (Patrick, 2026-10-07). */}
          {actions.length > 1 && <div className={s.links}>{actions.filter((a) => a.id !== current.id).map(linkFor)}</div>}
        </>
      ) : (
        <div className={s.links}>
          {actions.map(linkFor)}
        </div>
      )}
    </div>
  );
}
