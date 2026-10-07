import type { ReactNode } from 'react';
import { createAdminClient } from '@/lib/supabase/server';
import { listActiveStoreNamesWith } from '@/lib/menu-monster/stores';
import { StoreNamesScope } from './_components/store-names';
import { ScoutOptionsScope, type ScoutOption } from './_components/scout-options';
import { loadActiveScoutOptionsWith } from '@/lib/menu-monster/menu-planners';

/**
 * Loads the troop's approved store names ONCE for every menu page (the planner, a meal, Shopping, the local
 * menu): the brand detail dialog's Store pull-down reads them from context (Plans/Menu-Monster-Brand-Detail.md,
 * decision 2). The service-role client, like the other loaders (anon-key PII lockdown). A failed read leaves the
 * list empty, which hides the field; it never breaks a menu page.
 */
export default async function MenusLayout({ children }: { children: ReactNode }) {
  let names: string[] = [];
  try {
    names = await listActiveStoreNamesWith(createAdminClient());
  } catch {
    names = [];
  }
  let scouts: ScoutOption[] = [];
  try {
    scouts = await loadActiveScoutOptionsWith(createAdminClient());
  } catch {
    scouts = [];
  }
  return (
    <StoreNamesScope names={names}>
      <ScoutOptionsScope options={scouts}>{children}</ScoutOptionsScope>
    </StoreNamesScope>
  );
}
