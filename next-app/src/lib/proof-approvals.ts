/**
 * Advancement › Approvals (Patrick, 2026-11-15): proof submissions approved in the past two months, read-only.
 *
 * An approved submission leaves the Proof Queue, which only lists pending ones — so an approval looked like a
 * disappearance (Veronica's Life 4, approved by a leader minutes after she filed it). This is the read side of the
 * same `requirement_submissions` rows: who filed it, who approved it and when, and the ledger entry it wrote.
 * No writes here; approve/return stay in lib/library-data.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequirementSubmission } from '@/lib/supabase/types';
import { splitRankReqKey } from '@/lib/library';
import { requirementTargetLabel, resolveRequirementLabel } from '@/lib/library-data';
import { signedProofMediaUrl } from '@/lib/proof-media';

export const APPROVALS_WINDOW_MONTHS = 2;

/** The start of the window: the same instant two months back, clamped to that month's last day. */
export function approvalsCutoff(now: Date): string {
  const d = new Date(now.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - APPROVALS_WINDOW_MONTHS);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString();
}

export interface ApprovalListItem {
  id: number;
  scoutId: string;
  scoutName: string;
  /** "Life — Requirement 4: Six More Hours of Service". */
  requirement: string;
  proofType: RequirementSubmission['proof_type'];
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

type ListRow = Pick<
  RequirementSubmission,
  'id' | 'scout_id' | 'target_kind' | 'target_key' | 'proof_type' | 'created_at' | 'reviewed_by' | 'reviewed_at' | 'ledger_entry_id'
>;

/**
 * Approvals reviewed since the cutoff, newest first. Requirement labels come from the ledger row each approval wrote
 * (it carries the label resolved at approval time), named against the rank / badge maps — one query per table, not
 * one per row.
 */
export async function loadRecentApprovals(sb: SupabaseClient, now: Date = new Date()): Promise<ApprovalListItem[]> {
  const { data, error } = await sb
    .from('requirement_submissions')
    .select('id, scout_id, target_kind, target_key, proof_type, created_at, reviewed_by, reviewed_at, ledger_entry_id')
    .eq('status', 'approved')
    .gte('reviewed_at', approvalsCutoff(now))
    .order('reviewed_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw new Error(`loadRecentApprovals: ${error.message}`);
  const rows = (data ?? []) as ListRow[];
  if (rows.length === 0) return [];

  const scoutIds = [...new Set(rows.map((r) => r.scout_id))];
  const ledgerIds = rows.map((r) => r.ledger_entry_id).filter((id): id is number => id != null);
  const [scoutsRes, ranksRes, mbsRes, ledgerRes] = await Promise.all([
    sb.from('scouts').select('id, display_name').in('id', scoutIds),
    sb.from('ranks').select('id, display_name'),
    sb.from('merit_badges').select('id, name'),
    ledgerIds.length ? sb.from('ledger_entries').select('id, label').in('id', ledgerIds) : Promise.resolve({ data: [] })
  ]);
  const scoutName = new Map(((scoutsRes.data ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s.display_name]));
  const ranks = (ranksRes.data ?? []) as { id: string; display_name: string }[];
  const rankName = new Map(ranks.map((r) => [r.id, r.display_name]));
  const mbs = (mbsRes.data ?? []) as { id: string; name: string }[];
  const ledgerLabel = new Map(((ledgerRes.data ?? []) as { id: number; label: string | null }[]).map((l) => [l.id, l.label]));

  return rows.map((r) => {
    const label = r.ledger_entry_id != null ? (ledgerLabel.get(r.ledger_entry_id) ?? null) : null;
    let requirement = `${r.target_kind === 'rank_req' ? 'Rank requirement' : 'Merit badge requirement'} ${r.target_key}`;
    if (r.target_kind === 'rank_req') {
      const split = splitRankReqKey(r.target_key, ranks.map((x) => x.id));
      if (split) requirement = requirementTargetLabel({ parentId: split.rankId, parentName: rankName.get(split.rankId) ?? split.rankId, code: split.code, label });
    } else {
      const mb = mbs.find((m) => r.target_key.startsWith(`${m.id}-`));
      if (mb) requirement = requirementTargetLabel({ parentId: mb.id, parentName: mb.name, code: r.target_key.slice(mb.id.length + 1), label });
    }
    return {
      id: r.id,
      scoutId: r.scout_id,
      scoutName: scoutName.get(r.scout_id) ?? r.scout_id,
      requirement,
      proofType: r.proof_type,
      submittedAt: r.created_at,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at
    };
  });
}

export interface ApprovalDetail {
  submission: RequirementSubmission;
  scoutName: string;
  requirement: string;
  /** The Library page for the requirement, when the key still names a catalog row. */
  requirementHref: string | null;
  /** Who pressed submit; null on claims filed before that was recorded. */
  submitterName: string | null;
  photoUrls: string[];
  ledger: {
    id: number;
    date: string;
    by: string | null;
    enteredBy: string | null;
    enteredAt: string | null;
    deletedAt: string | null;
    deletedBy: string | null;
    deletedReason: string | null;
  } | null;
}

/** Everything one approval holds. Null when the id is not an approved submission. */
export async function loadApprovalDetail(sb: SupabaseClient, id: number): Promise<ApprovalDetail | null> {
  const { data } = await sb.from('requirement_submissions').select('*').eq('id', id).eq('status', 'approved').maybeSingle();
  if (!data) return null;
  const s = data as RequirementSubmission;

  const [scoutRes, submitterRes, ledgerRes, resolved, photoUrls] = await Promise.all([
    sb.from('scouts').select('display_name').eq('id', s.scout_id).maybeSingle(),
    s.submitted_by_person_id != null
      ? sb.from('people').select('display_name').eq('id', s.submitted_by_person_id).maybeSingle()
      : Promise.resolve({ data: null }),
    s.ledger_entry_id != null
      ? sb.from('ledger_entries').select('id, date, by, entered_by, entered_at, deleted_at, deleted_by, deleted_reason').eq('id', s.ledger_entry_id).maybeSingle()
      : Promise.resolve({ data: null }),
    resolveRequirementLabel(sb, s.target_kind, s.target_key),
    Promise.all(((s.media ?? []) as { path: string }[]).map((m) => signedProofMediaUrl(sb, m.path)))
  ]);

  const l = ledgerRes.data as {
    id: number; date: string; by: string | null; entered_by: string | null; entered_at: string | null;
    deleted_at: string | null; deleted_by: string | null; deleted_reason: string | null;
  } | null;

  return {
    submission: s,
    scoutName: (scoutRes.data as { display_name: string } | null)?.display_name ?? s.scout_id,
    requirement: resolved
      ? requirementTargetLabel(resolved)
      : `${s.target_kind === 'rank_req' ? 'Rank requirement' : 'Merit badge requirement'} ${s.target_key}`,
    requirementHref: resolved
      ? s.target_kind === 'rank_req'
        ? `/library/rank/${resolved.parentId}/${encodeURIComponent(resolved.code)}`
        : `/library/mb/${resolved.parentId}`
      : null,
    submitterName: (submitterRes.data as { display_name: string } | null)?.display_name ?? null,
    photoUrls: photoUrls.filter((u): u is string => !!u),
    ledger: l
      ? {
          id: l.id,
          date: l.date,
          by: l.by,
          enteredBy: l.entered_by,
          enteredAt: l.entered_at,
          deletedAt: l.deleted_at,
          deletedBy: l.deleted_by,
          deletedReason: l.deleted_reason
        }
      : null
  };
}
