'use client';

import { createContext, type ReactNode } from 'react';

/** One active scout the "Planned by" pull-down can offer: a person id and a display name, nothing else. */
export interface ScoutOption {
  personId: number;
  name: string;
}

/**
 * The troop's active scouts (scouts.active → people.display_name), loaded ONCE by menus/layout.tsx. Who's eating's
 * "Planned by" pull-down reads them (Plans/Menu-Monster-Planned-By.md, decision 3). Empty = the field is hidden.
 */
export const ScoutOptions = createContext<readonly ScoutOption[]>([]);

export function ScoutOptionsScope({ options, children }: { options: readonly ScoutOption[]; children: ReactNode }) {
  return <ScoutOptions.Provider value={options}>{children}</ScoutOptions.Provider>;
}
