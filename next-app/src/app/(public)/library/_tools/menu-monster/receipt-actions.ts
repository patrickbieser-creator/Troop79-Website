'use server';

/**
 * Receipt — the writes (Plans/Menu-Monster-Receipt-Reconciliation.md). Whoever may record on the menu (menuRecorder:
 * the owner, any signed-in scout on an outing's menu, a leader) settles a receipt line one at a time:
 *
 *   - confirm: the line becomes an item on the chosen food's "What we bought" line (receipt-bought.ts);
 *   - not on the plan: the line stays on the receipt as an extra on a chosen meal (reconcile.ts adds it there);
 *   - set aside / reopen: back off the bought line, if it had contributed to one.
 * The receipt line keeps the printed name; no brand or package is made from a receipt abbreviation.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { recordAuditAs } from '@/lib/audit';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { resolveMenuAliases } from '@/lib/menu-monster/menus';
import { buildMenuList } from '@/lib/menu-monster/menu-view';
import { redactMenu } from '@/lib/menu-monster/menu-access';
import { onChecklist, type Bought } from '@/lib/menu-monster/bought';
import { loadBoughtWith, setBoughtLineWith } from '@/lib/menu-monster/bought-store';
import { loadReceiptWith, setReceiptLineWith } from '@/lib/menu-monster/receipt-store';
import type { Receipt, ReceiptLine } from '@/lib/menu-monster/reconcile';
import { addItem, receiptItem, removeItem } from '@/lib/menu-monster/receipt-bought';
import { cleanScoutText } from '@/lib/menu-monster/scout-text';
import { menuRecorder } from '../../menu-monster/menus/_components/scout-menus';

type Fail = { ok: false; error: string };
type Done = { ok: true; receipt: Receipt; bought: Bought };

const NOT_ALLOWED = 'Sign in as a scout on this outing to settle the receipt.';
const BAD = 'That line can’t be saved. Reload the page and try again.';
const GONE = 'That receipt line is gone. Reload the page.';
const FULL = 'That food already has as many purchases as a line can hold. Take one off in What we bought first.';

type Who = NonNullable<Awaited<ReturnType<typeof menuRecorder>>>;
type Ctx = { who: Who; sb: ReturnType<typeof createAdminClient>; receipt: Receipt; line: ReceiptLine };

async function context(menuId: unknown, lineId: unknown): Promise<Ctx | Fail> {
  if (typeof menuId !== 'string' || typeof lineId !== 'number' || !Number.isInteger(lineId)) return { ok: false, error: BAD };
  const who = await menuRecorder(menuId);
  if (!who) return { ok: false, error: NOT_ALLOWED };
  const sb = createAdminClient();
  const receipt = await loadReceiptWith(sb, menuId);
  const line = receipt?.lines.find((l) => l.id === lineId);
  if (!receipt || !line) return { ok: false, error: GONE };
  return { who, sb, receipt, line };
}

/** Take back what a settled line put on the bought record (a confirmed line only; an extra or set-aside one put nothing there). */
async function release(c: Ctx): Promise<void> {
  const { line, who, sb } = c;
  if (line.status !== 'confirmed' || !line.ingredientId) return;
  const bought = await loadBoughtWith(sb, who.stored.id);
  const next = removeItem(bought.lines[line.ingredientId], line.id);
  if (next === 'same') return;
  await setBoughtLineWith(sb, who.stored.id, line.ingredientId, next, who);
}

async function finish(c: Ctx, summary: string): Promise<Done> {
  const { sb, who } = c;
  await recordAuditAs(sb, { personId: who.personId, label: who.name }, { area: 'menus', action: 'bought', entityType: 'menu', entityId: who.stored.id, summary });
  const [receipt, bought] = await Promise.all([loadReceiptWith(sb, who.stored.id), loadBoughtWith(sb, who.stored.id)]);
  return { ok: true, receipt: receipt ?? c.receipt, bought };
}

const printed = (l: ReceiptLine) => cleanScoutText(l.rawName, 60) || 'a receipt line';

export async function confirmReceiptLineAction(menuId: unknown, lineId: unknown, ingredientId: unknown): Promise<Done | Fail> {
  const c = await context(menuId, lineId);
  if ('error' in c) return c;
  if (typeof ingredientId !== 'string') return { ok: false, error: BAD };
  const { who, sb, line } = c;
  // What this recorder sees is what they may record: the owner's own catalog, everyone else's public one.
  const owner = who.access === 'owner';
  const catalog = await loadMenuMonsterCatalog(owner ? who.stored.ownerPersonId : null);
  const menu = resolveMenuAliases(owner ? who.stored.menu : redactMenu(who.stored.menu, who.access, catalog).menu, catalog.aliases);
  const food = buildMenuList(menu, catalog).lines.filter(onChecklist).find((l) => l.ing.id === ingredientId);
  if (!food) return { ok: false, error: BAD };

  // A full bought line is refused BEFORE the line's earlier contribution is released, so a refusal changes nothing.
  if (addItem((await loadBoughtWith(sb, who.stored.id)).lines[ingredientId], receiptItem(line)) === 'full') return { ok: false, error: FULL };
  await release(c);
  const bought = await loadBoughtWith(sb, who.stored.id);
  const next = addItem(bought.lines[ingredientId], receiptItem(line));
  if (next === 'full') return { ok: false, error: FULL };
  if (!(await setBoughtLineWith(sb, who.stored.id, ingredientId, next, who))) return { ok: false, error: BAD };
  if (!(await setReceiptLineWith(sb, line.id, { status: 'confirmed', ingredientId }, who))) return { ok: false, error: GONE };
  return finish(c, `${who.name} matched "${printed(line)}" to ${food.ing.name} on "${who.stored.menu.name}"`);
}

export async function markReceiptLineExtraAction(menuId: unknown, lineId: unknown, mealId: unknown, label: unknown): Promise<Done | Fail> {
  const c = await context(menuId, lineId);
  if ('error' in c) return c;
  const { who, sb, line } = c;
  if (typeof mealId !== 'string' || !who.stored.menu.meals.some((m) => m.id === mealId)) return { ok: false, error: BAD };
  const name = cleanScoutText(label, 60) || cleanScoutText(line.rawName, 60);
  await release(c);
  if (!(await setReceiptLineWith(sb, line.id, { status: 'extra', mealId, label: name }, who))) return { ok: false, error: GONE };
  return finish(c, `${who.name} placed "${printed(line)}" as an add-on on "${who.stored.menu.name}"`);
}

export async function reopenReceiptLineAction(menuId: unknown, lineId: unknown): Promise<Done | Fail> {
  const c = await context(menuId, lineId);
  if ('error' in c) return c;
  await release(c);
  if (!(await setReceiptLineWith(c.sb, c.line.id, { status: 'pending' }, c.who))) return { ok: false, error: GONE };
  return finish(c, `${c.who.name} reopened "${printed(c.line)}" on "${c.who.stored.menu.name}"`);
}

export async function skipReceiptLineAction(menuId: unknown, lineId: unknown): Promise<Done | Fail> {
  const c = await context(menuId, lineId);
  if ('error' in c) return c;
  await release(c);
  if (!(await setReceiptLineWith(c.sb, c.line.id, { status: 'skipped' }, c.who))) return { ok: false, error: GONE };
  return finish(c, `${c.who.name} set aside "${printed(c.line)}" on "${c.who.stored.menu.name}"`);
}
