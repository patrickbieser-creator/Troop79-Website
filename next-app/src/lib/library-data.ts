/**
 * Resource Library — data access (Plans/Resource-Library.md).
 *
 * Every function takes a SupabaseClient rather than creating one so the same
 * code runs from Server Components / Server Actions (createAdminClient) AND
 * from Vitest against local Postgres (tests/helpers/admin-client.ts) — the
 * D-049 pattern: integration-test the real query, don't mock the DB.
 *
 * Public read functions filter status='published' at the query — pending and
 * archived rows must never leave the server for an un-gated page.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  LedgerKind,
  LibraryPlacement,
  LibraryResource,
  LibraryTopic,
  RequirementNote,
  RequirementSubmission
} from '@/lib/supabase/types';
import type { LibraryTargetKind } from '@/lib/library';
import { splitRankReqKey } from '@/lib/library';
import { isDuplicateLedgerEntry } from '@/lib/ledger-dedup';

export interface PlacedResource extends LibraryResource {
  placement: Pick<LibraryPlacement, 'id' | 'pinned' | 'sort_order' | 'target_kind' | 'target_key'>;
}

/** Active (non-retired) shelves in webmaster order. */
export async function loadTopics(supabase: SupabaseClient): Promise<LibraryTopic[]> {
  const { data } = await supabase
    .from('library_topics')
    .select('*')
    .is('retired_at', null)
    .order('sort_order');
  return (data ?? []) as LibraryTopic[];
}

/** Published resources placed on one page, pinned first then webmaster order. */
export async function loadPublishedFor(
  supabase: SupabaseClient,
  targetKind: LibraryTargetKind,
  targetKey: string
): Promise<PlacedResource[]> {
  const { data } = await supabase
    .from('library_placements')
    .select('id, pinned, sort_order, target_kind, target_key, library_resources!inner(*)')
    .eq('target_kind', targetKind)
    .eq('target_key', targetKey)
    .eq('library_resources.status', 'published');
  type Row = LibraryPlacement & { library_resources: LibraryResource };
  const placed = ((data ?? []) as unknown as Row[]).map((row) => ({
    ...row.library_resources,
    placement: {
      id: row.id,
      pinned: row.pinned,
      sort_order: row.sort_order,
      target_kind: row.target_kind,
      target_key: row.target_key
    }
  }));
  // Pinned first, then webmaster order; ties (default sort_order 0) read
  // newest-first BY THE RESOURCE's date — a weekly shelf like the Sparkler
  // stays current without hand-numbering. Sorted here, not in PostgREST: the
  // date lives on the joined resource (a backfilled post carries its real
  // issue date), and ordering by the placement's own created_at put the
  // whole archive oldest-first (caught live 2026-07-21).
  return placed.sort(
    (a, b) =>
      Number(b.placement.pinned) - Number(a.placement.pinned) ||
      a.placement.sort_order - b.placement.sort_order ||
      b.created_at.localeCompare(a.created_at)
  );
}

/**
 * Published-resource counts per target, one query for the whole drill —
 * `${target_kind}:${target_key}` → count. Placement volume is small (troop
 * scale); grouping happens here, not in PostgREST.
 */
export async function publishedCountsByTarget(
  supabase: SupabaseClient
): Promise<Map<string, number>> {
  const { data } = await supabase
    .from('library_placements')
    .select('target_kind, target_key, library_resources!inner(status)')
    .eq('library_resources.status', 'published');
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { target_kind: string; target_key: string }[]) {
    const key = `${row.target_kind}:${row.target_key}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export interface SearchHit extends LibraryResource {
  placements: Pick<LibraryPlacement, 'target_kind' | 'target_key'>[];
}

/**
 * Full-text search over published resources (title/blurb/body via the
 * generated fts column), with a plain ilike fallback on title so partial
 * words still hit — pg_trgm deliberately not introduced (tech-lead 2026-07-21).
 */
export async function searchPublishedResources(
  supabase: SupabaseClient,
  query: string
): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];

  const [ftsRes, ilikeRes] = await Promise.all([
    supabase
      .from('library_resources')
      .select('*')
      .eq('status', 'published')
      .textSearch('fts', q, { type: 'websearch', config: 'english' })
      .limit(50),
    supabase
      .from('library_resources')
      .select('*')
      .eq('status', 'published')
      .ilike('title', `%${q}%`)
      .limit(50)
  ]);

  const byId = new Map<number, LibraryResource>();
  for (const row of [...(ftsRes.data ?? []), ...(ilikeRes.data ?? [])] as LibraryResource[]) {
    byId.set(row.id, row);
  }
  if (byId.size === 0) return [];

  const { data: placements } = await supabase
    .from('library_placements')
    .select('resource_id, target_kind, target_key')
    .in('resource_id', [...byId.keys()]);
  const placementsByResource = new Map<number, SearchHit['placements']>();
  for (const p of (placements ?? []) as (Pick<LibraryPlacement, 'target_kind' | 'target_key'> & {
    resource_id: number;
  })[]) {
    const list = placementsByResource.get(p.resource_id) ?? [];
    list.push({ target_kind: p.target_kind, target_key: p.target_key });
    placementsByResource.set(p.resource_id, list);
  }

  return [...byId.values()].map((r) => ({
    ...r,
    placements: placementsByResource.get(r.id) ?? []
  }));
}

export async function loadNarrative(
  supabase: SupabaseClient,
  targetKind: 'rank_req' | 'mb' | 'mb_req',
  targetKey: string
): Promise<RequirementNote | null> {
  const { data } = await supabase
    .from('requirement_notes')
    .select('*')
    .eq('target_kind', targetKind)
    .eq('target_key', targetKey)
    .maybeSingle();
  return (data as RequirementNote | null) ?? null;
}

// ── Admin mutations (called from /admin/library server actions) ────────────

/** Publishes a queued resource. Attribution defaults from submitted_by_label
 *  unless the webmaster already set one. */
export async function approveResource(
  supabase: SupabaseClient,
  id: number,
  reviewer: string
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('library_resources')
    .select('attribution_label, submitted_by_label')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return 'Resource not found';
  const attribution =
    (existing.attribution_label as string | null) ??
    ((existing.submitted_by_label as string | null)
      ? `Shared by ${existing.submitted_by_label}`
      : null);
  const { error } = await supabase
    .from('library_resources')
    .update({
      status: 'published',
      attribution_label: attribution,
      reviewed_by: reviewer,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', id);
  return error ? error.message : null;
}

/** Declines (archives) a queued resource with a reason. Never hard-deletes. */
export async function declineResource(
  supabase: SupabaseClient,
  id: number,
  reviewer: string,
  reason: string
): Promise<string | null> {
  const { error } = await supabase
    .from('library_resources')
    .update({
      status: 'archived',
      decline_reason: reason || null,
      reviewed_by: reviewer,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', id);
  return error ? error.message : null;
}

/**
 * D-019 rename cascade, library extension (tech-lead 2026-07-21): when a
 * top-level requirement code is renamed in Lookups, every library row keyed
 * to the old composite follows. `source` maps to the library's OWN
 * discriminator ('rank'→'rank_req', 'mb'→'mb_req') — deliberately NOT the
 * ledger kind values, which are a different namespace.
 *
 * NOTE: sub-requirement code renaming has no UI today (req-codes-table.tsx
 * ships top-level only). When it ships, it MUST carry this same cascade or
 * it reintroduces the silent-orphan bug D-019 exists to prevent.
 */
// ── Phase 2: proof-of-completion submissions ────────────────────────────────

const REQUIREMENT_KIND_LABEL: Record<'rank_req' | 'mb_req', LedgerKind> = {
  rank_req: 'rank_requirement',
  mb_req: 'merit_badge_requirement'
};

/** Pending proof submissions, oldest first — the admin Proof Queue and the
 *  Needs Attention panel both read this. */
export async function loadPendingSubmissions(
  supabase: SupabaseClient
): Promise<RequirementSubmission[]> {
  const { data } = await supabase
    .from('requirement_submissions')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  return (data ?? []) as RequirementSubmission[];
}

/**
 * Resolves a (target_kind, target_key) submission address back to the
 * catalog row it names — same '{parentId}-{code}' split the admin workstation
 * already does for display (targetLabel/targetHref in admin/library/page.tsx),
 * reused here so the ledger write carries the real requirement label.
 * Returns null only if the composite key doesn't match any known rank/badge
 * (never for an unknown leaf code — the label is just null in that case).
 */
export async function resolveRequirementLabel(
  supabase: SupabaseClient,
  targetKind: 'rank_req' | 'mb_req',
  targetKey: string
): Promise<{ parentId: string; code: string; label: string | null } | null> {
  if (targetKind === 'rank_req') {
    const { data: ranks } = await supabase.from('ranks').select('id');
    const rankIds = ((ranks ?? []) as { id: string }[]).map((r) => r.id);
    const split = splitRankReqKey(targetKey, rankIds);
    if (!split) return null;
    const { data: req } = await supabase
      .from('rank_requirements')
      .select('label')
      .eq('rank_id', split.rankId)
      .eq('code', split.code)
      .maybeSingle();
    return { parentId: split.rankId, code: split.code, label: (req as { label: string } | null)?.label ?? null };
  }
  const { data: mbs } = await supabase.from('merit_badges').select('id');
  const mbId = ((mbs ?? []) as { id: string }[]).map((m) => m.id).find((id) => targetKey.startsWith(`${id}-`));
  if (!mbId) return null;
  const code = targetKey.slice(mbId.length + 1);
  const { data: req } = await supabase
    .from('merit_badge_requirements')
    .select('label')
    .eq('mb_id', mbId)
    .eq('code', code)
    .maybeSingle();
  return { parentId: mbId, code, label: (req as { label: string } | null)?.label ?? null };
}

/** True if the scout already has this requirement on the active ledger —
 *  the admin Proof Queue shows this as a warning before the leader approves. */
export async function scoutAlreadyHasRequirement(
  supabase: SupabaseClient,
  scoutId: string,
  targetKind: 'rank_req' | 'mb_req',
  targetKey: string
): Promise<boolean> {
  return isDuplicateLedgerEntry(supabase, scoutId, REQUIREMENT_KIND_LABEL[targetKind], targetKey);
}

/**
 * Approves a pending proof submission: writes exactly the ledger row Fast
 * Entry would (same dup-blocked path, D-041) and back-links ledger_entry_id.
 * Blocked — not silently dropped — if the scout already has this exact
 * requirement, so the leader can choose to Return instead with feedback
 * rather than the approval vanishing with no explanation.
 */
export async function approveSubmission(
  supabase: SupabaseClient,
  id: number,
  reviewer: string
): Promise<{ error: string | null; ledgerEntryId?: number }> {
  const { data: sub } = await supabase
    .from('requirement_submissions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!sub) return { error: 'Submission not found' };
  const submission = sub as RequirementSubmission;
  if (submission.status !== 'pending') return { error: 'This submission was already reviewed.' };

  const kind = REQUIREMENT_KIND_LABEL[submission.target_kind];
  const duplicate = await isDuplicateLedgerEntry(supabase, submission.scout_id, kind, submission.target_key);
  if (duplicate) {
    return {
      error:
        'This scout already has this requirement signed off — nothing to approve. Consider returning the submission instead.'
    };
  }

  const resolved = await resolveRequirementLabel(supabase, submission.target_kind, submission.target_key);
  const { data: ledgerRow, error: ledgerErr } = await supabase
    .from('ledger_entries')
    .insert({
      scout_id: submission.scout_id,
      date: new Date().toISOString().slice(0, 10),
      kind,
      code: submission.target_key,
      label: resolved?.label ?? null,
      by: reviewer,
      qty: 1,
      unit: 'complete',
      notes: 'Approved from a scout/family proof submission (Resource Library).',
      entered_by: reviewer,
      entered_at: new Date().toISOString()
    })
    .select('id')
    .single();
  if (ledgerErr || !ledgerRow) return { error: ledgerErr?.message ?? 'Could not write the ledger entry.' };

  // Guarded on status='pending' — closes most of a two-leaders-approve-at-once
  // race (qa-lead 2026-08-06): the read-then-write duplicate check above can't
  // be fully atomic without a DB transaction, but if a second concurrent call
  // slipped past it, THIS update affects zero rows (the first call already
  // flipped status), so we can detect it and self-heal instead of leaving two
  // ledger rows for the same requirement.
  const { data: updatedSub, error: subErr } = await supabase
    .from('requirement_submissions')
    .update({
      status: 'approved',
      reviewed_by: reviewer,
      reviewed_at: new Date().toISOString(),
      ledger_entry_id: ledgerRow.id
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (subErr) return { error: subErr.message };
  if (!updatedSub) {
    // Lost the race — soft-delete the ledger row we just wrote (same
    // deleted_at/deleted_by/deleted_reason convention as undoCompletion in
    // fast-entry/actions.ts) rather than leaving a duplicate award behind.
    await supabase
      .from('ledger_entries')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: reviewer,
        deleted_reason: 'Automatic: this submission was reviewed by someone else a moment earlier.'
      })
      .eq('id', ledgerRow.id);
    return { error: 'This submission was just reviewed by someone else — refresh the Proof Queue.' };
  }

  return { error: null, ledgerEntryId: ledgerRow.id };
}

/** Returns a submission with feedback — the ledger is never touched. */
export async function returnSubmission(
  supabase: SupabaseClient,
  id: number,
  reviewer: string,
  feedback: string
): Promise<string | null> {
  const { error } = await supabase
    .from('requirement_submissions')
    .update({
      status: 'returned',
      feedback_md: feedback || null,
      reviewed_by: reviewer,
      reviewed_at: new Date().toISOString()
    })
    .eq('id', id);
  return error ? error.message : null;
}

export async function cascadeLibraryReqRename(
  supabase: SupabaseClient,
  source: 'rank' | 'mb',
  parentId: string,
  oldCode: string,
  newCode: string
): Promise<string | null> {
  const targetKind: LibraryTargetKind = source === 'rank' ? 'rank_req' : 'mb_req';
  const oldKey = `${parentId}-${oldCode}`;
  const newKey = `${parentId}-${newCode}`;
  for (const table of ['library_placements', 'requirement_notes', 'requirement_submissions']) {
    const { error } = await supabase
      .from(table)
      .update({ target_key: newKey })
      .eq('target_kind', targetKind)
      .eq('target_key', oldKey);
    if (error) return `${table}: ${error.message}`;
  }
  return null;
}
