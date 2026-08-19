/**
 * "Which people may this verified identity see/act on behalf of?" — the
 * household-scoping helper Plans/Troop-Finances.md Phase 3 introduces as a
 * genuinely new pattern for this codebase: every existing capability is
 * troop-wide (a leader with a grant sees ALL scouts), and nothing before
 * this scoped data to "your own family only".
 *
 * Framework-agnostic on purpose (no next/headers) — same split as
 * lib/capabilities.ts vs lib/require-capability.ts — so this is directly
 * testable in the db-project suite without a request context, and reusable
 * wherever else "just my own household" scoping is needed (Phase 4
 * reimbursement requests will want the same rule).
 *
 * Deliberately narrower than "everyone in my household_members row": scope
 * is self plus children via an explicit parent_of/guardian_of relationship,
 * not blanket household co-membership. A step-sibling or another adult
 * sharing a household row is NOT automatically in scope just by living
 * there — only an actual guardian relationship grants it. A scout's scope
 * is always just themselves; scouts have no children.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export async function resolveFamilyScope(
  supabase: SupabaseClient,
  personId: number,
  subjectKind: 'adult' | 'scout'
): Promise<number[]> {
  if (subjectKind === 'scout') return [personId];

  const { data } = await supabase
    .from('relationships')
    .select('related_person_id')
    .eq('person_id', personId)
    .in('type', ['parent_of', 'guardian_of']);

  const childIds = ((data ?? []) as { related_person_id: number }[]).map((r) => r.related_person_id);
  return [personId, ...childIds];
}
