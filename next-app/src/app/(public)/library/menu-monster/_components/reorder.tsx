'use client';

/**
 * Reordering for the recipe editor's lists (ingredients and steps), as the
 * approved recipe-editor.html does it: a grip button you can drag, or focus and
 * move with the up / down arrow keys; the ⋯ menu's Move up / Move down are the
 * other keyboard way. `useDragReorder` wires the drag onto each <li>; the grip
 * starts it. One list drags at a time; a drop moves the dragged item to the
 * drop target's place.
 */

import { useState, type DragEvent, type KeyboardEvent } from 'react';
import s from './ingredient-list.module.css';

export function useDragReorder(onMoveTo: (from: number, to: number) => void) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const itemProps = (index: number) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (dragging == null) return;
      e.preventDefault();
      if (over !== index) setOver(index);
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      if (dragging != null && dragging !== index) onMoveTo(dragging, index);
      setDragging(null);
      setOver(null);
    },
    'data-drop-target': over === index && dragging !== index ? true : undefined
  });
  const gripProps = (index: number) => ({
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
      setDragging(index);
    },
    onDragEnd: () => {
      setDragging(null);
      setOver(null);
    }
  });
  return { itemProps, gripProps };
}

/** The ⠿ grip: drag it, or press the up / down arrow keys while it has focus. */
export function Grip({ label, onMove, dragProps }: { label: string; onMove: (by: -1 | 1) => void; dragProps: ReturnType<ReturnType<typeof useDragReorder>['gripProps']> }) {
  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      onMove(e.key === 'ArrowUp' ? -1 : 1);
    }
  }
  return (
    <button type="button" className={s.grip} aria-label={`Reorder ${label}: drag, or use the up and down arrow keys`} onKeyDown={onKey} {...dragProps}>
      <span aria-hidden="true">⠿</span>
    </button>
  );
}
