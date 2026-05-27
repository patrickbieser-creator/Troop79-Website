'use client';

import styles from './sortable-list.module.css';

/**
 * Reusable ordered-list editor. Renders the current order with Up/Down/Remove
 * buttons per row. Designed to be reused by any editor that needs to pick a
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

  return (
    <div className={styles.wrap}>
      {items.length === 0 ? (
        <div className={styles.empty}>{emptyLabel}</div>
      ) : (
        <ul className={styles.list}>
          {items.map((it, i) => (
            <li key={it.key} className={styles.row}>
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
