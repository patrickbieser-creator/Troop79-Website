'use client';

/**
 * URL-backed list filters, one way (2026-08-26 — consolidates the three
 * hand-rolled copies in the Calendar, News and Ledger toolbars).
 *
 * Filter state lives in the URL, not useState, so a filtered list survives
 * back-nav and list-state restore (v1.96). Two things every copy had to get
 * right, now in one place:
 *
 *   - Search is DEBOUNCED (450ms): typing must not push a history entry per
 *     keystroke, and 450ms leaves room for the server round-trip before the
 *     next push fires.
 *   - The local `text` mirror resyncs from the URL only while the input is
 *     NOT focused. Otherwise the server's lagging response clobbers
 *     mid-flight keystrokes — the classic "every other letter disappears" bug
 *     (browser back and pasted URLs still resync, because the input isn't
 *     focused then).
 *
 * `push` merges the given keys into the current query (null/'' deletes),
 * drops `page` when `resetPage` is set (any filter change is page 1 again),
 * and pushes inside a transition so the old list stays put until the new one
 * is ready.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export const URL_SEARCH_DEBOUNCE_MS = 450;

interface Options {
  /** The list's route — pushes go to `${path}?…`. */
  path: string;
  /** The `q` the server rendered with; the mirror resyncs to it. */
  q: string;
  /** Delete `page` on every push (paged lists). */
  resetPage?: boolean;
  /** Pass `{ scroll: false }` to router.push (lists that must not jump). */
  keepScroll?: boolean;
}

export function useUrlSearch({ path, q, resetPage = false, keepScroll = false }: Options) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [text, setText] = useState(q);
  const [, startTransition] = useTransition();
  const inputFocusedRef = useRef(false);

  useEffect(() => {
    if (!inputFocusedRef.current) setText(q);
  }, [q]);

  const push = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === '') params.delete(k);
        else params.set(k, v);
      }
      if (resetPage) params.delete('page');
      const href = `${path}${params.toString() ? `?${params.toString()}` : ''}`;
      startTransition(() => {
        if (keepScroll) router.push(href, { scroll: false });
        else router.push(href);
      });
    },
    [router, searchParams, path, resetPage, keepScroll]
  );

  useEffect(() => {
    if (text === q) return;
    const t = setTimeout(() => push({ q: text }), URL_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // `push` is stable per URL; re-arming on it would re-debounce after every
    // server render, which is exactly the lag this hook exists to absorb.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  /** Spread onto the search <input>: value, onChange, focus tracking. */
  const inputProps = {
    value: text,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value),
    onFocus: () => {
      inputFocusedRef.current = true;
    },
    onBlur: () => {
      inputFocusedRef.current = false;
    }
  };

  return { text, setText, push, inputProps };
}
