/**
 * Imports a store receipt for a Menu Monster menu (Plans/Menu-Monster-Receipt-Reconciliation.md).
 *
 * Run: npm run import-receipt -- <path-to-json>
 *
 * JSON input shape: see scripts/receipts/2026-10-08-aldi-high-cliff.json
 *   { menuId, store, boughtAt, subtotal, tax, total, itemCount, source, note,
 *     lines: [ { code, name, price, qty, tax, proposed: "<ingredient NAME>" | null, note? } ] }
 *
 * Each line's `proposed` NAME is resolved to an ingredient id by an exact, case-insensitive match against the
 * catalog. Any name that does not resolve stops the import (nothing is guessed). Importing the same menu +
 * boughtAt twice is refused. Writes to whatever NEXT_PUBLIC_SUPABASE_URL points at (.env.local by default):
 * the host is printed first. Uses the SERVICE ROLE key — only run server-side.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadCatalogWith } from '../src/lib/menu-monster/catalog';
import { findReceiptWith, insertReceiptWith } from '../src/lib/menu-monster/receipt-store';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:44321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface InputLine {
  code?: string;
  name: string;
  price: number;
  qty: number;
  tax?: string;
  proposed?: string | null;
  note?: string;
}

interface Input {
  menuId: string;
  store: string;
  boughtAt: string;
  subtotal: number;
  tax: number;
  total: number;
  itemCount?: number;
  source?: string;
  note?: string;
  lines: InputLine[];
}

async function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) {
    console.error('Usage: npm run import-receipt -- <path-to-json>');
    process.exit(1);
  }
  if (!SERVICE_ROLE_KEY) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is required in .env.local');
    process.exit(1);
  }
  const input = JSON.parse(readFileSync(resolve(jsonPath), 'utf-8')) as Input;
  console.log(`Writing to ${new URL(SUPABASE_URL).host}`);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const existing = await findReceiptWith(sb, input.menuId, input.boughtAt);
  if (existing) {
    console.log(`Already imported: receipt ${existing} (same menu, same boughtAt). Nothing written.`);
    return;
  }

  const catalog = await loadCatalogWith(sb);
  const byName = new Map(catalog.ingredients.map((i) => [i.name.trim().toLowerCase(), i.id]));
  const unresolved = new Set<string>();
  const lines = input.lines.map((l) => {
    let proposedIngredientId: string | null = null;
    if (l.proposed) {
      proposedIngredientId = byName.get(l.proposed.trim().toLowerCase()) ?? null;
      if (!proposedIngredientId) unresolved.add(l.proposed);
    }
    return { storeCode: l.code ?? null, rawName: l.name, unitPrice: l.price, qty: l.qty, taxCode: l.tax ?? null, proposedIngredientId, note: l.note ?? null };
  });
  if (unresolved.size > 0) {
    console.error(`These proposed names match no ingredient (exact, case-insensitive); fix the JSON or the catalog:\n  ${[...unresolved].join('\n  ')}`);
    process.exit(1);
  }

  const id = await insertReceiptWith(sb, { ...input, lines }, null);
  const sum = Math.round(input.lines.reduce((n, l) => n + l.price * l.qty, 0) * 100) / 100;
  console.log(`Receipt ${id}: ${input.lines.length} lines, sum of lines ${sum.toFixed(2)}, ${sum === input.subtotal ? 'equals' : `DOES NOT equal (${input.subtotal.toFixed(2)})`} the subtotal.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
