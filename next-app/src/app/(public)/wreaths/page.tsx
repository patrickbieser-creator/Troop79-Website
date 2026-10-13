import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/server';
import { loadStorePage } from '@/lib/wreaths/store-page';
import { StorePage } from './_components/store-page';

/**
 * /wreaths — the troop's general store (Plans/Wreath-Sale.md). Orders placed here are credited to the troop, never to
 * a scout. Always rendered per request: the deadline band and the open / closed state follow the clock.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Christmas wreaths — Scout Troop 79',
  description: 'Fresh Christmas wreaths, roping and trees from the scouts of Troop 79 in Milwaukee. Order online for pickup or delivery.'
};

export default async function Page() {
  const data = await loadStorePage(createAdminClient(), null);
  return <StorePage data={data} />;
}
