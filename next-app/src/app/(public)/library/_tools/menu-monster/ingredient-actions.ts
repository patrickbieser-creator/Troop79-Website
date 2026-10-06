'use server';

/**
 * Adding an ingredient from the public Ingredients tab (Patrick, 2026-10-03).
 * Any signed-in person may ask; who they are decides what happens:
 *
 *   - a leader who keeps the price book (`library.moderate`): it joins the book
 *     at once, in the store section they picked;
 *   - anyone else (a scout, a parent, a leader without that capability): it is
 *     held for a leader — Admin > Menu Monster > Scout recipes > New
 *     ingredients — and until then only the person who asked sees it.
 *
 * Either way it is a 4B typed-in (mm_submit_ingredient → mm_create_typed_in):
 * one validator, one cap of 10 waiting per person, no duplicate names.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { requireVerifiedScoutIdentity } from '@/lib/family-access';
import { resolveAdminActor } from '@/lib/admin-actor';
import { recordAuditAs } from '@/lib/audit';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { sanitizeNewIngredients } from '@/lib/menu-monster/scout-ingredients';
import { keepTypedInWith, submitIngredientWith } from '@/lib/menu-monster/scout-recipes-store';
import type { Section } from '@/lib/menu-monster/types';
import { menuViewer } from '../../menu-monster/menus/_components/scout-menus';

type Fail = { ok: false; error: string };

const ERRORS = {
  signin: 'Sign in to add an ingredient.',
  ingredient_cap: 'You have 10 ingredients waiting for a leader to check them. Wait for a leader before adding more.',
  duplicate_ingredient: 'The troop’s price book already has that.',
  invalid: 'Check the name, the package size and the price, then try again.'
} as const;
const SECTIONS: readonly Section[] = ['produce', 'dairy', 'beverage', 'meat', 'bakery', 'dry'];

export async function submitIngredientAction(raw: unknown, section?: unknown): Promise<{ ok: true; status: 'live' | 'review'; name: string } | Fail> {
  const viewer = await menuViewer();
  if (!viewer || viewer.personId == null) return { ok: false, error: ERRORS.signin };
  let label = 'A parent';
  let live = false;
  if (viewer.kind === 'scout') {
    // The epoch check the scout's other writes make: a revoked sign-in ends here.
    try {
      label = (await requireVerifiedScoutIdentity()).displayName;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : ERRORS.signin };
    }
  } else if (viewer.kind === 'leader') {
    label = viewer.label;
    live = (await resolveAdminActor())?.capabilities.has('library.moderate') ?? false;
  }

  let size = 0;
  try {
    size = (JSON.stringify(raw) ?? '').length;
  } catch {
    return { ok: false, error: ERRORS.invalid };
  }
  if (size === 0 || size > 4 * 1024) return { ok: false, error: ERRORS.invalid };
  const catalog = await loadMenuMonsterCatalog(viewer.personId);
  const [clean] = sanitizeNewIngredients([raw], catalog);
  if (!clean) return { ok: false, error: ERRORS.invalid };

  const sb = createAdminClient();
  const res = await submitIngredientWith(sb, viewer.personId, clean);
  if (res.status !== 'added') return { ok: false, error: ERRORS[res.status] };
  const actor = { personId: viewer.personId, label };
  if (live) {
    const aisle = SECTIONS.includes(section as Section) ? (section as Section) : 'dry';
    // Not kept (it should be: the row is seconds old) — say what is true: it is waiting like anyone else's.
    if (!(await keepTypedInWith(sb, res.id, aisle, clean.avoid))) return { ok: true, status: 'review', name: clean.name };
    await recordAuditAs(sb, actor, { area: 'library', action: 'create', entityType: 'mm_ingredient', entityId: res.id, summary: `${label} added Menu Monster ingredient "${clean.name}" from the public page` });
    return { ok: true, status: 'live', name: clean.name };
  }
  await recordAuditAs(sb, actor, { area: 'library', action: 'create', entityType: 'mm_ingredient', entityId: res.id, summary: `${label} asked to add Menu Monster ingredient "${clean.name}"` });
  return { ok: true, status: 'review', name: clean.name };
}
