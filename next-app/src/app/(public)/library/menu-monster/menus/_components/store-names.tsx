'use client';

import { createContext, type ReactNode } from 'react';

/**
 * The troop's approved store names (mm_stores, not retired, in the admin's order), loaded ONCE by
 * menus/layout.tsx. The brand detail dialog's Store pull-down reads them (Plans/Menu-Monster-Brand-Detail.md,
 * decision 2: never free text). Empty = the field is hidden.
 */
export const StoreNames = createContext<readonly string[]>([]);

export function StoreNamesScope({ names, children }: { names: readonly string[]; children: ReactNode }) {
  return <StoreNames.Provider value={names}>{children}</StoreNames.Provider>;
}
