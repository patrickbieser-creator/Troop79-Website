/**
 * /admin/advancement/dashboard/analytics — Site Analytics, "View analytics"
 * from the Leader Dashboard's Site Analytics card.
 *
 * Embeds a Looker Studio report connected to the site's GA4 property
 * (troop-79.com, G-LHRPD27P0M) via Looker Studio's own supported embedding
 * mechanism — Google explicitly disallows iframing the GA4 UI itself, so
 * Looker Studio is the sanctioned path to an embedded analytics view.
 *
 * LOOKER_STUDIO_EMBED_URL is a plain (non-NEXT_PUBLIC_) env var: it's read
 * here server-side and interpolated into the iframe's src, matching the
 * project's pattern of no-op-gracefully-when-unset external integrations
 * (Bunny CDN, Resend) rather than crashing the page.
 */

import Link from 'next/link';
import { requireCapability } from '@/lib/require-capability';
import styles from '../dashboard.module.css';
import { PageTitle } from '../../../_components/page-title';

export const metadata = {
  title: 'Site Analytics — Troop 79'
};

export default async function AnalyticsPage() {
  await requireCapability('advancement.write');

  const embedUrl = process.env.LOOKER_STUDIO_EMBED_URL;

  return (
    <>
      <PageTitle
        title="Site Analytics"
        sub="Traffic and engagement for troop-79.com, via Google Analytics 4 and Looker Studio."
      >
        <div className={styles.actions}>
          <Link href="/admin/advancement/dashboard" className={styles.btn}>
            ← Dashboard
          </Link>
        </div>
      </PageTitle>

      <div className={styles.card}>
        {embedUrl ? (
          <iframe
            src={embedUrl}
            title="Site Analytics"
            width="100%"
            height={900}
            className={styles.reportFrame}
            allowFullScreen
          />
        ) : (
          <div className={styles.empty}>
            Analytics report not configured yet. Set <code>LOOKER_STUDIO_EMBED_URL</code> to the
            embed link from Looker Studio (File → Embed report) to enable this page.
          </div>
        )}
      </div>
    </>
  );
}
