/**
 * Receipts — the reads and writes (Plans/Menu-Monster-Receipt-Reconciliation.md; 20261030100000_mm_receipts.sql).
 * Takes a SupabaseClient, always the service role: the mm_* tables have RLS on with zero policies.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanReceiptInput, type Receipt, type ReceiptLine, type ReceiptLineStatus } from './reconcile';
import { cleanScoutText } from './scout-text';

interface ReceiptRow {
  id: string;
  menu_id: string;
  store: string;
  bought_at: string;
  subtotal: number | string;
  tax: number | string;
  total: number | string;
  item_count: number;
}

interface LineRow {
  id: number;
  position: number;
  raw_name: string;
  store_code: string | null;
  unit_price: number | string;
  qty: number;
  tax_code: string | null;
  proposed_ingredient_id: string | null;
  status: ReceiptLineStatus;
  ingredient_id: string | null;
  meal_id: string | null;
  label: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

const LINE_COLUMNS = 'id, position, raw_name, store_code, unit_price, qty, tax_code, proposed_ingredient_id, status, ingredient_id, meal_id, label, confirmed_by, confirmed_at';

const mapLine = (r: LineRow): ReceiptLine => ({
  id: r.id,
  position: r.position,
  rawName: r.raw_name,
  storeCode: r.store_code,
  unitPrice: Number(r.unit_price),
  qty: r.qty,
  taxCode: r.tax_code,
  proposedIngredientId: r.proposed_ingredient_id,
  status: r.status,
  ingredientId: r.ingredient_id,
  mealId: r.meal_id,
  label: r.label,
  confirmedBy: r.confirmed_by,
  confirmedAt: r.confirmed_at
});

/** The menu's latest receipt with its lines in printed order; null when it has none. */
export async function loadReceiptWith(sb: SupabaseClient, menuId: string): Promise<Receipt | null> {
  const { data, error } = await sb
    .from('mm_receipts')
    .select('id, menu_id, store, bought_at, subtotal, tax, total, item_count')
    .eq('menu_id', menuId)
    .order('bought_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`receipt: ${error.message}`);
  if (!data) return null;
  const r = data as ReceiptRow;
  const { data: lines, error: lineErr } = await sb.from('mm_receipt_lines').select(LINE_COLUMNS).eq('receipt_id', r.id).order('position', { ascending: true });
  if (lineErr) throw new Error(`receipt lines: ${lineErr.message}`);
  return {
    id: r.id,
    menuId: r.menu_id,
    store: r.store,
    boughtAt: r.bought_at,
    subtotal: Number(r.subtotal),
    tax: Number(r.tax),
    total: Number(r.total),
    itemCount: r.item_count,
    lines: ((lines ?? []) as LineRow[]).map(mapLine)
  };
}

/** True when the menu has a receipt: one cheap read for the step strip. */
export async function hasReceiptWith(sb: SupabaseClient, menuId: string): Promise<boolean> {
  const { count, error } = await sb.from('mm_receipts').select('id', { count: 'exact', head: true }).eq('menu_id', menuId);
  if (error) throw new Error(`receipt: ${error.message}`);
  return (count ?? 0) > 0;
}

/** The id of the menu's receipt bought at this instant, if there is one (the import refuses to run twice). */
export async function findReceiptWith(sb: SupabaseClient, menuId: string, boughtAt: string): Promise<string | null> {
  const { data, error } = await sb.from('mm_receipts').select('id, bought_at').eq('menu_id', menuId);
  if (error) throw new Error(`receipt: ${error.message}`);
  const at = new Date(boughtAt).getTime();
  const hit = ((data ?? []) as { id: string; bought_at: string }[]).find((r) => new Date(r.bought_at).getTime() === at);
  return hit?.id ?? null;
}

/** Stores a receipt and its lines (two inserts); returns the receipt id. Throws on invalid input. */
export async function insertReceiptWith(sb: SupabaseClient, input: unknown, createdByPersonId: number | null): Promise<string> {
  const c = cleanReceiptInput(input);
  const { data, error } = await sb
    .from('mm_receipts')
    .insert({
      menu_id: c.menuId, store: c.store, bought_at: c.boughtAt, subtotal: c.subtotal, tax: c.tax, total: c.total,
      item_count: c.itemCount, source: c.source, note: c.note, created_by_person_id: createdByPersonId
    })
    .select('id')
    .single();
  if (error) throw new Error(`receipt: ${error.message}`);
  const id = (data as { id: string }).id;
  const { error: lineErr } = await sb.from('mm_receipt_lines').insert(
    c.lines.map((l, i) => ({
      receipt_id: id, position: i + 1, raw_name: l.rawName, store_code: l.storeCode, unit_price: l.unitPrice, qty: l.qty,
      tax_code: l.taxCode, proposed_ingredient_id: l.proposedIngredientId, note: l.note
    }))
  );
  if (lineErr) {
    // No half receipt: the lines are the point.
    await sb.from('mm_receipts').delete().eq('id', id);
    throw new Error(`receipt lines: ${lineErr.message}`);
  }
  return id;
}

export interface ReceiptLinePatch {
  status: ReceiptLineStatus;
  ingredientId?: string | null;
  mealId?: string | null;
  label?: string | null;
}

/**
 * Settles (or reopens) one line. confirmed / extra / skipped stamp who and when; back to pending clears the
 * stamp and the choice. False when the line is gone or the status is not one we know.
 */
export async function setReceiptLineWith(
  sb: SupabaseClient,
  lineId: number,
  patch: ReceiptLinePatch,
  who: { personId: number | null; name: string }
): Promise<boolean> {
  const settled = patch.status !== 'pending';
  if (!['pending', 'confirmed', 'extra', 'skipped'].includes(patch.status)) return false;
  const row = {
    status: patch.status,
    ingredient_id: settled && patch.status !== 'skipped' ? (patch.ingredientId ?? null) : null,
    meal_id: patch.status === 'extra' ? (patch.mealId ?? null) : null,
    label: patch.status === 'extra' ? cleanScoutText(patch.label, 60) || null : null,
    confirmed_by: settled ? cleanScoutText(who.name, 60) || null : null,
    confirmed_by_person_id: settled ? who.personId : null,
    confirmed_at: settled ? new Date().toISOString() : null
  };
  const { data, error } = await sb.from('mm_receipt_lines').update(row).eq('id', lineId).select('id');
  if (error) throw new Error(`receipt line: ${error.message}`);
  return (data ?? []).length > 0;
}
