'use server';

/**
 * Scout recipe actions (Plans/Menu-Monster-Scout-Workspace.md, Phase 4A): save a
 * draft, share it with the troop, delete a never-shared draft. Every action
 * resolves the author from the verified scout session (never the payload),
 * cleans the payload through sanitizeScoutRecipe(), and hands off to the store,
 * whose RPCs check ownership, the version, the cap and the text again.
 * `'use server'`: async exports only.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { requireVerifiedScoutIdentity } from '@/lib/family-access';
import type { AuditActor } from '@/lib/audit';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { MAX_SCOUT_RECIPES, isScoutRecipeId, sanitizeScoutRecipe } from '@/lib/menu-monster/scout-recipes';
import { deleteScoutDraftWith, saveScoutRecipeWith, shareScoutRecipeWith } from '@/lib/menu-monster/scout-recipes-store';
import { resolveGearWith, storedRecipeGearWith } from '@/lib/menu-monster/gear-store';
import { menuViewer, recipeAuthor } from '../../menu-monster/menus/_components/scout-menus';

type Fail = { ok: false; error: string };

/** The author: a verified scout (the epoch check every scout write makes), else any other signed-in person
 *  (a leader, a parent — menuViewer re-checks a parent's sign-in). The name is never taken from the payload. */
async function scoutActor(): Promise<AuditActor | Fail> {
  try {
    const s = await requireVerifiedScoutIdentity();
    return { personId: s.personId, label: s.displayName };
  } catch (e) {
    const viewer = await menuViewer();
    if (viewer && viewer.kind !== 'scout' && viewer.personId != null) {
      const author = await recipeAuthor();
      if (author) return { personId: author.personId, label: author.displayName };
    }
    // A scout hears why their sign-in ended; everyone else is simply asked to sign in.
    return { ok: false, error: e instanceof Error && viewer?.kind === 'scout' ? e.message : 'Sign in to write a recipe.' };
  }
}
const isFail = (v: AuditActor | Fail): v is Fail => 'ok' in v;

const NOT_YOURS = 'That recipe isn’t one of yours.';
const MESSAGES = {
  conflict: 'This recipe changed somewhere else. Reload it, then make your change again.',
  not_found: NOT_YOURS,
  retired: 'A leader retired this recipe, so it can’t be changed.',
  cap: `You have ${MAX_SCOUT_RECIPES} recipes. Delete a draft you don’t need to make room.`,
  invalid: 'Something in this recipe can’t be saved. Check the name and steps, then try again.',
  not_ready: 'A shared recipe needs at least one meal and one ingredient. Add them back, then save.',
  ingredient_cap: 'You have 10 new ingredients waiting for a leader to check them. Use one from the price book for now.',
  duplicate_ingredient: 'One of your new ingredients is already in the price book. Pick it from the search instead.'
} as const;

/** Save the scout's recipe: a new one when the payload has no id, else over the version the editor loaded. */
export async function saveScoutRecipeAction(
  raw: unknown,
  expectedUpdatedAt: string | null
): Promise<{ ok: true; id: string; updatedAt: string; ids: Record<string, string>; dropped: string[] } | Fail> {
  const actor = await scoutActor();
  if (isFail(actor)) return actor;
  const cleaned = sanitizeScoutRecipe(raw, await loadMenuMonsterCatalog(actor.personId));
  if (!cleaned.name) return { ok: false, error: 'Give your recipe a name.' };
  if (cleaned.id != null && (typeof expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(expectedUpdatedAt)))) {
    return { ok: false, error: MESSAGES.conflict };
  }
  const sb = createAdminClient();
  // Gear is picked from the troop's list (Patrick, 2026-10-05): anything not on it is dropped, and said so.
  const { kept, dropped } = await resolveGearWith(sb, cleaned.equipment, cleaned.equipment.length > 0 ? await storedRecipeGearWith(sb, cleaned.id) : []);
  const draft = { ...cleaned, equipment: kept };
  const res = await saveScoutRecipeWith(sb, actor, draft, expectedUpdatedAt);
  return res.status === 'saved' ? { ok: true, id: res.id, updatedAt: res.updatedAt, ids: res.ids, dropped } : { ok: false, error: MESSAGES[res.status] };
}

/** Share the scout's saved recipe with the troop ("Recipe by Sam K."). */
export async function shareScoutRecipeAction(id: string): Promise<{ ok: true; credit: string } | Fail> {
  const actor = await scoutActor();
  if (isFail(actor)) return actor;
  if (!isScoutRecipeId(id)) return { ok: false, error: NOT_YOURS };
  const res = await shareScoutRecipeWith(createAdminClient(), actor, id);
  if (res.status === 'shared') return { ok: true, credit: res.credit };
  if (res.status === 'not_ready') return { ok: false, error: 'Save it with at least one meal and one ingredient, then share.' };
  return { ok: false, error: res.status === 'retired' ? MESSAGES.retired : NOT_YOURS };
}

/** Delete one of the scout's never-shared drafts. */
export async function deleteScoutRecipeAction(id: string): Promise<{ ok: true } | Fail> {
  const actor = await scoutActor();
  if (isFail(actor)) return actor;
  if (!isScoutRecipeId(id)) return { ok: false, error: NOT_YOURS };
  const res = await deleteScoutDraftWith(createAdminClient(), actor, id);
  if (res.status === 'deleted') return { ok: true };
  if (res.status === 'in_use') return { ok: false, error: 'One of your menus uses this recipe. Take it off the menu first.' };
  if (res.status === 'shared') return { ok: false, error: 'A shared recipe stays in the troop’s library. Ask a leader to retire it.' };
  return { ok: false, error: NOT_YOURS };
}
