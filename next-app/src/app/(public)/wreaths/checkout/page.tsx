import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/app/_components/page-shell';
import { Notice } from '@/app/_components/notice';
import { createAdminClient } from '@/lib/supabase/server';
import { distributionDay, distributionLine } from '@/lib/wreaths/copy';
import { loadStorePage } from '@/lib/wreaths/store-page';
import { placeOrderAction } from '../actions';
import { CheckoutForm } from '../_components/checkout-form';

/**
 * /wreaths/checkout?s=<scout link> — the one checkout. `s` names the scout whose page the shopper came from; an
 * unknown or retired one is the troop store, same as the page it came from. The sale's open / closed state is
 * decided here for what the visitor sees and again, for real, by the order action.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Checkout — Troop 79 wreaths',
  robots: { index: false, follow: false }
};

export default async function Page({ searchParams }: { searchParams: Promise<{ s?: string | string[] }> }) {
  const sp = await searchParams;
  const slug = typeof sp.s === 'string' && sp.s ? sp.s : null;
  const data = await loadStorePage(createAdminClient(), slug);
  const { state, scout } = data;

  if (state.kind !== 'open') {
    return (
      <PageShell width="narrow">
        <Notice tone="info">
          The Troop 79 wreath sale isn’t taking orders right now. <Link href="/wreaths">Back to the store</Link>
        </Notice>
      </PageShell>
    );
  }

  const dist = { date: state.sale.distributionDate, window: state.sale.distributionWindow, place: state.sale.distributionPlace };
  return (
    <PageShell width="narrow">
      <CheckoutForm
        items={state.items}
        scout={scout ? { slug: scout.slug, name: scout.name, firstName: scout.firstName } : null}
        rules={{
          deliveryZipPrefix: state.sale.deliveryZipPrefix,
          deliveryFee: state.sale.deliveryFee,
          deliveryFreeAt: state.sale.deliveryFreeAt,
          feePercent: state.sale.feePercent,
          feeFixed: state.sale.feeFixed
        }}
        pickupText={distributionLine(dist) || 'Pickup details are in your confirmation.'}
        distributionDay={distributionDay(dist)}
        graceCutoff={state.graceCutoff}
        action={placeOrderAction}
      />
    </PageShell>
  );
}
