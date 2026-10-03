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

type Fail = { ok: false; error: string };

async function scoutActor(): Promise<AuditActor | Fail> {
  try {
    const s = await requireVerifiedScoutIdentity();
    return { personId: s.personId, label: s.displayName };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Scouts: sign in to write a recipe.' };
  }
}
const isFail = (v: AuditActor | Fail): v is Fail => 'ok' in v;

const NOT_YOURS = 'That recipe isn’t one of yours.';
const MESSAGES = {
  conflict: 'This recipe changed somewhere else. Reload it, then make your change again.',
  not_found: NOT_YOURS,
  retired: 'A leader retired this recipe, so it can’t be changed.',
  cap: `You have ${MAX_SCOUT_RECIPES} recipes. Delete a draft you don’t need to make room.`,
  invalid: 'Something in this recipe can’t be saved. Check the name and steps, then try again.'
} as const;

/** Save the scout's recipe: a new one when the payload has no id, else over the version the editor loaded. */
export async function saveScoutRecipeAction(raw: unknown, expectedUpdatedAt: string | null): Promise<{ ok: true; id: string; updatedAt: string } | Fail> {
  const actor = await scoutActor();
  if (isFail(actor)) return actor;
  const draft = sanitizeScoutRecipe(raw, await loadMenuMonsterCatalog(actor.personId));
  if (!draft.name) return { ok: false, error: 'Give your recipe a name.' };
  if (draft.id != null && (typeof expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(expectedUpdatedAt)))) {
    return { ok: false, error: MESSAGES.conflict };
  }
  const res = await saveScoutRecipeWith(createAdminClient(), actor, draft, expectedUpdatedAt);
  return res.status === 'saved' ? { ok: true, id: res.id, updatedAt: res.updatedAt } : { ok: false, error: MESSAGES[res.status] };
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
