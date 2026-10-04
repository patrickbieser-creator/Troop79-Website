/**
 * /library/menu-monster/outings/[entryId] — an outing's food in one place (Plans/Menu-Monster-Brands-Gear.md,
 * release 5). Patrick, 2026-10-03: gear is planned per patrol, but "the troop shops together, all at once —
 * an outing shopping list is needed."
 *
 *   Menus          one row per patrol's menu: who planned it, what it expects to spend and what was paid
 *                  (projected until that menu's "We're done shopping"), with links to its tabs.
 *   Shopping list  every menu's needs merged by ingredient and priced ONCE (lib/menu-monster/menu-view.ts
 *                  buildOutingList), by store aisle, with each patrol's share under the line. Printable.
 *
 * Read-only: brands and counts are chosen on each menu; purchases are recorded on each menu's "What we
 * bought". Who may open it is the outing's crew — any signed-in scout — and leaders (menu-access.ts 'crew');
 * everyone else gets notFound(). Menus are read the way the crew reads them — against the public catalog,
 * the planner's own included — so the page is the same for everyone who opens it (a recipe its author has
 * not shared yet is not on it).
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireVerifiedScoutIdentity } from '@/lib/family-access';
import { fmtRange } from '@/lib/format-date';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { resolveMenuAliases } from '@/lib/menu-monster/menus';
import { redactMenu } from '@/lib/menu-monster/menu-access';
import { buildMenuList, buildOutingList, type OutingMenuRef } from '@/lib/menu-monster/menu-view';
import { listOutingMenusWith, ownerCreditNamesWith } from '@/lib/menu-monster/menus-store';
import { loadOutingWith } from '@/lib/menu-monster/menus-data';
import { boughtFromActuals, boughtRows, boughtTotals } from '@/lib/menu-monster/bought';
import { loadBoughtWith } from '@/lib/menu-monster/bought-store';
import { SECTIONS, SECTION_ORDER, priceText as money, qtyText } from '@/lib/menu-monster/units';
import { PageHeader, KickerSep } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { NO_INDEX, menuViewer } from '../../menus/_components/scout-menus';
import { PrintButton } from '../../menus/_components/print-button';
import s from '../../menus/_components/workspace.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Outing food — Menu Monster', robots: NO_INDEX };

const MENUS_HREF = '/library/menu-monster/menus';

export default async function OutingFoodPage({ params }: { params: Promise<{ entryId: string }> }) {
  const { entryId } = await params;
  const id = Number(entryId);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const viewer = await menuViewer();
  if (viewer?.kind !== 'scout' && viewer?.kind !== 'leader') notFound();
  if (viewer.kind === 'scout') {
    // The crew reads other scouts' unshared menus: a revoked sign-in ends here.
    try {
      await requireVerifiedScoutIdentity();
    } catch {
      notFound();
    }
  }
  const sb = createAdminClient();
  const [outing, stored, catalog] = await Promise.all([loadOutingWith(sb, id), listOutingMenusWith(sb, id), loadMenuMonsterCatalog(null)]);
  // A draft outing is a leader's until it is published, as on /events/[id].
  if (!outing || (outing.status !== 'published' && viewer.kind !== 'leader')) notFound();

  const names = await ownerCreditNamesWith(sb, stored.map((m) => m.ownerPersonId));
  const menus = await Promise.all(
    stored.map(async (m) => {
      const menu = resolveMenuAliases(redactMenu(m.menu, 'crew', catalog).menu, catalog.aliases);
      const list = buildMenuList(menu, catalog);
      const bought = await loadBoughtWith(sb, m.id);
      const rows = boughtRows(list.lines, { ...bought, lines: { ...boughtFromActuals(menu.actuals, catalog, m.updatedAt), ...bought.lines } });
      return { id: m.id, menu, list, totals: boughtTotals(rows, bought.done != null), done: bought.done != null, planner: names.get(m.ownerPersonId) ?? '' };
    })
  );
  const refs: OutingMenuRef[] = menus.filter((m) => m.menu.meals.some((x) => x.recipeIds.length > 0)).map((m) => ({ id: m.id, label: m.menu.patrol || m.menu.name || 'Menu', menu: m.menu }));
  const outingList = buildOutingList(refs, catalog);
  const buying = outingList.lines.filter((l) => l.status === 'ok' || l.status === 'short' || l.status === 'unpriced');
  const notBuying = outingList.lines.filter((l) => l.status === 'bring' || l.status === 'staple');
  const aisles = SECTION_ORDER.filter((sec) => buying.some((l) => l.ing.section === sec));
  const planned = menus.reduce((n, m) => n + m.totals.planned, 0);
  const paid = menus.reduce((n, m) => n + m.totals.paid, 0);
  const projected = menus.some((m) => m.totals.projected);
  const sizeOf = (p: { sizeLabel?: string | null; name: string }) => p.sizeLabel ?? p.name;

  return (
    <>
      <PageHeader
        kicker={
          <>
            <Link href="/library/topic/menu-monster">Menu Monster</Link>
            <KickerSep />
            <Link href={`/events/${outing.id}`}>{outing.title}</Link>
          </>
        }
      />
      <PageShell>
        <div data-mm-print>
          <div className={s.titleLine}>
            <h1 className={s.menuTitle}>{outing.title} — food</h1>
            <div className={`${s.titleActions} ${s.screenOnly}`}>
              <PrintButton />
            </div>
          </div>
          <p className={s.foot}>{fmtRange(outing.startDate, outing.endDate)}</p>

          <section className={s.section} aria-labelledby="mm-o-menus">
            <div className={s.secHead}>
              <h2 id="mm-o-menus" className={s.heading}>
                Menus
              </h2>
              {menus.length > 0 && <span className={s.meta}>Planned on its own · paid</span>}
            </div>
            {menus.length === 0 ? (
              <p className={s.foot}>
                No menu is linked to this outing yet. Start one on the{' '}
                <Link className={s.link} href="/library/topic/menu-monster">
                  Menu Monster
                </Link>{' '}
                page and pick this outing.
              </p>
            ) : (
              <>
                <ul className={s.card} aria-label="Menus for this outing">
                  {menus.map((m) => (
                    <li key={m.id} className={s.row}>
                      <div className={s.rowMain}>
                        <Link className={s.rowName} href={`${MENUS_HREF}/${m.id}`}>
                          {m.menu.patrol || m.menu.name || 'Untitled menu'}
                        </Link>
                        <span className={s.meta}>
                          {[m.menu.patrol ? m.menu.name : null, m.planner ? `planned by ${m.planner}` : null, `${m.menu.headcount} people`].filter(Boolean).join(' · ')}
                        </span>
                        <span className={`${s.meta} ${s.screenOnly}`}>
                          <Link className={s.link} href={`${MENUS_HREF}/${m.id}/gear`}>
                            Gear
                          </Link>{' '}
                          ·{' '}
                          <Link className={s.link} href={`${MENUS_HREF}/${m.id}/bought`}>
                            What we bought
                          </Link>
                        </span>
                      </div>
                      <div className={s.rcol}>
                        {money(m.totals.planned)} · {money(m.totals.paid)}
                        {m.totals.projected ? <span className={s.meta}> projected</span> : null}
                      </div>
                    </li>
                  ))}
                </ul>
                <p className={s.shopLine}>
                  <strong>{money(paid)}</strong>{' '}
                  <span className={s.muted}>
                    {projected ? 'projected' : 'paid'} for the outing · planned {money(planned)}
                    {outingList.plates > 0 ? ` · ${money(paid / outingList.plates)} a person per meal` : ''}
                  </span>
                </p>
              </>
            )}
          </section>

          {refs.length > 0 && (
            <section className={s.section} aria-labelledby="mm-o-list">
              <div className={s.secHead}>
                <h2 id="mm-o-list" className={s.heading}>
                  Shopping list for the whole outing
                </h2>
              </div>
              <p className={s.shopLine}>
                <strong>{money(outingList.totals.spent)}</strong>{' '}
                <span className={s.muted}>
                  to buy everything in one trip
                  {outingList.saving > 0 ? ` · ${money(outingList.saving)} less than each patrol shopping alone` : ''}
                  {outingList.totals.unpriced.length > 0 ? ` · not counting ${outingList.totals.unpriced.length} without a price` : ''}
                </span>
              </p>
              {aisles.map((sec) => (
                <div key={sec} className={s.dayBlock}>
                  <h3 className={s.dayHead}>{SECTIONS[sec]}</h3>
                  <ul className={s.card} aria-label={SECTIONS[sec]}>
                    {buying
                      .filter((l) => l.ing.section === sec)
                      .map((l) => {
                        const parts = l.parts ?? [];
                        const what =
                          l.status === 'unpriced'
                            ? 'no price yet'
                            : parts.length > 0
                              ? parts.map((x) => `${x.qty} × ${x.brand.name}${x.estimated ? '' : `, ${sizeOf(x.pkg)}`}`).join('; ')
                              : l.estimated && l.pkg
                                ? `any brand · ${l.qty} × ${sizeOf(l.pkg)}`
                                : `${l.qty} × ${l.pkg?.name ?? ''}`;
                        return (
                          <li key={l.ing.id} className={s.row}>
                            <div className={s.rowMain}>
                              <span className={s.outingCheck} aria-hidden="true">
                                ☐
                              </span>
                              <span className={s.outingName}>{l.ing.name}</span>
                              <span className={s.meta}>{what}</span>
                              {l.status === 'short' && <span className={s.tag}>Short {qtyText(l.shortQty, l.ing.unit)}</span>}
                            </div>
                            <div className={s.cost}>{l.status === 'unpriced' ? '' : `${l.estimated ? 'about ' : ''}${money(l.spent)}`}</div>
                            {l.byMenu.length > 1 && (
                              <p className={s.outingShares}>{l.byMenu.map((b) => `${b.label}: ${qtyText(b.amount, l.ing.unit)}`).join(' · ')}</p>
                            )}
                          </li>
                        );
                      })}
                  </ul>
                </div>
              ))}
              {notBuying.length > 0 && (
                <p className={s.foot}>
                  Not buying: {notBuying.map((l) => `${l.ing.name} (${l.status === 'staple' || l.source === 'pantry' ? 'troop store room' : 'from home'})`).join(', ')}.
                </p>
              )}
              <p className={`${s.foot} ${s.screenOnly}`}>
                Counts here are what the recipes need. Brands are chosen on each menu’s Plan or Shopping tab; a count changed on one menu stays on that menu. Record prices on each menu’s What we bought tab.
              </p>
            </section>
          )}
        </div>
      </PageShell>
    </>
  );
}
