'use client';

/**
 * Calendar Categories editor (D-082).
 *
 * Not a NameLookupEditor: a category carries a color and a display position,
 * and its name is a foreign key rather than a label on an id. Renaming here
 * rewrites every calendar entry and photo album that used the old name (one
 * cascading UPDATE in Postgres) — which is exactly why the rename is offered
 * as a normal edit and the delete is not: a category still in use, or one
 * carrying a behavior flag, comes back refused with a reason.
 */

import { useState, useTransition } from 'react';
import {
  CATEGORY_TEMPLATES,
  FALLBACK_CATEGORY_TEMPLATE,
  TEMPLATE_LABELS,
  type CalendarCategoryRow,
  type CategoryTemplate
} from '@/lib/calendar-categories';
import { useLookupTable } from './use-lookup-table';
import styles from './lookups.module.css';
import { AddButton } from '../../_components/add-button';

type ActionResult = { ok: boolean; error?: string };

interface Props {
  rows: CalendarCategoryRow[];
  onCreate: (fd: FormData) => Promise<ActionResult>;
  onUpdate: (fd: FormData) => Promise<ActionResult>;
  onDelete: (fd: FormData) => Promise<ActionResult>;
}

const NEW_COLOR = '#4c5c6a';
/** New categories land after the current last one, in tens like the seed. */
function nextSortOrder(rows: CalendarCategoryRow[]): number {
  return rows.reduce((max, r) => Math.max(max, r.sort_order), 0) + 10;
}

function behaviorNote(behavior: CalendarCategoryRow['behavior']): string | null {
  if (behavior === 'meeting') return 'the weekly troop meeting';
  if (behavior === 'no_meeting') return 'a cancelled meeting week';
  return null;
}

export function CategoriesEditor({ rows, onCreate, onUpdate, onDelete }: Props) {
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState(NEW_COLOR);
  const [newTemplate, setNewTemplate] = useState<CategoryTemplate>(FALLBACK_CATEGORY_TEMPLATE);
  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editColor, setEditColor] = useState(NEW_COLOR);
  const [editSort, setEditSort] = useState('0');
  const [editTemplate, setEditTemplate] = useState<CategoryTemplate>(FALLBACK_CATEGORY_TEMPLATE);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const t = useLookupTable(rows, (r) => r.label, { alwaysSearch: true });

  function add() {
    const label = newLabel.trim();
    if (!label) return;
    setErr(null);
    const fd = new FormData();
    fd.set('label', label);
    fd.set('color', newColor);
    fd.set('sort_order', String(nextSortOrder(rows)));
    fd.set('template', newTemplate);
    startTransition(async () => {
      const res = await onCreate(fd);
      if (!res.ok) {
        setErr(res.error ?? 'Add failed');
        return;
      }
      setNewLabel('');
      setNewColor(NEW_COLOR);
      setNewTemplate(FALLBACK_CATEGORY_TEMPLATE);
      setAdding(false);
    });
  }

  function beginEdit(row: CalendarCategoryRow) {
    setErr(null);
    setEditing(row.label);
    setEditLabel(row.label);
    setEditColor(row.color);
    setEditSort(String(row.sort_order));
    setEditTemplate(row.template ?? FALLBACK_CATEGORY_TEMPLATE);
  }

  function saveEdit(original: string) {
    const label = editLabel.trim();
    if (!label) return;
    setErr(null);
    const fd = new FormData();
    fd.set('original_label', original);
    fd.set('label', label);
    fd.set('color', editColor);
    fd.set('sort_order', editSort);
    fd.set('template', editTemplate);
    startTransition(async () => {
      const res = await onUpdate(fd);
      if (!res.ok) {
        setErr(res.error ?? 'Save failed');
        return;
      }
      setEditing(null);
    });
  }

  function remove(row: CalendarCategoryRow) {
    if (
      !window.confirm(
        `Delete the category "${row.label}"?\n\nOnly possible if no event or photo album still uses it.`
      )
    ) {
      return;
    }
    setErr(null);
    const fd = new FormData();
    fd.set('label', row.label);
    startTransition(async () => {
      const res = await onDelete(fd);
      if (!res.ok) setErr(res.error ?? 'Delete failed');
    });
  }

  return (
    <>
      <div className={styles.cardToolbar}>
        {t.searchEl}
        <AddButton onClick={() => setAdding(true)}>+ Add Category</AddButton>
      </div>

      {adding && (
        <div className={styles.addPanel}>
          <input
            type="text"
            className={styles.editInput}
            style={{ maxWidth: 260 }}
            placeholder="New category name"
            value={newLabel}
            autoFocus
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setAdding(false);
              }
            }}
          />
          <input
            type="color"
            className={styles.editInput}
            style={{ maxWidth: 64, padding: 2 }}
            aria-label="Category color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
          />
          <select
            className={styles.editInput}
            style={{ maxWidth: 210 }}
            aria-label="Entry template"
            value={newTemplate}
            onChange={(e) => setNewTemplate(e.target.value as CategoryTemplate)}
          >
            {CATEGORY_TEMPLATES.map((t) => (
              <option key={t} value={t}>
                {TEMPLATE_LABELS[t]}
              </option>
            ))}
          </select>
          <div className={styles.addPanelActions}>
            <button
              type="button"
              className={styles.editBtn}
              onClick={() => setAdding(false)}
              disabled={isPending}
            >
              Cancel
            </button>
            <AddButton onClick={add} disabled={isPending || !newLabel.trim()}>
              Add Category
            </AddButton>
          </div>
        </div>
      )}

      {err && (
        <div className={styles.editError} style={{ marginBottom: 10 }}>
          {err}
        </div>
      )}

      <div className={t.scrollClass}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Category</th>
              <th style={{ width: 170 }}>Template</th>
              <th style={{ width: 70 }}>Order</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((row) => {
              const note = behaviorNote(row.behavior);
              return editing === row.label ? (
                <tr key={row.label}>
                  <td>
                    <input
                      type="text"
                      className={styles.editInput}
                      style={{ maxWidth: 220 }}
                      value={editLabel}
                      autoFocus
                      onChange={(e) => setEditLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          saveEdit(row.label);
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setEditing(null);
                        }
                      }}
                    />
                    <input
                      type="color"
                      className={styles.editInput}
                      style={{ maxWidth: 64, padding: 2, marginLeft: 6 }}
                      aria-label={`Color for ${row.label}`}
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                    />
                  </td>
                  <td>
                    <select
                      className={styles.editInput}
                      style={{ maxWidth: 165 }}
                      aria-label={`Entry template for ${row.label}`}
                      value={editTemplate}
                      onChange={(e) => setEditTemplate(e.target.value as CategoryTemplate)}
                    >
                      {CATEGORY_TEMPLATES.map((t) => (
                        <option key={t} value={t}>
                          {TEMPLATE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      className={styles.editInput}
                      style={{ maxWidth: 64 }}
                      aria-label={`Display order for ${row.label}`}
                      value={editSort}
                      onChange={(e) => setEditSort(e.target.value)}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className={styles.editBtn}
                      onClick={() => setEditing(null)}
                      disabled={isPending}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.editSaveBtn}
                      onClick={() => saveEdit(row.label)}
                      disabled={isPending || !editLabel.trim()}
                      style={{ marginLeft: 6 }}
                    >
                      Save
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={row.label}>
                  <td>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: row.color,
                        marginRight: 8
                      }}
                      aria-hidden="true"
                    />
                    {row.label}
                    {note && <span className={styles.muted}> · {note}</span>}
                  </td>
                  <td className={styles.muted}>
                    {TEMPLATE_LABELS[row.template ?? FALLBACK_CATEGORY_TEMPLATE]}
                  </td>
                  <td className={styles.muted}>{row.sort_order}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className={styles.editBtn}
                      onClick={() => beginEdit(row)}
                      disabled={isPending}
                    >
                      Edit
                    </button>
                    {/* A behavior-carrying category is undeletable by the DB —
                        don't offer a button that can only ever fail. */}
                    {row.behavior === null && (
                      <button
                        type="button"
                        className={`${styles.editBtn} ${styles.dangerBtn}`}
                        onClick={() => remove(row)}
                        disabled={isPending}
                        style={{ marginLeft: 6 }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {t.footerEl}
    </>
  );
}
