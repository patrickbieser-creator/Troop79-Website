/**
 * /library/menu-monster/menus/shared — every menu shared with the troop that is
 * on the shelf (Phase 3: outing ended in the last 120 days, or no outing and
 * shared in the last 120 days), newest first, open to everyone. ?outing=<id>
 * narrows to one outing's menus (all of them, no time limit). The hub shows
 * the first few and links here.
 */
import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { listSharedMenusWith } from '@/lib/menu-monster/menus-store';
import { PageShell } from '@/app/_components/page-shell';
import { Button } from '@/app/_components/button';
import { EmptyState } from '@/app/_components/empty-state';
import { SelectInput } from '@/app/_components/form';
import { MenuHeader, NO_INDEX, SHARED_HREF } from '../_components/scout-menus';
import { SharedMenusList } from '../_components/shared-menus-list';
import s from '../_components/workspace.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Shared menus — Menu Monster', robots: NO_INDEX };

export default async function SharedMenusPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const asked = typeof sp.outing === 'string' ? Number(sp.outing) : NaN;
  const outingId = Number.isInteger(asked) && asked > 0 ? asked : undefined;
  const sb = createAdminClient();
  const today = centralToday();
  const shelf = await listSharedMenusWith(sb, today);
  const rows = outingId != null ? await listSharedMenusWith(sb, today, { outingId }) : shelf;

  const outings = new Map<number, string>();
  for (const r of shelf) if (r.calendarEntryId != null && r.outingTitle) outings.set(r.calendarEntryId, r.outingTitle);
  for (const r of rows) if (r.calendarEntryId != null && r.outingTitle) outings.set(r.calendarEntryId, r.outingTitle);

  return (
    <>
      <MenuHeader title="Shared menus" listLabel="Shared menus" />
      <PageShell width="narrow">
        {outings.size > 0 && (
          <form className={s.listHead} method="get" action={SHARED_HREF} aria-label="Filter shared menus">
            <SelectInput name="outing" defaultValue={outingId ?? ''} aria-label="Outing">
              <option value="">Every outing</option>
              {[...outings].map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </SelectInput>
            <Button variant="secondary" size="sm" type="submit">
              Show
            </Button>
          </form>
        )}
        {rows.length === 0 ? <EmptyState>No menus shared yet.</EmptyState> : <SharedMenusList rows={rows} showOuting={outingId == null} />}
      </PageShell>
    </>
  );
}
