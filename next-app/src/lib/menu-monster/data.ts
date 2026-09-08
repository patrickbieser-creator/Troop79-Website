/**
 * Menu Monster — server-only catalog load for the shelf page.
 *
 * The mm_* tables have RLS on with zero policies (D-051 / D-239): the only
 * read path is the service role on the server. This wrapper is the one place
 * that touches createAdminClient(); the query itself lives in ./catalog.ts so
 * Vitest can run it against local Postgres without Next's request context.
 */

import 'server-only';
import { createAdminClient } from '@/lib/supabase/server';
import { loadCatalogWith } from './catalog';
import type { Catalog } from './types';

export async function loadMenuMonsterCatalog(): Promise<Catalog> {
  return loadCatalogWith(createAdminClient());
}
