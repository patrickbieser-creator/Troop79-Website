'use client';

/**
 * BackNav — the one way back, in the one place (Patrick, 2026-08-25: "a
 * consistent way to move backwards that's a little more obvious and
 * omnipresent … and in a consistent place on the screen"; option C, quiet
 * text, from Brad's prototype).
 *
 * Rendered by `PageTitle` above the h1, left-aligned, first thing after the
 * top bar in Tab order. Two shapes, chosen by depth (Jenna's MACRO sweep):
 *
 *   depth 2  — "← Back to {Parent}"      back={{ label, href }}
 *   depth ≥3 — breadcrumb trail          back={{ crumbs: [root, parent], current }}
 *              (nav aria-label="Breadcrumb", last crumb aria-current="page";
 *              under 420px the trail folds to "← {Parent}")
 *
 * Two behaviours ride along:
 *   * LIST STATE — a list page (back={null}) remembers its last URL, filters
 *     and all, in sessionStorage under `list:{pathname}` (RememberList). When
 *     a back target's href matches a remembered list, the click lands on the
 *     remembered URL, so Past-tab / search / ?set= survive the round trip.
 *   * DIRTY FORMS — if any form on the page is dirty (DirtyGuardProvider),
 *     the click opens a Discard-changes dialog instead of leaving.
 */
import type { MouseEvent } from 'react';
import Link from 'next/link';
import { useGuardedNav } from './guarded-nav';
import styles from './back-nav.module.css';

export interface Crumb {
  label: string;
  href: string;
}

export type BackTarget =
  | { label: string; href: string; crumbs?: undefined }
  | {
      /** Root first, immediate parent last — every one a link. */
      crumbs: Crumb[];
      /** The current page's own crumb; defaults to PageTitle's title. */
      current?: string;
      label?: undefined;
      href?: undefined;
    };

export const LIST_KEY_PREFIX = 'list:';

/** The remembered list URL for a target, if the list wrote one this session. */
export function resolveBackHref(href: string): string {
  try {
    const remembered = window.sessionStorage.getItem(LIST_KEY_PREFIX + href.split('?')[0]);
    return remembered ?? href;
  } catch {
    return href;
  }
}

export function BackNav({ back, current }: { back: BackTarget; current?: string }) {
  const { navigate, dialog } = useGuardedNav();

  function go(e: MouseEvent<HTMLAnchorElement>, href: string) {
    // Plain left click only — let modifier clicks open new tabs normally.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    navigate(resolveBackHref(href));
  }

  const parent = back.crumbs ? back.crumbs[back.crumbs.length - 1] : { label: back.label, href: back.href };

  return (
    <>
      {back.crumbs ? (
        <nav aria-label="Breadcrumb" className={styles.nav}>
          <ol className={styles.crumbs}>
            {back.crumbs.map((c) => (
              <li key={c.href} className={styles.crumb}>
                <Link href={c.href} className={styles.link} onClick={(e) => go(e, c.href)}>
                  {c.label}
                </Link>
              </li>
            ))}
            <li className={styles.crumb} aria-current="page">
              {back.current ?? current}
            </li>
          </ol>
          {/* Phone: the trail folds to one hop (Jenna: never wrap or scroll). */}
          <Link href={parent.href} className={`${styles.link} ${styles.folded}`} onClick={(e) => go(e, parent.href)}>
            <span aria-hidden="true">&larr;</span> {parent.label}
          </Link>
        </nav>
      ) : (
        <nav aria-label="Back" className={styles.nav}>
          <Link href={back.href} className={styles.link} onClick={(e) => go(e, back.href)}>
            <span aria-hidden="true">&larr;</span> Back to {back.label}
          </Link>
        </nav>
      )}

      {dialog}
    </>
  );
}
