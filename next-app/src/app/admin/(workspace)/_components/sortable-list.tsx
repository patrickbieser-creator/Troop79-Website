'use client';

import { useRef, useState } from 'react';
import styles from './sortable-list.module.css';

/**
 * Reusable ordered-list editor. Renders the current order with Up/Down/Remove
 * buttons per row, and rows can be DRAGGED into place (HTML5 drag and drop,
 * added 2026-08-21 for the home page's "Front page order" — the arrows stay
 * for keyboard and touch). Designed to be reused by any editor that needs to pick a
 * subset from a catalog and present it in a sortable order (MB counselors,
 * future patrol assignments, etc.).
 *
 * Pure controlled component — caller owns the array.
 */

export interface SortableItem {
  /** Stable identifier used as React key. */
  key: string;
  /** What renders inline for each row. */
  label: React.ReactNode;
}

interface Props<T extends SortableItem> {
  items: T[];
  onChange: (next: T[]) => void;
  /** Catalog of items not yet picked — appears in the "Add" dropdown. */
  available?: T[];
  /** Optional label for the Add control. Defaults to "Add". */
  addLabel?: string;
  /** Optional placeholder when the picked list is empty. */
  emptyLabel?: string;
}

export function SortableList<T extends SortableItem>({
  items,
  onChange,
  available,
  addLabel = 'Add',
  emptyLabel = 'None yet.'
}: Props<T>) {
  function move(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function add(key: string) {
    const found = available?.find((a) => a.key === key);
    if (!found) return;
    if (items.some((it) => it.key === key)) return;
    onChange([...items, found]);
  }

  // Drag and drop: remember the dragged index in a REF (drag events fire in
  // quick succession and a state write may not have committed by the drop);
  // dropping on a row moves the dragged item to that row's position.
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const setDragFrom = (i: number | null) => {
    dragFrom.current = i;
  };
  function dropAt(to: number) {
    const from = dragFrom.current;
    if (from === null || from === to) {
      setDragFrom(null);
      setDragOver(null);
      return;
    }
    const next = items.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
    setDragFrom(null);
    setDragOver(null);
  }

  return (
    <div className={styles.wrap}>
      {items.length === 0 ? (
        <div className={styles.empty}>{emptyLabel}</div>
      ) : (
        <ul className={styles.list}>
          {items.map((it, i) => (
            <li
              key={it.key}
              className={`${styles.row} ${dragOver === i ? styles.rowDragOver : ''}`}
              draggable
              onDragStart={(e) => {
                setDragFrom(i);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragOver !== i) setDragOver(i);
              }}
              onDragLeave={() => setDragOver((d) => (d === i ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                dropAt(i);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
            >
              <span className={styles.grip} aria-hidden="true" title="Drag to reorder">
                ⋮⋮
              </span>
              <span className={styles.position}>{i + 1}</span>
              <span className={styles.label}>{it.label}</span>
              <div className={styles.controls}>
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Move up"
                  title="Move up"
                >
                  ▲
                </button>
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => move(i, +1)}
                  disabled={i === items.length - 1}
                  aria-label="Move down"
                  title="Move down"
                >
                  ▼
                </button>
                <button
                  type="button"
                  className={`${styles.iconBtn} ${styles.removeBtn}`}
                  onClick={() => remove(i)}
                  aria-label="Remove"
                  title="Remove"
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {available && (
        <AddPicker
          available={available.filter((a) => !items.some((it) => it.key === a.key))}
          onAdd={add}
          addLabel={addLabel}
        />
      )}
    </div>
  );
}

function AddPicker<T extends SortableItem>({
  available,
  onAdd,
  addLabel
}: {
  available: T[];
  onAdd: (key: string) => void;
  addLabel: string;
}) {
  return (
    <div className={styles.addRow}>
      <select
        className={styles.addSelect}
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) {
            onAdd(e.target.value);
            e.target.value = '';
          }
        }}
      >
        <option value="">— {addLabel} —</option>
        {available.map((a) => (
          <option key={a.key} value={a.key}>
            {typeof a.label === 'string' ? a.label : a.key}
          </option>
        ))}
      </select>
    </div>
  );
}
