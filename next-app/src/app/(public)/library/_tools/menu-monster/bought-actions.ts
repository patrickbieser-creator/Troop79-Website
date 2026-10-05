'use server';

/**
 * "What we bought" — the writes (Plans/Menu-Monster-Brands-Gear.md, release 4). Whoever may record on the menu
 * (scout-menus.tsx menuRecorder: the owner, any signed-in scout on an outing's menu, a leader) saves the lines
 * they changed; each line is checked against what the menu actually buys and merged on its own.
 *
 *   - a price for a package the troop already knows is reported to the price book through mm_report_price:
 *     inside the band (±30%, lib/menu-monster/price-band.ts) it applies, outside it waits for a leader;
 *   - "something else" — a brand nobody has listed, with a size and a price — becomes a brand (live at once,
 *     Patrick) and a package (banded against the troop's packages like any scout-added one);
 *   - a line confirmed with no brand named teaches the price book nothing (accepted, Patrick 2026-10-03).
 * The menu always keeps what was recorded, whatever the price book does with it.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { recordAuditAs } from '@/lib/audit';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { resolveMenuAliases } from '@/lib/menu-monster/menus';
import { buildMenuList } from '@/lib/menu-monster/menu-view';
import { redactMenu } from '@/lib/menu-monster/menu-access';
import { MAX_BOUGHT_ITEMS, cleanLineInput, onChecklist, sanitizeItems, type Bought } from '@/lib/menu-monster/bought';
import { loadBoughtWith, setBoughtLineWith, setShoppingDoneWith } from '@/lib/menu-monster/bought-store';
import { addBrandWith } from '@/lib/menu-monster/brands-store';
import { sanitizeScoutPackage } from '@/lib/menu-monster/scout-packages';
import { addScoutPackageWith } from '@/lib/menu-monster/scout-packages-store';
import { reportPriceWith } from '@/lib/menu-monster/price-history';
import { cleanScoutText } from '@/lib/menu-monster/scout-text';
import { menuRecorder } from '../../menu-monster/menus/_components/scout-menus';

type Fail = { ok: false; error: string };
export type LineOutcome = 'saved' | 'applied' | 'held';

const NOT_ALLOWED = 'Sign in as a scout on this outing to record what was bought.';
const BAD = 'Something on this list can’t be saved. Check the prices and try again.';
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Save the lines that changed: ingredient id → { status: 'bought', items } | { status: 'not_bought' } | null
 * (null clears the line back to "not recorded"). An item may carry `newBrand: { name, size, sizeUnit }` in
 * place of a brand and package. Returns each saved line's outcome and the menu's record as it now stands.
 */
export async function saveBoughtAction(menuId: unknown, changes: unknown): Promise<{ ok: true; results: Record<string, LineOutcome>; bought: Bought } | Fail> {
  if (typeof menuId !== 'string' || !isRecord(changes)) return { ok: false, error: BAD };
  const entries = Object.entries(changes);
  if (entries.length === 0 || entries.length > 100 || JSON.stringify(changes).length > 64 * 1024) return { ok: false, error: BAD };
  const who = await menuRecorder(menuId);
  if (!who) return { ok: false, error: NOT_ALLOWED };

  const sb = createAdminClient();
  // What this recorder sees is what they may record: the owner's own catalog, everyone else's public one.
  const owner = who.access === 'owner';
  let catalog = await loadMenuMonsterCatalog(owner ? who.stored.ownerPersonId : null);
  const menu = resolveMenuAliases(owner ? who.stored.menu : redactMenu(who.stored.menu, who.access, catalog).menu, catalog.aliases);
  // Everything the checklist shows can be recorded — a food with no price yet included: its first price comes from here.
  const onList = new Map(buildMenuList(menu, catalog).lines.filter(onChecklist).map((l) => [l.ing.id, l]));
  const before = await loadBoughtWith(sb, menuId);
  const actor = { personId: who.personId, label: who.name };
  const results: Record<string, LineOutcome> = {};

  for (const [ingredientId, raw] of entries) {
    if (!onList.has(ingredientId)) return { ok: false, error: BAD };
    if (raw === null) {
      await setBoughtLineWith(sb, menuId, ingredientId, null, who);
      results[ingredientId] = 'saved';
      continue;
    }
    if (!isRecord(raw)) return { ok: false, error: BAD };
    let outcome: LineOutcome = 'saved';

    // "Something else": a brand (and its first package) nobody has listed yet.
    const rawItems = Array.isArray(raw.items) ? raw.items.slice(0, MAX_BOUGHT_ITEMS) : [];
    const items: unknown[] = [];
    // The price each box was showing when the recorder opened the page, by position: only a price they
    // actually changed is reported to the price book (a stale page must not undo someone else's update).
    const seen: (number | null)[] = [];
    let newBrands = 0;
    for (const it of rawItems) {
      seen.push(isRecord(it) && typeof it.seen === 'number' ? it.seen : null);
      if (!isRecord(it) || !isRecord(it.newBrand)) {
        items.push(it);
        continue;
      }
      if (who.personId == null) return { ok: false, error: 'Sign in with your own account to add a new brand.' };
      // Everything is checked BEFORE anything is created, so a refused save leaves no orphan brand or package
      // (qa-lead): the count and price, the brand's name, and a size the ingredient's unit can hold.
      const brandName = cleanScoutText(it.newBrand.name, 60);
      newBrands++;
      if (newBrands > 2 || sanitizeItems([{ qty: it.qty, pricePaid: it.pricePaid }]).length !== 1 || !brandName) return { ok: false, error: BAD };
      if (!sanitizeScoutPackage({ ingredientId, name: brandName, store: null, size: it.newBrand.size, sizeUnit: it.newBrand.sizeUnit, price: it.pricePaid }, catalog)) {
        return { ok: false, error: `Enter how much one package of ${brandName} holds and what it cost.` };
      }
      const added = await addBrandWith(sb, who.personId, ingredientId, brandName);
      if (!added || added.status !== 'ok') return { ok: false, error: added?.status === 'cap' ? 'You have added a lot of brands nobody has bought yet. Pick one from the list.' : 'That brand name can’t be saved. Try a shorter, plainer name.' };
      // "18 oz": the size as typed, kept as the package's size label.
      const sizeLabel = cleanScoutText(`${String(it.newBrand.size ?? '')} ${String(it.newBrand.sizeLabel ?? '')}`, 60);
      const pkg = sanitizeScoutPackage({ ingredientId, name: `${added.brand.name}, ${sizeLabel}`.slice(0, 60), store: null, size: it.newBrand.size, sizeUnit: it.newBrand.sizeUnit, price: it.pricePaid }, catalog);
      if (!pkg) return { ok: false, error: `Enter how much one package of ${added.brand.name} holds and what it cost.` };
      const made = await addScoutPackageWith(sb, actor, pkg);
      if (!('id' in made)) {
        return { ok: false, error: made.status === 'cap' ? 'You have packages waiting for a leader to check them. Wait for a leader before adding more.' : BAD };
      }
      // A package that had no brand takes this one; one that already belongs to a brand keeps it (the line then
      // records that brand: cleanLineInput reads the brand from the package).
      await sb.from('mm_packages').update({ brand_id: added.brand.id, size_label: sizeLabel || null }).eq('id', made.id).is('brand_id', null);
      if (made.status === 'held') outcome = 'held';
      items.push({ brandId: added.brand.id, packageId: made.id, qty: it.qty, pricePaid: it.pricePaid });
      // The new brand and package must pass the catalog check below.
      catalog = await loadMenuMonsterCatalog(owner ? who.stored.ownerPersonId : who.personId);
    }

    const clean = cleanLineInput(ingredientId, { ...raw, items }, catalog);
    if (!clean) return { ok: false, error: BAD };

    if (clean.status === 'bought' && who.personId != null) {
      const was = before.lines[ingredientId]?.items ?? [];
      for (const [i, item] of clean.items.entries()) {
        if (item.packageId == null) continue;
        const pkg = catalog.packages.find((p) => p.id === item.packageId);
        const prior = was.find((w) => w.packageId === item.packageId);
        const untouched = seen[i] != null && Math.abs((seen[i] as number) - item.pricePaid) < 0.005;
        if (!pkg || untouched || Math.abs(pkg.price - item.pricePaid) < 0.005 || (prior && Math.abs(prior.pricePaid - item.pricePaid) < 0.005)) continue;
        const reported = await reportPriceWith(sb, { packageId: item.packageId, newPrice: item.pricePaid, reportedBy: who.personId, menuId }, (entry) => recordAuditAs(sb, actor, entry));
        if (reported === 'held') outcome = 'held';
        else if (reported === 'applied' && outcome !== 'held') outcome = 'applied';
      }
    }

    if (!(await setBoughtLineWith(sb, menuId, ingredientId, clean, who))) return { ok: false, error: BAD };
    results[ingredientId] = outcome;
  }

  await recordAuditAs(sb, actor, {
    area: 'menus',
    action: 'bought',
    entityType: 'menu',
    entityId: menuId,
    summary: `${who.name} recorded what was bought for "${who.stored.menu.name}" (${entries.length} line${entries.length === 1 ? '' : 's'})`
  });
  return { ok: true, results, bought: await loadBoughtWith(sb, menuId) };
}

/** "We're done shopping": lines nobody recorded now count as bought as planned. Anyone who may record ticks it. */
export async function setShoppingDoneAction(menuId: unknown, done: unknown): Promise<{ ok: true; bought: Bought } | Fail> {
  if (typeof menuId !== 'string') return { ok: false, error: BAD };
  const who = await menuRecorder(menuId);
  if (!who) return { ok: false, error: NOT_ALLOWED };
  const sb = createAdminClient();
  if (!(await setShoppingDoneWith(sb, menuId, done === true, who))) return { ok: false, error: 'That menu is gone.' };
  await recordAuditAs(sb, { personId: who.personId, label: who.name }, {
    area: 'menus',
    action: 'bought',
    entityType: 'menu',
    entityId: menuId,
    summary: done === true ? `${who.name} marked shopping done for "${who.stored.menu.name}"` : `${who.name} reopened shopping for "${who.stored.menu.name}"`
  });
  return { ok: true, bought: await loadBoughtWith(sb, menuId) };
}
