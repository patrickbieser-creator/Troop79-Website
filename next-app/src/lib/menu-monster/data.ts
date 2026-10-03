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

/**
 * `ownerPersonId` is REQUIRED (Phase 4, tech-lead): the menu-side catalog carries
 * the owner's own draft recipes, and a menu sanitized without them silently drops
 * those drafts on the next save. Pass the menu owner's person id (the verified
 * scout, or the owner of the menu a leader is reading), or null when no saved
 * menu is involved (visitors' local menus, the public shelf).
 */
export async function loadMenuMonsterCatalog(ownerPersonId: number | null): Promise<Catalog> {
  return loadCatalogWith(createAdminClient(), { ownerPersonId });
}
