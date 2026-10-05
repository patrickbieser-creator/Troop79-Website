/**
 * Menu Monster price history: the store half of Phase 2 release B
 * (Plans/Menu-Monster-Scout-Workspace.md, "Phase 2 design").
 *
 * `*With(supabase)` style so the db tests run against the local database. The
 * writes go through mm_report_price / mm_decide_price (one transaction each,
 * the package row locked); this file maps their text results, writes the audit
 * row, and reads the two leader lists. Audit rows go under area `library`;
 * summaries name people and the package, never a price (D-257), so the
 * values live in `details`. The audit recorder is injected: a scout's report
 * passes `recordAuditAs(supabase, actor, …)`, a leader's decision passes
 * `recordAudit`.
 *
 * History is always read filtered and limited, never whole (1000-row cap):
 * the held list is small by nature and paginates; recent changes take a limit.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditDetail, AuditEntry } from '@/lib/audit';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { publicScoutName } from '@/lib/scout-name';
import { PRICE_BAND, unitPrice } from './price-band';

export type AuditRecorder = (entry: AuditEntry) => Promise<void>;

export type ReportOutcome = 'same' | 'applied' | 'held' | 'invalid' | 'missing';
export type Decision = 'apply' | 'dismiss' | 'revert';
export type DecideOutcome = 'applied' | 'dismissed' | 'reverted' | 'superseded' | 'not_held' | 'not_applied' | 'missing';

const money = (n: number) => `$${Number(n).toFixed(2)}`;

interface PersonRow {
  first_name: string;
  last_name: string;
}

/** "Sam K." — the one short-name format scout names take (lib/scout-name). */
export async function shortNameWith(supabase: SupabaseClient, personId: number): Promise<string> {
  const { data } = await supabase.from('people').select('first_name, last_name').eq('id', personId).maybeSingle();
  return data ? publicScoutName(data as PersonRow) : 'Someone';
}

/* ── Writes ──────────────────────────────────────────────────────────────── */

export interface ReportInput {
  packageId: string;
  newPrice: number;
  reportedBy: number;
  menuId?: string | null;
}

export async function reportPriceWith(
  supabase: SupabaseClient,
  input: ReportInput,
  record: AuditRecorder
): Promise<ReportOutcome> {
  const { data: before } = await supabase.from('mm_packages').select('name, price').eq('id', input.packageId).maybeSingle();
  const { data, error } = await supabase.rpc('mm_report_price', {
    p_package_id: input.packageId,
    p_new_price: input.newPrice,
    p_reported_by: input.reportedBy,
    p_menu_id: input.menuId ?? null,
    p_band: PRICE_BAND
  });
  if (error) throw new Error(error.message);
  const outcome = data as ReportOutcome;
  if ((outcome === 'applied' || outcome === 'held') && before) {
    const who = await shortNameWith(supabase, input.reportedBy);
    const name = (before as { name: string }).name;
    await record({
      area: 'library',
      action: outcome === 'applied' ? 'price_report' : 'price_hold',
      entityType: 'mm_package',
      entityId: input.packageId,
      summary:
        outcome === 'applied'
          ? `${who} reported a new price for Menu Monster package "${name}"`
          : `${who} reported a price for Menu Monster package "${name}" that is held for a leader`,
      details: [{ field: 'Price', from: money((before as { price: number }).price), to: money(input.newPrice) }],
      subjects: [input.reportedBy]
    });
  }
  return outcome;
}

export interface DecideInput {
  historyId: string;
  decision: Decision;
  decidedBy: number;
}

const DECISION_VERB: Record<'applied' | 'dismissed' | 'reverted', { action: string; verb: string }> = {
  applied: { action: 'price_apply', verb: 'Applied' },
  dismissed: { action: 'price_dismiss', verb: 'Dismissed' },
  reverted: { action: 'price_revert', verb: 'Reverted' }
};

export async function decidePriceWith(
  supabase: SupabaseClient,
  input: DecideInput,
  record: AuditRecorder
): Promise<DecideOutcome> {
  const { data: row } = await supabase
    .from('mm_price_history')
    .select('package_id, old_price, new_price, reported_by_person_id, mm_packages(name)')
    .eq('id', input.historyId)
    .maybeSingle();
  const { data, error } = await supabase.rpc('mm_decide_price', {
    p_history_id: input.historyId,
    p_decision: input.decision,
    p_decided_by: input.decidedBy
  });
  if (error) throw new Error(error.message);
  const outcome = data as DecideOutcome;
  if ((outcome === 'applied' || outcome === 'dismissed' || outcome === 'reverted') && row) {
    const r = row as unknown as {
      package_id: string; old_price: number; new_price: number; reported_by_person_id: number;
      mm_packages: { name: string } | { name: string }[] | null;
    };
    const pkgName = (Array.isArray(r.mm_packages) ? r.mm_packages[0]?.name : r.mm_packages?.name) ?? r.package_id;
    const who = await shortNameWith(supabase, r.reported_by_person_id);
    const details: AuditDetail[] =
      outcome === 'reverted'
        ? [{ field: 'Price', from: money(r.new_price), to: money(r.old_price) }]
        : outcome === 'applied'
          ? [{ field: 'Price', from: money(r.old_price), to: money(r.new_price) }]
          : [{ field: 'Proposed price', from: money(r.new_price), to: 'Not applied' }];
    const { action, verb } = DECISION_VERB[outcome];
    await record({
      area: 'library',
      action,
      entityType: 'mm_package',
      entityId: r.package_id,
      summary: `${verb} ${who}'s reported price for Menu Monster package "${pkgName}"`,
      details,
      subjects: [r.reported_by_person_id]
    });
  }
  return outcome;
}

/**
 * The leader's own price-book edit (mm_leader_set_price): in one transaction
 * with the package row locked it sets price + as_of, moves the band anchor to
 * the new price and writes the `applied` history row (leader as reporter and
 * decider), so a thrown error never leaves a changed price without history.
 * Same cents -> only as_of and the anchor, no history row.
 */
export type LeaderSetOutcome = 'applied' | 'same' | 'invalid' | 'missing';

export async function leaderSetPriceWith(
  supabase: SupabaseClient,
  input: { packageId: string; newPrice: number; asOf: string | null; leaderId: number }
): Promise<LeaderSetOutcome> {
  const { data, error } = await supabase.rpc('mm_leader_set_price', {
    p_package_id: input.packageId,
    p_new_price: input.newPrice,
    p_as_of: input.asOf,
    p_leader: input.leaderId
  });
  if (error) throw new Error(error.message);
  return data as LeaderSetOutcome;
}

/* ── Reads ───────────────────────────────────────────────────────────────── */

type One<T> = T | T[] | null;
const first = <T>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

interface JoinedRow {
  id: string;
  package_id: string;
  old_price: number;
  new_price: number;
  status: 'applied' | 'held' | 'reverted' | 'dismissed';
  created_at: string;
  decided_at: string | null;
  mm_packages: One<{ name: string; price: number; yield: number | null; ingredient_id?: string }>;
  people: One<PersonRow>;
  mm_menus: One<{ name: string }>;
}

const JOIN =
  'id, package_id, old_price, new_price, status, created_at, decided_at, ' +
  'mm_packages(name, price, yield, ingredient_id), people!reported_by_person_id(first_name, last_name), mm_menus(name)';

export interface HeldPrice {
  id: string;
  packageId: string;
  packageName: string;
  reporter: string;
  menuName: string | null;
  createdAt: string;
  currentPrice: number;
  proposedPrice: number;
  /** Unit-price change against the package's current price; null when the package has no usable yield. */
  unitChangePct: number | null;
}

export interface PriceChange {
  id: string;
  status: 'applied' | 'reverted';
  packageId: string;
  packageName: string;
  /** The package's ingredient — where Edit opens the Price book. */
  ingredientId: string | null;
  reporter: string;
  oldPrice: number;
  newPrice: number;
  createdAt: string;
  decidedAt: string | null;
  /** Applied and the package still carries this row's new price. */
  canRevert: boolean;
}

function reporterOf(r: JoinedRow): string {
  const p = first(r.people);
  return p ? publicScoutName(p) : 'Someone';
}

export async function listHeldWith(supabase: SupabaseClient): Promise<HeldPrice[]> {
  const rows = await fetchAllRows<JoinedRow>((from, to) =>
    supabase
      .from('mm_price_history')
      .select(JOIN)
      .eq('status', 'held')
      .order('created_at', { ascending: false })
      .range(from, to) as unknown as PromiseLike<{ data: JoinedRow[] | null; error: { message: string } | null }>
  );
  return rows.map((r) => {
    const pkg = first(r.mm_packages);
    const current = Number(pkg?.price ?? r.old_price);
    const y = pkg?.yield == null ? null : Number(pkg.yield);
    const cur = unitPrice({ price: current, yield: y });
    const next = unitPrice({ price: Number(r.new_price), yield: y });
    return {
      id: r.id,
      packageId: r.package_id,
      packageName: pkg?.name ?? r.package_id,
      reporter: reporterOf(r),
      menuName: first(r.mm_menus)?.name ?? null,
      createdAt: r.created_at,
      currentPrice: current,
      proposedPrice: Number(r.new_price),
      unitChangePct: cur != null && next != null && cur > 0 ? (next - cur) / cur : null
    };
  });
}

/** The changes nobody has acknowledged yet (2026-10-05), newest first. */
export async function listRecentChangesWith(supabase: SupabaseClient, limit = 50): Promise<PriceChange[]> {
  const { data, error } = await supabase
    .from('mm_price_history')
    .select(JOIN)
    .in('status', ['applied', 'reverted'])
    .is('acknowledged_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as JoinedRow[]).map((r) => {
    const pkg = first(r.mm_packages);
    return {
      id: r.id,
      status: r.status as 'applied' | 'reverted',
      packageId: r.package_id,
      packageName: pkg?.name ?? r.package_id,
      ingredientId: pkg?.ingredient_id ?? null,
      reporter: reporterOf(r),
      oldPrice: Number(r.old_price),
      newPrice: Number(r.new_price),
      createdAt: r.created_at,
      decidedAt: r.decided_at,
      canRevert: r.status === 'applied' && pkg != null && Math.round(Number(pkg.price) * 100) === Math.round(Number(r.new_price) * 100)
    };
  });
}

/** A leader has seen this change: it leaves the Price changes list. False when the row is gone or already acknowledged. */
export async function acknowledgePriceChangeWith(supabase: SupabaseClient, historyId: string, byPersonId: number | null): Promise<boolean> {
  const { data, error } = await supabase
    .from('mm_price_history')
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by_person_id: byPersonId })
    .eq('id', historyId)
    .is('acknowledged_at', null)
    .in('status', ['applied', 'reverted'])
    .select('id');
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}
