'use client';

/**
 * My recipes — the hub's Recipe Builder tab for a signed-in scout (Phase 4A):
 * one quiet row per recipe (name → the editor, its state on the right) with a ⋯
 * of Open and, for a never-shared draft, Delete (confirmed inline, as My menus
 * does). The delete action refuses a draft one of the scout's menus still uses.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import type { RecipeStatus } from '@/lib/menu-monster/types';
import { deleteScoutRecipeAction } from '../../../_tools/menu-monster/recipe-actions';
import { RowMenu } from '../../menus/_components/row-menu';
import w from '../../menus/_components/workspace.module.css';
import { RECIPES_HREF } from './recipe-editor';

export interface MyRecipeRow {
  id: string;
  name: string;
  status: RecipeStatus;
  credit: string | null;
}

const stateText = (r: MyRecipeRow) => (r.status === 'retired' ? 'Retired' : r.status === 'published' ? 'Shared' : 'Draft');

export function MyRecipesList({ rows }: { rows: MyRecipeRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function remove(r: MyRecipeRow) {
    setBusy(true);
    const res = await deleteScoutRecipeAction(r.id).catch(() => ({ ok: false as const, error: 'Couldn’t delete the recipe. Try again.' }));
    setBusy(false);
    setPending(null);
    setMessage(res.ok ? `${r.name} deleted.` : res.error);
    if (res.ok) router.refresh();
  }

  return (
    <>
      <ul className={w.card} aria-label="My recipes">
        {rows.length === 0 && <li className={w.empty}>No recipes yet.</li>}
        {rows.map((r) =>
          pending === r.id ? (
            <li key={r.id} className={w.row}>
              <div className={w.confirm}>
                <strong>Delete “{r.name}”?</strong>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove(r)}>
                  Delete
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setPending(null)}>
                  Keep it
                </Button>
              </div>
            </li>
          ) : (
            <li key={r.id} className={w.row}>
              <div className={w.rowMain}>
                <Link className={w.rowName} href={`${RECIPES_HREF}/${r.id}`}>
                  {r.name}
                </Link>
              </div>
              <span className={w.meta}>{stateText(r)}</span>
              <RowMenu
                label={`More for ${r.name}`}
                items={[
                  { label: 'Open', href: `${RECIPES_HREF}/${r.id}` },
                  ...(r.status === 'draft' ? [{ label: 'Delete', danger: true, onSelect: () => setPending(r.id) }] : [])
                ]}
              />
            </li>
          )
        )}
      </ul>
      <p className={w.statusLine} aria-live="polite">
        {message}
      </p>
    </>
  );
}
