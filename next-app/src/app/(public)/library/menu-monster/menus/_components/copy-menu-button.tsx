'use client';

/**
 * Copy to My menus (Phase 3, Decision 20): a signed-in scout copies another
 * scout's shared menu. The copy opens straight away; when some recipes
 * couldn't come across (the owner hasn't shared them), it says so first and
 * offers the link instead.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { copyMenuAction } from '../../../_tools/menu-monster/menu-actions';
import s from './workspace.module.css';

const MENUS_HREF = '/library/menu-monster/menus';

export function CopyMenuButton({ menuId }: { menuId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<{ id: string; dropped: number } | null>(null);

  async function copy() {
    setBusy(true);
    setError(null);
    const res = await copyMenuAction(menuId);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    if (res.droppedRecipes === 0) return router.push(`${MENUS_HREF}/${res.id}`);
    setLeft({ id: res.id, dropped: res.droppedRecipes });
  }

  if (left) {
    return (
      <p className={s.foot} role="status">
        {left.dropped === 1 ? 'Copied without 1 recipe that isn’t shared yet.' : `Copied without ${left.dropped} recipes that aren’t shared yet.`}{' '}
        <Link className={s.link} href={`${MENUS_HREF}/${left.id}`}>
          Open your copy
        </Link>
      </p>
    );
  }
  return (
    <span>
      <Button variant="secondary" size="sm" onClick={() => void copy()} disabled={busy}>
        {busy ? 'Copying…' : 'Copy to My menus'}
      </Button>
      {error && (
        <span className={s.foot} role="alert">
          {' '}
          {error}
        </span>
      )}
    </span>
  );
}
