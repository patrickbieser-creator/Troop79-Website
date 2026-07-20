'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/require-role';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { createAdminClient } from '@/lib/supabase/server';
import type { LedgerKind } from '@/lib/supabase/types';
import { keyForLedgerRow } from './picker-types';

async function ensureLeader() {
  return requireRole(['leader']);
}

interface EntryToInsert {
  scout_id: string;
  kind: LedgerKind;
  code: string;
  label: string | null;
  unit: string;
  qty?: number;
}

interface SaveResult {
  ok: boolean;
  inserted: number;
  error?: string;
  skipped?: SkippedEntry[];
}

interface SkippedEntry {
  scout_id: string;
  code: string;
  label: string | null;
}

/** One-time/binary kinds — a scout either has this or doesn't, so a repeat
 *  is always a mistake (unlike service_hours, camping_nights, etc., which
 *  are legitimately logged more than once). Only these are deduped. */
const DEDUP_KINDS: ReadonlySet<LedgerKind> = new Set<LedgerKind>([
  'rank_requirement',
  'rank_award',
  'merit_badge_requirement',
  'merit_badge_award'
]);

/** Set of "scout_id kind code" strings already on the active ledger, among
 *  the DEDUP_KINDS present in `items`. Shared by the pre-submit warning
 *  check and the actual insert-time filter below. */
async function queryExistingSet(
  supabase: ReturnType<typeof createAdminClient>,
  items: { scout_id: string; kind: LedgerKind; code: string }[]
): Promise<Set<string>> {
  const candidates = items.filter((it) => DEDUP_KINDS.has(it.kind));
  if (candidates.length === 0) return new Set();

  const scoutIds = Array.from(new Set(candidates.map((it) => it.scout_id)));
  const codes = Array.from(new Set(candidates.map((it) => it.code)));
  const { data } = await supabase
    .from('ledger_active')
    .select('scout_id, kind, code')
    .in('scout_id', scoutIds)
    .in('code', codes)
    .in('kind', Array.from(DEDUP_KINDS));

  return new Set(
    ((data ?? []) as { scout_id: string; kind: string; code: string }[]).map(
      (r) => `${r.scout_id} ${r.kind} ${r.code}`
    )
  );
}

/**
 * Drops any item that's a no-op — the scout already has that exact
 * (kind, code) on the active ledger. Fast Entry's Requirement-First card
 * bulk-signs a requirement across many scouts at once with no per-scout
 * visibility into who already has it (unlike Scout-First, whose picker
 * shows a completed badge and redirects a click to the undo flow instead
 * of re-adding). This is the server-side backstop for both cards, and the
 * only actual guard for Requirement-First's cartesian-product submit.
 */
async function filterOutExisting(
  supabase: ReturnType<typeof createAdminClient>,
  items: EntryToInsert[]
): Promise<{ items: EntryToInsert[]; skipped: SkippedEntry[] }> {
  const existing = await queryExistingSet(supabase, items);
  const keep: EntryToInsert[] = [];
  const skipped: SkippedEntry[] = [];
  for (const it of items) {
    const key = `${it.scout_id} ${it.kind} ${it.code}`;
    if (DEDUP_KINDS.has(it.kind) && existing.has(key)) {
      skipped.push({ scout_id: it.scout_id, code: it.code, label: it.label });
    } else {
      keep.push(it);
    }
  }
  return { items: keep, skipped };
}

/**
 * Pre-submit check for Requirement-First's confirm dialog: which of the
 * about-to-be-created (scout, requirement) pairs already exist, so the
 * leader sees it before clicking Save rather than only from the post-save
 * "N skipped" summary. Read-only -- addLedgerEntries re-checks and filters
 * at submit time regardless, since this list can go stale between opening
 * the dialog and clicking Save.
 */
export async function checkExistingCompletions(formData: FormData): Promise<SkippedEntry[]> {
  try {
    await ensureLeader();
  } catch {
    return [];
  }
  let items: EntryToInsert[];
  try {
    items = JSON.parse(String(formData.get('items') ?? '[]')) as EntryToInsert[];
  } catch {
    return [];
  }
  if (!Array.isArray(items) || items.length === 0) return [];

  const supabase = createAdminClient();
  const existing = await queryExistingSet(supabase, items);
  return items
    .filter((it) => DEDUP_KINDS.has(it.kind) && existing.has(`${it.scout_id} ${it.kind} ${it.code}`))
    .map((it) => ({ scout_id: it.scout_id, code: it.code, label: it.label }));
}

/**
 * Inserts a batch of ledger_entries. Used by both Fast Entry cards:
 *   - Scout-First: one scout, many items
 *   - Requirement-First: one item, many scouts
 *
 * Shared payload shape so a single Server Action covers both.
 */
export async function addLedgerEntries(formData: FormData): Promise<SaveResult> {
  let session;
  try {
    session = await ensureLeader();
  } catch {
    return { ok: false, inserted: 0, error: 'Not authenticated' };
  }

  const date = String(formData.get('date') ?? '').trim();
  const by = String(formData.get('by') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim() || null;
  const itemsJson = String(formData.get('items') ?? '[]');

  if (!date) return { ok: false, inserted: 0, error: 'Date is required' };
  if (!by) return { ok: false, inserted: 0, error: 'Signed-Off By is required' };

  let items: EntryToInsert[];
  try {
    items = JSON.parse(itemsJson) as EntryToInsert[];
  } catch {
    return { ok: false, inserted: 0, error: 'Items payload was malformed' };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, inserted: 0, error: 'No items to save' };
  }

  const supabase = createAdminClient();

  // Drop no-ops (scout already has this exact req/award) before award
  // gating, so a batch that's ENTIRELY already-done doesn't get rejected as
  // "no items to save" further down without explanation, and so gating
  // isn't evaluated against rows that won't actually be written.
  const { items: dedupedItems, skipped } = await filterOutExisting(supabase, items);
  if (dedupedItems.length === 0) {
    // Nothing left to insert, but not an error — every selected item was
    // already signed off. The caller reports this from `skipped`.
    return { ok: true, inserted: 0, skipped };
  }

  // Award gating: for every award row (MB or rank) check the catalog tree is
  // satisfied for that scout, counting both completed (from the ledger) AND
  // the other rows in this same batch (so leaders can save reqs + award in
  // one click).
  const gateErrors = await validateAwardRows(supabase, dedupedItems);
  if (gateErrors.length > 0) {
    const first = gateErrors[0];
    const more = gateErrors.length > 1 ? ` (+${gateErrors.length - 1} more issue${gateErrors.length === 2 ? '' : 's'})` : '';
    return {
      ok: false,
      inserted: 0,
      error: `Can't award ${first.awardLabel} to ${first.scoutId} — req ${first.parentCode} "${first.parentLabel}" is at ${first.satisfied} of ${first.required}.${more}`
    };
  }

  const rows = dedupedItems.map((it) => ({
    scout_id: it.scout_id,
    date,
    kind: it.kind,
    code: it.code,
    label: it.label,
    by,
    qty:
      it.qty != null
        ? it.qty
        : it.kind === 'camping_nights'
          ? 2
          : it.kind === 'service_hours'
            ? 2
            : 1,
    unit: it.unit,
    notes,
    entered_by: session.leader,
    entered_at: new Date().toISOString()
  }));

  const { error } = await supabase.from('ledger_entries').insert(rows);
  if (error) return { ok: false, inserted: 0, error: error.message };

  revalidatePath('/admin/advancement/fast-entry');
  revalidatePath('/admin/advancement/ledger');
  revalidatePath('/admin/advancement/dashboard');
  return { ok: true, inserted: rows.length, skipped };
}

interface AwardGateError {
  awardLabel: string;
  scoutId: string;
  parentCode: string;
  parentLabel: string;
  satisfied: number;
  required: number;
}

interface CatalogReqRow {
  id: number;
  parent_id: number | null;
  code: string;
  label: string;
  complete_rule: 'all' | 'any' | 'n-of';
  complete_n: number | null;
  sort_order: number;
}

interface CatalogReqWithChildren extends CatalogReqRow {
  children: CatalogReqWithChildren[];
}

/**
 * Server-side award-gating validator. For each MB/rank award row in the
 * batch, loads the catalog tree + the scout's already-completed leaf codes
 * (from ledger_active) and checks every top-level parent is satisfied per
 * its complete_rule. Pending non-award rows in this same batch count toward
 * satisfaction.
 */
async function validateAwardRows(
  supabase: ReturnType<typeof createAdminClient>,
  items: EntryToInsert[]
): Promise<AwardGateError[]> {
  const errors: AwardGateError[] = [];
  // Group award rows by scout to minimize queries.
  interface AwardLite {
    scoutId: string;
    kind: 'merit_badge_award' | 'rank_award';
    code: string; // raw ledger code (e.g. 'MB:cooking' or 'tenderfoot')
  }
  const awards: AwardLite[] = [];
  for (const it of items) {
    if (it.kind === 'merit_badge_award' || it.kind === 'rank_award') {
      awards.push({
        scoutId: it.scout_id,
        kind: it.kind,
        code: it.code
      });
    }
  }
  if (awards.length === 0) return [];

  // Track pending leaf codes per scout, drawn from the OTHER (non-award)
  // rows in this same batch.
  const pendingByScout = new Map<string, Set<string>>();
  for (const it of items) {
    if (it.kind === 'merit_badge_requirement' || it.kind === 'rank_requirement') {
      const set = pendingByScout.get(it.scout_id) ?? new Set<string>();
      set.add(it.code); // codes are stored prefixed (e.g. 'cooking-2a' / 'tenderfoot-2c')
      pendingByScout.set(it.scout_id, set);
    }
  }

  // Cache catalog reqs per (mb_id) and per (rank_id).
  const mbTrees = new Map<string, CatalogReqWithChildren[]>();
  const rankTrees = new Map<string, CatalogReqWithChildren[]>();

  async function loadTree(
    table: 'merit_badge_requirements' | 'rank_requirements',
    parentField: 'mb_id' | 'rank_id',
    parentId: string
  ): Promise<CatalogReqWithChildren[]> {
    const { data } = await supabase
      .from(table)
      .select('id, parent_id, code, label, complete_rule, complete_n, sort_order')
      .eq(parentField, parentId)
      .order('sort_order');
    const rows = (data ?? []) as CatalogReqRow[];
    const byParent = new Map<number | null, CatalogReqWithChildren[]>();
    const enriched: CatalogReqWithChildren[] = rows.map((r) => ({ ...r, children: [] }));
    const byId = new Map<number, CatalogReqWithChildren>();
    for (const r of enriched) byId.set(r.id, r);
    for (const r of enriched) {
      const list = byParent.get(r.parent_id) ?? [];
      list.push(r);
      byParent.set(r.parent_id, list);
    }
    // Link children
    for (const r of enriched) {
      r.children = byParent.get(r.id) ?? [];
    }
    return byParent.get(null) ?? [];
  }

  // For each unique scout in awards, load their completed leaf codes once.
  const completedByScout = new Map<string, Set<string>>();
  const uniqueScouts = Array.from(new Set(awards.map((a) => a.scoutId)));
  for (const sid of uniqueScouts) {
    const { data } = await supabase
      .from('ledger_active')
      .select('code, kind')
      .eq('scout_id', sid)
      .in('kind', ['rank_requirement', 'merit_badge_requirement']);
    const set = new Set<string>();
    for (const row of (data ?? []) as { code: string; kind: string }[]) {
      set.add(row.code);
    }
    completedByScout.set(sid, set);
  }

  for (const a of awards) {
    if (a.kind === 'merit_badge_award') {
      const mbId = a.code.startsWith('MB:') ? a.code.slice(3) : a.code;
      let tree = mbTrees.get(mbId);
      if (!tree) {
        tree = await loadTree('merit_badge_requirements', 'mb_id', mbId);
        mbTrees.set(mbId, tree);
      }
      const completed = completedByScout.get(a.scoutId) ?? new Set();
      const pending = pendingByScout.get(a.scoutId) ?? new Set();
      const hasKey = (rawCode: string) =>
        completed.has(`${mbId}-${rawCode}`) || pending.has(`${mbId}-${rawCode}`);
      for (const top of tree) {
        if (!treeSatisfied(top, hasKey)) {
          errors.push({
            awardLabel: `${mbId} merit badge`,
            scoutId: a.scoutId,
            parentCode: top.code,
            parentLabel: top.label,
            satisfied: countTopSat(top, hasKey),
            required: targetN(top)
          });
        }
      }
    } else {
      const rankId = a.code;
      let tree = rankTrees.get(rankId);
      if (!tree) {
        tree = await loadTree('rank_requirements', 'rank_id', rankId);
        rankTrees.set(rankId, tree);
      }
      const completed = completedByScout.get(a.scoutId) ?? new Set();
      const pending = pendingByScout.get(a.scoutId) ?? new Set();
      const hasKey = (rawCode: string) =>
        completed.has(`${rankId}-${rawCode}`) || pending.has(`${rankId}-${rawCode}`);
      for (const top of tree) {
        if (!treeSatisfied(top, hasKey)) {
          errors.push({
            awardLabel: `${rankId} rank`,
            scoutId: a.scoutId,
            parentCode: top.code,
            parentLabel: top.label,
            satisfied: countTopSat(top, hasKey),
            required: targetN(top)
          });
        }
      }
    }
  }
  return errors;
}

function treeSatisfied(
  node: CatalogReqWithChildren,
  hasKey: (code: string) => boolean
): boolean {
  if (node.children.length === 0) return hasKey(node.code);
  const sat = node.children.filter((c) => treeSatisfied(c, hasKey)).length;
  switch (node.complete_rule) {
    case 'all':
      return sat === node.children.length;
    case 'any':
      return sat >= 1;
    case 'n-of':
      return sat >= (node.complete_n ?? 0);
    default:
      return sat === node.children.length;
  }
}

function countTopSat(
  node: CatalogReqWithChildren,
  hasKey: (code: string) => boolean
): number {
  if (node.children.length === 0) return hasKey(node.code) ? 1 : 0;
  return node.children.filter((c) => treeSatisfied(c, hasKey)).length;
}

function targetN(node: CatalogReqWithChildren): number {
  if (node.children.length === 0) return 1;
  if (node.complete_rule === 'any') return 1;
  if (node.complete_rule === 'n-of') return node.complete_n ?? node.children.length;
  return node.children.length;
}

/**
 * Soft-deletes a ledger entry — used when the user clicks an already-
 * completed picker checkbox and provides a reason to undo it.
 */
export async function undoCompletion(formData: FormData): Promise<SaveResult> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, inserted: 0, error: 'Not authenticated' };
  }
  const id = Number(formData.get('id'));
  const reason = String(formData.get('reason') ?? '').trim();
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, inserted: 0, error: 'Invalid entry id' };
  }
  if (!reason) {
    return { ok: false, inserted: 0, error: 'A reason is required to undo' };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('ledger_entries')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: (await getLeaderInitials()) ?? 'admin',
      deleted_reason: reason
    })
    .eq('id', id);
  if (error) return { ok: false, inserted: 0, error: error.message };

  revalidatePath('/admin/advancement/fast-entry');
  revalidatePath('/admin/advancement/ledger');
  revalidatePath('/admin/advancement/dashboard');
  return { ok: true, inserted: 1 };
}

async function getLeaderInitials(): Promise<string | null> {
  const jar = await cookies();
  const session = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  return session?.leader ?? null;
}

/**
 * Returns the scout's existing ledger codes that the picker should mark as
 * "completed". Only rank_requirement / rank_award / merit_badge_award /
 * merit_badge_requirement rows are surfaced — the others aren't picker items.
 *
 * Suppressing the unused warning at the type-level: result keys are stable
 * PickerItem keys; values are { entryId, date, by, code }.
 */
/**
 * Returns the scout's recent history rows (per kind) for the picker's
 * Service / Events / Leadership tabs. Up to 30 most recent rows per kind
 * collapsed by `kind`.
 */
export async function loadScoutHistory(scoutId: string): Promise<{
  service: Array<{ id: number; date: string | null; by: string | null; code: string; label: string | null; qty: number; unit: string }>;
  events: Array<{ id: number; date: string | null; by: string | null; code: string; label: string | null; qty: number; unit: string; kind: string }>;
  leadership: Array<{ id: number; date: string | null; by: string | null; code: string; label: string | null; qty: number; unit: string }>;
}> {
  try {
    await ensureLeader();
  } catch {
    return { service: [], events: [], leadership: [] };
  }
  if (!scoutId) return { service: [], events: [], leadership: [] };
  const supabase = createAdminClient();
  const [svc, ev, ld] = await Promise.all([
    supabase
      .from('ledger_active')
      .select('id, date, by, code, label, qty, unit')
      .eq('scout_id', scoutId)
      .eq('kind', 'service_hours')
      .order('date', { ascending: false, nullsFirst: false })
      .limit(30),
    supabase
      .from('ledger_active')
      .select('id, date, by, code, label, qty, unit, kind')
      .eq('scout_id', scoutId)
      .in('kind', ['camping_nights', 'hiking_miles', 'day_outing', 'fundraiser'])
      .order('date', { ascending: false, nullsFirst: false })
      .limit(30),
    supabase
      .from('ledger_active')
      .select('id, date, by, code, label, qty, unit')
      .eq('scout_id', scoutId)
      .eq('kind', 'leadership')
      .order('date', { ascending: false, nullsFirst: false })
      .limit(30)
  ]);
  return {
    service: (svc.data ?? []) as never,
    events: (ev.data ?? []) as never,
    leadership: (ld.data ?? []) as never
  };
}

export async function loadScoutCompletion(
  scoutId: string
): Promise<Array<{ key: string; entryId: number; date: string | null; by: string | null; code: string }>> {
  try {
    await ensureLeader();
  } catch {
    return [];
  }
  if (!scoutId) return [];
  const supabase = createAdminClient();
  const [{ data, error }, mbIdsRes] = await Promise.all([
    supabase
      .from('ledger_active')
      .select('id, kind, code, date, by')
      .eq('scout_id', scoutId)
      .in('kind', [
        'rank_requirement',
        'rank_award',
        'merit_badge_award',
        'merit_badge_requirement'
      ]),
    supabase.from('merit_badges').select('id')
  ]);
  if (error || !data) return [];
  const mbIds = ((mbIdsRes.data ?? []) as { id: string }[]).map((m) => m.id);
  return data
    .map((row) => {
      const key = keyForLedgerRow({ kind: row.kind, code: row.code, mbIds });
      if (!key) return null;
      return {
        key,
        entryId: row.id,
        date: row.date,
        by: row.by,
        code: row.code
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}
