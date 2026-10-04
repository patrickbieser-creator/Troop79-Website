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
import { addBrandWith, suggestRecipeBrandWith } from '@/lib/menu-monster/brands-store';
import { menuViewer, recipeAuthor } from '../../menu-monster/menus/_components/scout-menus';

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

const SUGGEST_ERRORS = {
  signin: 'Sign in to suggest a brand.',
  not_found: 'That recipe is gone. Reload the page and try again.',
  not_yours: 'Only the person who wrote a recipe can suggest a brand for it.',
  bad_brand: 'That brand can’t be suggested for this recipe. Reload the page and try again.'
} as const;
const ID = /^[A-Za-z0-9:_-]{1,80}$/;

/**
 * "Suggest this for the recipe" (release 6): the recipe's AUTHOR sets, or with brandId null clears, the brand
 * their recipe suggests for one ingredient. Whoever adds the recipe to a menu starts with it and can change it.
 * Leaders suggest for any recipe in admin.
 */
export async function suggestRecipeBrandAction(recipeId: unknown, ingredientId: unknown, brandId: unknown): Promise<{ ok: true } | Fail> {
  if (typeof recipeId !== 'string' || !ID.test(recipeId) || typeof ingredientId !== 'string' || !ID.test(ingredientId)) return { ok: false, error: SUGGEST_ERRORS.not_found };
  if (brandId !== null && (typeof brandId !== 'string' || !ID.test(brandId))) return { ok: false, error: SUGGEST_ERRORS.bad_brand };
  const viewer = await menuViewer();
  if (!viewer || viewer.personId == null) return { ok: false, error: SUGGEST_ERRORS.signin };
  let label = '';
  if (viewer.kind === 'scout') {
    try {
      label = (await requireVerifiedScoutIdentity()).displayName;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : SUGGEST_ERRORS.signin };
    }
  } else {
    label = (await recipeAuthor())?.displayName ?? 'Someone';
  }
  const sb = createAdminClient();
  const res = await suggestRecipeBrandWith(sb, viewer.personId, recipeId, ingredientId, brandId);
  if (res !== 'ok') return { ok: false, error: SUGGEST_ERRORS[res] };
  await recordAuditAs(sb, { personId: viewer.personId, label }, { area: 'library', action: 'update', entityType: 'mm_recipe', entityId: recipeId, summary: `${label} ${brandId ? 'suggested a brand for' : 'stopped suggesting a brand for'} an ingredient of recipe ${recipeId}` });
  return { ok: true };
}
