/**
 * A scout's package on a price-book ingredient (release C, P2.3a). One RPC,
 * mm_add_scout_package, does the band check under a lock on the ingredient:
 * inside ±PRICE_BAND of the cheapest live usable package's unit price it is
 * live at once; outside, or with nothing to compare against, it is held for a
 * leader (only its scout's catalog carries it meanwhile). An identical package
 * already in the book is 'same' — nothing is added. Audited under `library`,
 * like every price-book change. `*With(supabase)` so Vitest runs it against
 * local Postgres; the action passes createAdminClient().
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAuditAs, type AuditActor } from '@/lib/audit';
import { PRICE_BAND } from './price-band';
import type { ScoutPackage } from './scout-packages';

export type AddPackageResult = { status: 'live' | 'held' | 'same'; id: string } | { status: 'cap' | 'invalid' };

export async function addScoutPackageWith(sb: SupabaseClient, actor: AuditActor, pkg: ScoutPackage): Promise<AddPackageResult> {
  if (actor.personId == null) return { status: 'invalid' };
  const { data, error } = await sb.rpc('mm_add_scout_package', {
    p_person: actor.personId,
    p_ingredient_id: pkg.ingredientId,
    p_pkg: { name: pkg.name, store: pkg.store, size: pkg.size, price: pkg.price },
    p_band: PRICE_BAND
  });
  if (error) {
    if (error.message.includes('MM_PACKAGE_CAP')) return { status: 'cap' };
    if (error.message.includes('MM_BAD_')) return { status: 'invalid' };
    throw new Error(`add scout package: ${error.message}`);
  }
  const res = data as { status: 'live' | 'held' | 'same'; id: string };
  if (res.status !== 'same') {
    const { data: ing } = await sb.from('mm_ingredients').select('name').eq('id', pkg.ingredientId).maybeSingle();
    await recordAuditAs(sb, actor, {
      area: 'library',
      action: res.status === 'held' ? 'package_held' : 'package_add',
      entityType: 'mm_package',
      entityId: res.id,
      summary: `${actor.label} added package "${pkg.name}" to ${(ing?.name as string | undefined) ?? pkg.ingredientId}${res.status === 'held' ? ' (waiting for a leader)' : ''}`
    });
  }
  return res;
}
