/**
 * Home's data (Plans/Completed/Admin-Portal-Nav.md decisions 5–6, phase 4): This week, Your shortcuts, the Reports shelf and At a
 * glance. The three advancement cards load separately (advancement-cards.tsx) inside their own Suspense, so none of
 * this waits on them. Server only; every loader takes the service-role client and the caller decides who sees what.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { centralToday } from '@/lib/dates';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { loadAdminSale } from '@/lib/wreaths/admin-data';
import { loadUpcomingMeetings, type BoardMeeting } from '@/lib/meeting-board';
import { loadMissingBsaIds } from '@/lib/missing-bsa-ids';
import type { Feature } from '../_components/feature-registry';
import { AREA_LABELS } from '../_components/area-menu';

const cents = (n: number | string | null | undefined) => Math.round(Number(n ?? 0) * 100);

// ── This week ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ComingUp {
  id: number;
  date: string;
  title: string;
}

export interface ThisWeek {
  meeting: BoardMeeting | null;
  comingUp: ComingUp[];
}

/**
 * The next troop meeting that is actually held (a "No Troop Meeting" entry is closed and is skipped: it stays in
 * Coming up), and the next three published calendar entries after today that are not it.
 */
export async function loadThisWeek(sb: SupabaseClient, today: string = centralToday()): Promise<ThisWeek> {
  const [meeting, { data, error }] = await Promise.all([
    loadUpcomingMeetings(sb, 4, today)
      .then((ms) => ms.find((m) => !m.closed) ?? null)
      .catch(() => null),
    sb
      .from('calendar_entries')
      .select('id, entry_date, title')
      .eq('status', 'published')
      .gte('entry_date', today)
      .order('entry_date')
      .order('id')
      .limit(4)
  ]);
  if (error) throw new Error(`calendar read failed: ${error.message}`);
  const rows = ((data ?? []) as { id: number; entry_date: string; title: string }[]).filter((r) => r.id !== meeting?.entryId);
  return { meeting, comingUp: rows.slice(0, 3).map((r) => ({ id: r.id, date: r.entry_date, title: r.title })) };
}

// ── Your shortcuts ────────────────────────────────────────────────────────────────────────────────────────────────────

export const SHORTCUT_LIMIT = 6;

export interface Shortcut {
  key: string;
  label: string;
  href: string;
  /** The group it belongs to: "Advancement". */
  area: string;
  /** Pinned, or how many times it was opened in the past 30 days. */
  pinned: boolean;
  opens: number;
}

/** Pins first, in their order, then the most-opened items the person can still open, up to SHORTCUT_LIMIT. */
export function shortcuts(visible: readonly Feature[], pinKeys: readonly string[], opened: readonly { key: string; count: number }[]): Shortcut[] {
  const byKey = new Map(visible.filter((f) => f.key !== 'home').map((f) => [f.key, f]));
  const out: Shortcut[] = [];
  const seen = new Set<string>();
  for (const k of pinKeys) {
    const f = byKey.get(k);
    if (!f || seen.has(k)) continue;
    seen.add(k);
    out.push({ key: k, label: f.label, href: f.href, area: AREA_LABELS[f.area], pinned: true, opens: 0 });
  }
  for (const o of opened) {
    if (out.length >= SHORTCUT_LIMIT) break;
    const f = byKey.get(o.key);
    if (!f || seen.has(o.key)) continue;
    seen.add(o.key);
    out.push({ key: o.key, label: f.label, href: f.href, area: AREA_LABELS[f.area], pinned: false, opens: o.count });
  }
  return out.slice(0, SHORTCUT_LIMIT);
}

// ── Reports shelf ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const SHELF_LIMIT = 8;

export function reportsShelf(visible: readonly Feature[]): { items: { key: string; label: string; href: string }[]; total: number } {
  const reports = visible.filter((f) => f.kind === 'report');
  return { items: reports.slice(0, SHELF_LIMIT).map((f) => ({ key: f.key, label: f.label, href: f.href })), total: reports.length };
}

// ── At a glance ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** The troop account: checking + savings, the Financial Ledger's "Total funds". */
export async function loadTroopFunds(sb: SupabaseClient): Promise<number> {
  const { data, error } = await sb.rpc('finance_balances', {});
  if (error) throw new Error(`finance_balances failed: ${error.message}`);
  const c = ((data ?? []) as { account: string; balance_cents: number }[])
    .filter((g) => g.account === 'checking' || g.account === 'savings')
    .reduce((n, g) => n + Number(g.balance_cents), 0);
  return c / 100;
}

export interface Uncollected {
  wreaths: number;
  events: number;
  total: number;
}

/**
 * Money still owed to the troop (decision 6 + 10): unpaid wreath orders on the current sale, plus every event sign-up
 * entry with a balance left, past events included.
 */
export async function loadUncollected(sb: SupabaseClient): Promise<Uncollected> {
  const wreathRowsOf = async () => {
    const sale = await loadAdminSale(sb);
    if (!sale) return [];
    return fetchAllRows<{ total: number | string }>((from, to) =>
      sb.from('wreath_orders').select('total').eq('sale_id', sale.id).eq('status', 'placed').eq('payment_status', 'unpaid').order('id').range(from, to)
    );
  };
  // An entry marked Not going still owes unless its amount was set to Not paying (D-489: "Not going ≠ Not paying"),
  // so every entry with a balance counts, past events included (decision 10). Credits never offset another entry.
  const [wreathRows, eventRows] = await Promise.all([
    wreathRowsOf(),
    fetchAllRows<{ balance: number | string }>((from, to) =>
      sb.from('signup_entry_balances').select('balance').gt('balance', 0).order('entry_id').range(from, to)
    )
  ]);
  return uncollectedTotals(wreathRows, eventRows);
}

/** Pure: sums in cents. */
export function uncollectedTotals(wreathRows: readonly { total: number | string }[], eventRows: readonly { balance: number | string }[]): Uncollected {
  const w = wreathRows.reduce((n, r) => n + cents(r.total), 0);
  const e = eventRows.reduce((n, r) => n + Math.max(0, cents(r.balance)), 0);
  return { wreaths: w / 100, events: e / 100, total: (w + e) / 100 };
}

/** One tile's value, or the fact that it couldn't be read (shown in place, never as a silently missing tile). */
export type Tile<T> = { ok: true; value: T } | { ok: false };

async function settle<T>(p: Promise<T>, what: string): Promise<Tile<T>> {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    console.error(`[home] ${what}:`, e instanceof Error ? e.message : e);
    return { ok: false };
  }
}

export interface Glance {
  /** Active scouts and Missing BSA IDs come from one read, so the two can never disagree. */
  people: Tile<{ activeScouts: number; missingScouts: number; missingLeaders: number }>;
  /** Null when the person holds neither finance.manage nor finance.view. */
  troopFunds: Tile<number> | null;
  /** Null without finance.manage. */
  uncollected: Tile<Uncollected> | null;
}

/** Each tile loads on its own; one failing never hides the others. The finance loaders never run for anyone else. */
export async function loadGlance(sb: SupabaseClient, can: { financeView: boolean; financeManage: boolean }): Promise<Glance> {
  const [people, troopFunds, uncollected] = await Promise.all([
    settle(
      loadMissingBsaIds(sb).then((m) => ({ activeScouts: m.activeScouts, missingScouts: m.scouts.length, missingLeaders: m.leaders.length })),
      'active scouts and missing BSA IDs'
    ),
    can.financeView || can.financeManage ? settle(loadTroopFunds(sb), 'troop account') : Promise.resolve(null),
    can.financeManage ? settle(loadUncollected(sb), 'uncollected funds') : Promise.resolve(null)
  ]);
  return { people, troopFunds, uncollected };
}
