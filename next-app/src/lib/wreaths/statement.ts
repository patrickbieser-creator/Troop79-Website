/**
 * The family Statement (Members › My wreath orders › Statement, Patrick 2026-10-19): the Reconciliation's section for
 * ONE scout, built by the same buildReconciliation from that scout's own credited orders only — so a family payload
 * never holds another scout's orders or customers. Server-only (the scope reads the session).
 *
 * Who may see a scout's statement (resolveStatementScope + canViewStatement):
 *   - a family: the scouts in its own scope (resolveFamilyScope: an adult's children, a scout themself);
 *   - a finance.manage super user: every active wreath seller too (resolveScoutEntryViewer's W-4 widening);
 *   - the read-only Members proxy (`?viewScout=`, library.proxy_view): the chosen scout's household, as on
 *     /member/wreaths itself.
 * Every scope is re-derived from the session on each request; the scout id in the URL only picks within it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadProxyFamily, resolveMemberViewer } from '@/lib/member-viewer';
import { loadAdminItems, loadAdminOrders, loadAdminSale, type AdminSeller } from './admin-data';
import { buildReconciliation, type ReconSection, type Reconciliation } from './reconciliation';
import { resolveScoutEntryViewer } from './scout-entry-viewer';

export interface StatementScope {
  scope: number[];
  /** Set when a leader is viewing as a family (read-only proxy); links carry it on. */
  proxyPersonId: number | null;
}

/** The people whose statements this request may see, or null when nobody is signed in. */
export async function resolveStatementScope(sb: SupabaseClient, viewScout?: string): Promise<StatementScope | null> {
  const viewer = await resolveMemberViewer(sb, viewScout);
  if (viewer.kind === 'proxy') return { scope: (await loadProxyFamily(viewer.personId)).personIds, proxyPersonId: viewer.personId };
  if (viewer.kind === 'proxy-available') return null;
  const entry = await resolveScoutEntryViewer(sb);
  return entry ? { scope: entry.scope, proxyPersonId: null } : null;
}

/** The one authorization rule: the scout must be in the request's own scope. */
export function canViewStatement(scope: StatementScope | null, personId: number): boolean {
  return !!scope && Number.isInteger(personId) && scope.scope.includes(personId);
}

export interface ScoutStatement {
  year: number;
  settings: Reconciliation['settings'];
  name: string;
  /** null when the scout has no orders yet. */
  section: ReconSection | null;
}

/**
 * One scout's statement in the current sale (`saleId` pins one), or null when the scout is not a seller in it or the
 * sale is still a draft (families see nothing until it opens). The caller has already checked canViewStatement.
 */
export async function loadScoutStatement(sb: SupabaseClient, personId: number, saleId?: number): Promise<ScoutStatement | null> {
  const sale = await loadAdminSale(sb, saleId);
  if (!sale || sale.status === 'draft') return null;
  const { data } = await sb.from('wreath_sellers').select('id, person_id, slug, active, goal, delivery_message, people:person_id(display_name)').eq('sale_id', sale.id).eq('person_id', personId).maybeSingle();
  const row = data as { id: number; person_id: number; slug: string | null; active: boolean; goal: number | null; delivery_message: string | null; people: { display_name: string } | { display_name: string }[] | null } | null;
  if (!row) return null;
  const name = (Array.isArray(row.people) ? row.people[0] : row.people)?.display_name ?? `Scout ${personId}`;
  const seller: AdminSeller = { id: row.id, personId, name, slug: row.slug, active: row.active, orders: 0, goal: row.goal, deliveryMessage: row.delivery_message };
  // Credited to this scout only: an order they merely deliver belongs to another scout's account.
  const orders = (await loadAdminOrders(sb, sale.id, { involving: [personId] })).filter((o) => o.creditedPersonId === personId);
  const r = buildReconciliation({ orders, sellers: [seller], items: await loadAdminItems(sb, sale.id), sale });
  return { year: r.year, settings: r.settings, name, section: r.sections.find((s) => s.personId === personId) ?? null };
}
