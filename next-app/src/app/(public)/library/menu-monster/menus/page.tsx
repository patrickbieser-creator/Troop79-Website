/**
 * /library/menu-monster/menus — My menus (Scout Workspace, Phase 1 + 3).
 * Per-user data: force-dynamic, nothing cached.
 *   - a scout: their own menus.
 *   - a leader (admin viewer): every scout's menus read-only, filterable by
 *     scout, outing and shared (Phase 3 — filtered in SQL; the scout's roster
 *     record links here with ?scout=). This is the leader list of record: no
 *     second admin surface (tech-lead review).
 *   - a parent: their scouts' menus read-only.
 *   - anyone else: one locked line.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { loadOutingsWith } from '@/lib/menu-monster/menus-data';
import type { Outing } from '@/lib/menu-monster/menu-view';
import { listAllMenusWith, listMenusWith, ownerCreditNamesWith, type MenuFilters, type MenuSummary } from '@/lib/menu-monster/menus-store';
import { PageShell } from '@/app/_components/page-shell';
import { Button } from '@/app/_components/button';
import { SelectInput } from '@/app/_components/form';
import { DraftOffer } from './_components/draft-offer';
import { loadMenuRows } from './_components/menu-rows';
import { MenusList } from './_components/menus-list';
import { LockedLine, MENUS_HREF, MenuHeader, NO_INDEX, SHARED_HREF, menuViewer } from './_components/scout-menus';
import s from './_components/workspace.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'My menus — Menu Monster', robots: NO_INDEX };

type Search = Record<string, string | string[] | undefined>;

const positiveInt = (v: string | string[] | undefined): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/** ?scout= / ?outing= / ?shared=1 — anything else is ignored. */
function menuFilters(sp: Search): MenuFilters {
  return { scout: positiveInt(sp.scout), outing: positiveInt(sp.outing), shared: sp.shared === '1' || undefined };
}

export default async function MyMenusPage({ searchParams }: { searchParams: Promise<Search> }) {
  const viewer = await menuViewer();
  if (!viewer) {
    return (
      <>
        <MenuHeader title="My menus" />
        <PageShell width="narrow">
          <LockedLine next={MENUS_HREF} />
        </PageShell>
      </>
    );
  }

  const sb = createAdminClient();
  if (viewer.kind === 'leader') {
    const filters = menuFilters(await searchParams);
    const filtered = filters.scout != null || filters.outing != null || filters.shared === true;
    const all = await listAllMenusWith(sb);
    const shown = filtered ? await listAllMenusWith(sb, filters) : all;
    const [catalog, owners] = await Promise.all([
      // Costs for the leader's list only: an owner's draft recipe prices as missing here (read-only, never saved).
      loadMenuMonsterCatalog(null),
      ownerCreditNamesWith(sb, all.map((m) => m.ownerPersonId))
    ]);
    const [rows, outings] = await Promise.all([
      loadMenuRows(sb, shown, catalog, owners),
      loadOutingsWith(sb, centralToday(), all.flatMap((m) => (m.calendarEntryId != null ? [m.calendarEntryId] : [])))
    ]);
    return (
      <>
        <MenuHeader title="Scouts’ menus" listLabel="Scouts’ menus" />
        <PageShell width="narrow">
          <LeaderFilters all={all} outings={outings} owners={owners} filters={filters} />
          <MenusList rows={rows} readOnly emptyText={filtered ? 'No menus match.' : 'No scout has saved a menu yet.'} />
        </PageShell>
      </>
    );
  }

  if (viewer.kind === 'parent') {
    const scouts = viewer.familyIds.filter((id) => id !== viewer.personId);
    const summaries = await listMenusWith(sb, scouts);
    const [catalog, owners] = await Promise.all([loadMenuMonsterCatalog(null), ownerCreditNamesWith(sb, summaries.map((m) => m.ownerPersonId))]);
    const rows = await loadMenuRows(sb, summaries, catalog, owners);
    return (
      <>
        <MenuHeader title="Your scouts’ menus" listLabel="Your scouts’ menus" />
        <PageShell width="narrow">
          <MenusList rows={rows} readOnly emptyText="Your scouts haven’t saved a menu yet." />
          <p className={s.foot}>
            <Link className={s.link} href={SHARED_HREF}>
              All shared menus
            </Link>
          </p>
        </PageShell>
      </>
    );
  }

  const summaries = await listMenusWith(sb, viewer.personId);
  const catalog = await loadMenuMonsterCatalog(viewer.personId);
  const rows = await loadMenuRows(sb, summaries, catalog);

  return (
    <>
      <MenuHeader title="My menus" />
      <PageShell width="narrow">
        <div className={s.listHead}>
          <span className={s.foot}>A person, per meal</span>
          <Button variant="primary" href={`${MENUS_HREF}/new`}>
            New menu
          </Button>
        </div>
        <MenusList rows={rows} />
        <DraftOffer catalog={catalog} />
        <p className={s.foot}>
          <Link className={s.link} href={SHARED_HREF}>
            All shared menus
          </Link>
        </p>
      </PageShell>
    </>
  );
}

/** A plain GET form: the filters live in the URL, so a filtered list is linkable (the roster's ?scout= link). */
function LeaderFilters({
  all,
  outings: outingList,
  owners,
  filters
}: {
  all: MenuSummary[];
  outings: Outing[];
  owners: ReadonlyMap<number, string>;
  filters: MenuFilters;
}) {
  const scouts = [...new Set(all.map((m) => m.ownerPersonId))]
    .map((id) => ({ id, name: owners.get(id) ?? `Scout ${id}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Only outings some menu is linked to, in date order (loadOutingsWith also returns upcoming unlinked ones).
  const linked = new Set(all.map((m) => m.calendarEntryId));
  const outings = new Map(outingList.filter((o) => linked.has(o.id)).map((o) => [o.id, o.title]));
  return (
    <form className={s.listHead} method="get" action={MENUS_HREF} aria-label="Filter scouts’ menus">
      <SelectInput name="scout" defaultValue={filters.scout ?? ''} aria-label="Scout">
        <option value="">Every scout</option>
        {scouts.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </SelectInput>
      <SelectInput name="outing" defaultValue={filters.outing ?? ''} aria-label="Outing">
        <option value="">Every outing</option>
        {[...outings].map(([id, title]) => (
          <option key={id} value={id}>
            {title}
          </option>
        ))}
      </SelectInput>
      <SelectInput name="shared" defaultValue={filters.shared ? '1' : ''} aria-label="Shared">
        <option value="">All menus</option>
        <option value="1">Shared only</option>
      </SelectInput>
      <Button variant="secondary" size="sm" type="submit">
        Filter
      </Button>
    </form>
  );
}
