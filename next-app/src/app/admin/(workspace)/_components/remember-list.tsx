'use client';

/**
 * RememberList — a list page writes its own URL (path + query) to
 * sessionStorage under `list:{pathname}` every time it renders, so a child
 * screen's BackNav can bring the leader back to the Past tab, the search, or
 * the assignment set they were on (Jenna, 2026-08-25: remembered-last-list-
 * URL beats threading returnTo= through every route). Rendered by PageTitle
 * when back={null}; per-list keys, so two lists never overwrite each other.
 */
import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { LIST_KEY_PREFIX } from './back-nav';

export function RememberList() {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    const qs = search?.toString();
    try {
      window.sessionStorage.setItem(LIST_KEY_PREFIX + pathname, qs ? `${pathname}?${qs}` : pathname);
    } catch {
      /* private mode / storage off — the plain parent link still works */
    }
  }, [pathname, search]);
  return null;
}
