import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { canonicalSlug, SLUG_RE } from '@/lib/wreaths/public';
import { loadStorePage } from '@/lib/wreaths/store-page';
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

export default async function Page({ params }: { params: Params }) {
  const { seller } = await params;
  // "Anjali-S" and "anjali-s" are the same link; send a typed variant to the stored form so it's what gets shared.
  const canonical = canonicalSlug(seller);
  if (canonical !== seller && SLUG_RE.test(canonical)) redirect(`/wreaths/${canonical}`);
  const data = await loadStorePage(createAdminClient(), seller);
  return <StorePage data={data} />;
}
