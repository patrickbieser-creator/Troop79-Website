'use server';

/**
 * Brands typed on the public side (Plans/Menu-Monster-Brands-Gear.md, release 3). Anyone signed in — a scout,
 * a parent, a leader — may add a brand of an ingredient, and it joins the troop's list AT ONCE (Patrick,
 * 2026-10-03: no leader review; an adult can remove it in admin). mm_add_brand ignores case and punctuation
 * when matching, so "chips ahoy!" returns the existing Chips Ahoy; a person may hold at most 40 brands of
 * their own that nobody has priced yet.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { requireVerifiedScoutIdentity } from '@/lib/family-access';
import { recordAuditAs } from '@/lib/audit';
import { cleanScoutText } from '@/lib/menu-monster/scout-text';
import type { Brand } from '@/lib/menu-monster/types';
import { addBrandWith } from '@/lib/menu-monster/brands-store';
import { menuViewer } from '../../menu-monster/menus/_components/scout-menus';

type Fail = { ok: false; error: string };

const ERRORS = {
  signin: 'Sign in to add a brand.',
  invalid: 'That brand name can’t be saved. Try a shorter, plainer name.',
  cap: 'You have added a lot of brands nobody has bought yet. Pick one of those, or wait until some are priced.',
  ingredient: 'That ingredient is gone. Reload the page and try again.'
} as const;

export async function addBrandAction(ingredientId: unknown, name: unknown): Promise<{ ok: true; brand: Brand } | Fail> {
  if (typeof ingredientId !== 'string' || ingredientId.length > 80) return { ok: false, error: ERRORS.ingredient };
  const clean = cleanScoutText(name, 60);
  if (!clean) return { ok: false, error: ERRORS.invalid };
  const viewer = await menuViewer();
  if (!viewer || viewer.personId == null) return { ok: false, error: ERRORS.signin };
  let label = viewer.kind === 'leader' ? viewer.label : 'A parent';
  if (viewer.kind === 'scout') {
    // The epoch check every scout write makes: a revoked sign-in ends here.
    try {
      label = (await requireVerifiedScoutIdentity()).displayName;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : ERRORS.signin };
    }
  }
  const sb = createAdminClient();
  const res = await addBrandWith(sb, viewer.personId, ingredientId, clean);
  if (res.status !== 'ok') return { ok: false, error: ERRORS[res.status] };
  if (res.created) {
    await recordAuditAs(sb, { personId: viewer.personId, label }, { area: 'library', action: 'create', entityType: 'mm_brand', entityId: res.brand.id, summary: `${label} added the Menu Monster brand "${res.brand.name}"` });
  }
  return { ok: true, brand: res.brand };
}
