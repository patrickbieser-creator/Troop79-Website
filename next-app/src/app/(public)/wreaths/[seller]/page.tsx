import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { canonicalSlug, SLUG_RE } from '@/lib/wreaths/public';
import { loadStorePage } from '@/lib/wreaths/store-page';
import { entryOffered, goalProgress, itemsSoldBy } from '@/lib/wreaths/scout-entry';
import { resolveScoutEntryViewer } from '@/lib/wreaths/scout-entry-viewer';
import { placeScoutOrderAction } from '../actions';
import { StorePage } from '../_components/store-page';

/**
 * /wreaths/<first-name-last-initial> — a scout's own link. The store, with every order credited to that scout and
 * delivered by them. An unknown or retired link opens the general store with a quiet note, never a 404 that would lose
 * the customer — and the two cases look identical, so a retired link can't be told from one that never existed.
 * (`checkout` and `order` are static routes beside this one and win over it; a seller can't take those as a link.)
 */
export const dynamic = 'force-dynamic';

type Params = Promise<{ seller: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { seller } = await params;
  const data = await loadStorePage(createAdminClient(), seller);
  return {
    title: data.scout ? `Order wreaths from ${data.scout.name} — Scout Troop 79` : 'Christmas wreaths — Scout Troop 79',
    // A scout's page is for the people the scout shares it with, not for search results.
    robots: { index: false, follow: false }
  };
}

export default async function Page({ params, searchParams }: { params: Params; searchParams: Promise<{ enter?: string }> }) {
  const { seller } = await params;
  const { enter } = await searchParams;
  // "Anjali-S" and "anjali-s" are the same link; send a typed variant to the stored form so it's what gets shared.
  const canonical = canonicalSlug(seller);
  if (canonical !== seller && SLUG_RE.test(canonical)) redirect(`/wreaths/${canonical}`);
  const supabase = createAdminClient();
  const data = await loadStorePage(supabase, seller);
  const { scout, state } = data;
  // The scout's goal thermometer: only when a goal is set, counting live (non-cancelled) orders credited to the scout.
  const goal = scout && state.kind === 'open' ? goalProgress(scout.goal, await itemsSoldBy(supabase, state.sale.id, scout.personId), scout.firstName) : null;
  // "Order for someone I know" is offered only to a signed-in scout or a parent in the scout's household; a signed-out
  // visitor never reaches the viewer lookup past the cookie check, and the page renders exactly as before.
  const viewer = scout && state.kind === 'open' && !state.graceCutoff ? await resolveScoutEntryViewer(supabase) : null;
  const entry = scout && entryOffered(viewer, scout.personId, state.kind === 'open' && !state.graceCutoff) ? { action: placeScoutOrderAction, initialOn: enter === '1' } : undefined;
  return <StorePage data={data} entry={entry} goal={goal} />;
}
