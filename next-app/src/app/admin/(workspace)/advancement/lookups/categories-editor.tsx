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
import { SaveButton, SaveFeedback, useSavePhase } from '../../_components/save-state';
import { Button } from '../../../_components/button';
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
import { Notice } from '../../_components/notice';

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
  const feedback = useSavePhase();
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
    feedback.start();
    startTransition(async () => {
      const res = await onUpdate(fd);
      if (!res.ok) {
        feedback.fail();
        setErr(res.error ?? 'Save failed');
        return;
      }
      setEditing(null);
      feedback.done();
    });
  }

  /** Save standard (2026-08-24): the inline row's draft vs the row itself. */
  function editDirty(row: CalendarCategoryRow): boolean {
    return (
      editLabel !== row.label ||
      editColor !== row.color ||
      editSort !== String(row.sort_order) ||
      editTemplate !== (row.template ?? FALLBACK_CATEGORY_TEMPLATE)
    );
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
      <SaveFeedback phase={feedback.phase} />
      <div className={styles.cardToolbar}>
        {t.searchEl}
        <AddButton onClick={() => setAdding(true)}>+ Add Category</AddButton>
      </div>

      {adding && (
        <div className={styles.addPanel}>
          <input
            type="text"
            className={`${styles.editInput} ${styles.inputMax260}`}
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
            className={`${styles.editInput} ${styles.inputMax64} ${styles.inputPad2}`}
            aria-label="Category color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
          />
          <select
            className={`${styles.editInput} ${styles.inputMax210}`}
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
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAdding(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <AddButton onClick={add} disabled={isPending || !newLabel.trim()}>
              Add Category
            </AddButton>
          </div>
        </div>
      )}

      {err && <Notice>{err}</Notice>}

      <div className={t.scrollClass}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Category</th>
              <th className={styles.colTemplate}>Template</th>
              <th className={styles.colOrder}>Order</th>
              <th className={styles.cellRight}>Actions</th>
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
                      className={`${styles.editInput} ${styles.inputMax220}`}
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
                      className={`${styles.editInput} ${styles.inputMax64} ${styles.inputPad2} ${styles.gapLeft}`}
                      aria-label={`Color for ${row.label}`}
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                    />
                  </td>
                  <td>
                    <select
                      className={`${styles.editInput} ${styles.inputMax165}`}
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
                      className={`${styles.editInput} ${styles.inputMax64}`}
                      aria-label={`Display order for ${row.label}`}
                      value={editSort}
                      onChange={(e) => setEditSort(e.target.value)}
                    />
                  </td>
                  <td className={styles.cellRight}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditing(null)}
                      disabled={isPending}
                    >
                      Cancel
                    </Button>
                    <SaveButton
                      className={styles.gapLeft}
                      dirty={editDirty(row)}
                      pending={isPending}
                      blocked={!editLabel.trim()}
                      blockedReason="A label is required"
                      onClick={() => saveEdit(row.label)}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={row.label}>
                  <td>
                    <span
                      className={styles.colorSwatch}
                      style={{ background: row.color } /* inline: dynamic — per-category color */}
                      aria-hidden="true"
                    />
                    {row.label}
                    {note && <span className={styles.muted}> · {note}</span>}
                  </td>
                  <td className={styles.muted}>
                    {TEMPLATE_LABELS[row.template ?? FALLBACK_CATEGORY_TEMPLATE]}
                  </td>
                  <td className={styles.muted}>{row.sort_order}</td>
                  <td className={styles.cellRight}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => beginEdit(row)}
                      disabled={isPending}
                    >
                      Edit
                    </Button>
                    {/* A behavior-carrying category is undeletable by the DB —
                        don't offer a button that can only ever fail. */}
                    {row.behavior === null && (
                      <Button
                        variant="danger"
                        size="sm"
                        className={styles.gapLeft}
                        onClick={() => remove(row)}
                        disabled={isPending}
                      >
                        Delete
                      </Button>
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
