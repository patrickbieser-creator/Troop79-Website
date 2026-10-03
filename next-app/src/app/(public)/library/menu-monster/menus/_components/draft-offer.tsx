'use client';

/**
 * The hub's quiet row for a signed-in scout: "Unsaved menu on this computer —
 * Save it to My menus". The unsaved menu is the local menu (a visitor's menu
 * kept in this browser, or an old planner draft folded into it). Save sends it
 * through createMenuAction (which re-sanitizes server-side) and clears the local
 * menu ONLY after that succeeds, so a failed save loses nothing. Discard asks
 * once before it clears. Storage can be blocked; then there is no offer. A
 * change in another tab (the `storage` event) refreshes the row.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Catalog } from '@/lib/menu-monster/types';
import type { Menu } from '@/lib/menu-monster/menus';
import { clearLocalMenu, onLocalMenuChange, readLocalMenu } from '@/lib/menu-monster/local-menu';
import { createMenuAction } from '../../../_tools/menu-monster/menu-actions';
import s from './workspace.module.css';

const MENUS_HREF = '/library/menu-monster/menus';

export function DraftOffer({ catalog }: { catalog: Catalog }) {
  const router = useRouter();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => setMenu(readLocalMenu(catalog).menu);
    load();
    return onLocalMenuChange(load);
  }, [catalog]);

  if (!menu) return null;

  async function save(m: Menu) {
    setBusy(true);
    setError(null);
    let res: Awaited<ReturnType<typeof createMenuAction>>;
    try {
      res = await createMenuAction(m);
    } catch {
      res = { ok: false, error: 'Something went wrong saving your menu. Try again.' };
    }
    if (!res.ok) {
      setBusy(false);
      return setError(res.error);
    }
    clearLocalMenu();
    router.push(`${MENUS_HREF}/${res.id}`);
  }

  function discard() {
    clearLocalMenu();
    setMenu(null);
  }

  const meals = menu.meals.length;
  return (
    <p className={s.foot} role="status">
      Unsaved menu on this computer: <strong>{menu.name || 'Untitled menu'}</strong>
      {meals > 0 ? `, ${meals} ${meals === 1 ? 'meal' : 'meals'}` : ''}.{' '}
      <button type="button" className={s.linkBtn} disabled={busy} onClick={() => void save(menu)}>
        Save it to My menus
      </button>{' '}
      {confirming ? (
        <>
          Discard it?{' '}
          <button type="button" className={s.linkBtn} disabled={busy} onClick={discard}>
            Yes, discard
          </button>{' '}
          <button type="button" className={s.linkBtn} onClick={() => setConfirming(false)}>
            Keep it
          </button>
        </>
      ) : (
        <button type="button" className={s.linkBtn} disabled={busy} onClick={() => setConfirming(true)}>
          Discard it
        </button>
      )}
      {error && <span> {error}</span>}
    </p>
  );
}
