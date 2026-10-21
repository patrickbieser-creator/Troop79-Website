'use server';

/**
 * Focus sets (Plans/Meeting-Planner-II.md, Decision 10; P3): a planner's reusable, labelled groups of requirements,
 * and the server search they are built from. Anyone who may view the planner can search and see the sets; creating,
 * editing and deleting a set is for meeting_planner.seed holders only, refused before the database is touched.
 * Seeding a meeting from a set is plannerSeedSetAction (./actions).
 */
import { revalidatePath } from 'next/cache';
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { deleteFocusSet, loadFocusSets, saveFocusSet, searchCounts, searchRequirements } from '@/lib/meeting-focus-db';
import { LABEL_MAX, normalizeLabel, type FocusSearchRow, type FocusSetView, type FocusSource } from '@/lib/meeting-focus';

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const KINDS = ['all', 'rank', 'mb'] as const;
type Kind = (typeof KINDS)[number];

async function viewer() {
  return plannerAccess(await resolveAdminActor()).canView;
}

/** Every focus set, with its labels, items and when it was last used. */
export async function focusSetsAction(): Promise<{ ok: true; sets: FocusSetView[] } | { ok: false; error: string }> {
  if (!(await viewer())) return fail('You don’t have access to the Meeting Planner.');
  return { ok: true, sets: await loadFocusSets(createAdminClient(), await loadAdvancementCatalog()) };
}

/** One page (50) of requirements matching every typed word, optionally one kind or one rank/badge. */
export async function focusSearchAction(input: { q: string; kind: Kind; source: string | null; offset: number }): Promise<{ ok: true; rows: FocusSearchRow[]; hasMore: boolean } | { ok: false; error: string }> {
  if (!(await viewer())) return fail('You don’t have access to the Meeting Planner.');
  if (typeof input?.q !== 'string' || !KINDS.includes(input.kind) || (input.source != null && typeof input.source !== 'string') || !Number.isInteger(input.offset) || input.offset < 0) return fail('Malformed request');
  try {
    return { ok: true, ...(await searchRequirements(createAdminClient(), { text: input.q.slice(0, 80), kind: input.kind, source: input.source, offset: input.offset })) };
  } catch {
    return fail('The search didn’t work. Try again.');
  }
}

/** How many requirements match in each rank and badge (the browse list). */
export async function focusCountsAction(input: { q: string; kind: Kind }): Promise<{ ok: true; sources: FocusSource[] } | { ok: false; error: string }> {
  if (!(await viewer())) return fail('You don’t have access to the Meeting Planner.');
  if (typeof input?.q !== 'string' || !KINDS.includes(input.kind)) return fail('Malformed request');
  try {
    return { ok: true, sources: await searchCounts(createAdminClient(), { text: input.q.slice(0, 80), kind: input.kind }) };
  } catch {
    return fail('The search didn’t work. Try again.');
  }
}

async function keeper() {
  const actor = await resolveAdminActor();
  if (!plannerAccess(actor).canSeed || actor?.personId == null) return fail('Only the planning team can change focus sets.');
  return { ok: true as const, personId: actor.personId };
}

/** Create (id null) or save a set: name, labels, items in order. */
export async function focusSaveSetAction(input: { id: number | null; name: string; labels: string[]; items: string[] }): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const k = await keeper();
  if (!k.ok) return k;
  if (
    (input?.id != null && !Number.isInteger(input.id)) ||
    typeof input?.name !== 'string' ||
    !Array.isArray(input.labels) ||
    !input.labels.every((l) => typeof l === 'string') ||
    !Array.isArray(input.items) ||
    !input.items.every((i) => typeof i === 'string')
  )
    return fail('Malformed request');
  if (!input.name.trim()) return fail('Give the set a name.');
  const labels = [...new Set(input.labels.map(normalizeLabel).filter(Boolean))];
  if (labels.some((l) => l.length > LABEL_MAX)) return fail(`Keep labels to ${LABEL_MAX} characters.`);
  const res = await saveFocusSet(createAdminClient(), k.personId, { id: input.id ?? null, name: input.name, labels, items: input.items });
  if (res.ok) revalidatePath('/planner/focus-sets');
  return res;
}

/** Delete a set. A focus group already seeded from it stays on its meeting. */
export async function focusDeleteSetAction(input: { id: number }): Promise<{ ok: true } | { ok: false; error: string }> {
  const k = await keeper();
  if (!k.ok) return k;
  if (!Number.isInteger(input?.id)) return fail('Malformed request');
  const res = await deleteFocusSet(createAdminClient(), input.id);
  if (res.ok) revalidatePath('/planner/focus-sets');
  return res;
}
