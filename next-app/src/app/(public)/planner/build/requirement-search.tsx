'use client';

/**
 * The requirement search Build a Plan's add row and mix editor share (B2): the focus sets' server search
 * (focusSearchAction, every typed word against code and words), debounced, at most SHOWN rows. `topLevel` keeps only
 * whole requirements (an offering is one); a mix takes any level.
 */
import { useEffect, useState } from 'react';
import type { FocusSearchRow } from '@/lib/meeting-focus';
import { focusSearchAction } from '../focus-actions';

const SHOWN = 12;

export type SearchState = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; rows: FocusSearchRow[] } | { status: 'failed' };

export function useRequirementSearch(q: string, topLevel: boolean): SearchState {
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const text = q.trim();
  useEffect(() => {
    if (!text) return;
    let live = true;
    const t = setTimeout(() => {
      setState({ status: 'loading' });
      focusSearchAction({ q: text, kind: 'all', source: null, offset: 0 })
        .then((res) => live && setState(res.ok ? { status: 'ready', rows: res.rows.filter((r) => !topLevel || r.topLevel).slice(0, SHOWN) } : { status: 'failed' }))
        .catch(() => live && setState({ status: 'failed' }));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [text, topLevel]);
  return text ? state : { status: 'idle' };
}

/** 'Tenderfoot 4a', 'First Aid 9b'. */
export const rowCode = (r: Pick<FocusSearchRow, 'sourceName' | 'code'>) => `${r.sourceName} ${r.code}`;
