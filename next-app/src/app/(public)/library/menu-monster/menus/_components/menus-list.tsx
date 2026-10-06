'use client';

/**
 * My menus — the scout's rows: name, where they're cooking, the outing if one
 * is linked, and the per-person-per-meal cost in a fixed right column (just the
 * dollar amount). ⋯ opens Open / Duplicate / Delete; Delete asks inline, right
 * under the row, instead of a dialog.
 *
 * `readOnly` (a leader's list of every scout's menus): the same rows with the
 * scout's credit name and the last-edited date in the meta line, no ⋯ menu and
 * so no Duplicate / Delete.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { EmptyState } from '@/app/_components/empty-state';
import { Notice } from '@/app/_components/notice';
import { fmtDate } from '@/lib/format-date';
import { priceText as money } from '@/lib/menu-monster/units';
import { deleteMenuAction, duplicateMenuAction } from '../../../_tools/menu-monster/menu-actions';
import { RowMenu } from './row-menu';
import s from './workspace.module.css';

export interface MenuRowData {
  id: string;
  name: string;
  /** "Camp", "Home"… */
  contextLabel: string;
  outingName: string | null;
  mealCount: number;
  /** Per person, per meal; null when no meal has items yet. */
  perPersonMeal: number | null;
  /** When it was last edited (ISO timestamp); shown to a leader. */
  updatedAt?: string;
  /** The owner's credit name ("Sam K."); shown to a leader. */
  ownerName?: string | null;
  /** Shared with the troop (Phase 3). */
  shared?: boolean;
}

export function MenusList({
  rows,
  readOnly = false,
  showOwner = readOnly,
  emptyText
}: {
  rows: MenuRowData[];
  readOnly?: boolean;
  /** Say whose each menu is and when it was edited: any list that is not the viewer's own. */
  showOwner?: boolean;
  emptyText?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = rows.filter((r) => !gone.has(r.id));

  async function duplicate(id: string) {
    setError(null);
    const res = await duplicateMenuAction(id);
    if (!res.ok) return setError(res.error);
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    const res = await deleteMenuAction(id);
    setBusy(false);
    setConfirming(null);
    if (!res.ok) return setError(res.error);
    setGone((g) => new Set(g).add(id));
    router.refresh();
  }

  if (shown.length === 0) {
    return <EmptyState>{emptyText ?? 'No menus yet. Start one with New menu, and it saves here.'}</EmptyState>;
  }

  return (
    <>
      {error && (
        <Notice tone="error" className={s.notice}>
          {error}
        </Notice>
      )}
      <ul className={s.card}>
        {shown.map((r) => (
          <li key={r.id} className={s.row}>
            <div className={s.rowMain}>
              {/* A menu opens on its first step, Who's eating (Patrick, 2026-10-06); a read-only list opens the meals. */}
              <Link className={s.rowName} href={`/library/menu-monster/menus/${r.id}${readOnly ? '' : '/people'}`}>
                {r.name}
              </Link>
              <span className={s.meta}>
                {[
                  showOwner ? r.ownerName : null,
                  r.contextLabel,
                  r.outingName,
                  `${r.mealCount} ${r.mealCount === 1 ? 'meal' : 'meals'}`,
                  r.shared ? 'Shared' : null,
                  showOwner && r.updatedAt ? `edited ${fmtDate(r.updatedAt)}` : null
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <div className={s.cost}>{r.perPersonMeal != null ? money(r.perPersonMeal) : ''}</div>
            {!readOnly && (
              <RowMenu
                label={`More for ${r.name}`}
                items={[
                  { label: 'Open', href: `/library/menu-monster/menus/${r.id}` },
                  { label: 'Duplicate', onSelect: () => void duplicate(r.id) },
                  { label: 'Delete', danger: true, onSelect: () => setConfirming(r.id) }
                ]}
              />
            )}
            {!readOnly && confirming === r.id && (
              <div className={s.confirm} role="group" aria-label={`Delete ${r.name}`}>
                <span>
                  Delete “{r.name}”{showOwner && r.ownerName ? `, ${r.ownerName}’s menu` : ''}? This can’t be undone.
                </span>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove(r.id)}>
                  Delete menu
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setConfirming(null)}>
                  Keep it
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
