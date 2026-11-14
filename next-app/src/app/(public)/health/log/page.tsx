/**
 * /health/log — who did what with health records, newest first (Plans/Health-Forms.md). Read-only, for the named
 * list. Not found for everyone else.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { healthAccess } from '@/lib/health-access';
import { healthLogRecent } from '@/lib/health-store';
import { HEALTH_KIND, isHealthKind, pageName } from '@/lib/health-records';
import { fmtDateTime } from '@/lib/format-date';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import styles from '../health.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Health records access log — Scout Troop 79',
  robots: { index: false, follow: false }
};

const VERB: Record<string, string> = { upload: 'added', replace: 'replaced', delete: 'removed', view: 'opened', download: 'downloaded', print: 'printed' };
const VIA: Record<string, string> = { family: 'family', named: 'named leader', trip: 'adult on the trip' };

export default async function HealthLogPage() {
  const access = await healthAccess();
  if (!access?.named) notFound();
  const lines = await healthLogRecent(createAdminClient());

  return (
    <>
      <PageHeader kicker="Leaders" title="Access log" />
      <PageShell>
        <div className={styles.wrap}>
          <p className={styles.links}>
            <Link href="/health">← Back to the list</Link>
          </p>
          <p className={styles.note}>The last {lines.length} entries. Nothing here can be edited.</p>
          {lines.length === 0 ? (
            <p className={styles.empty}>Nothing has been logged yet.</p>
          ) : (
            <ul className={styles.log}>
              {lines.map((l, i) => (
                <li key={i}>
                  <span className={styles.logWhen}>{fmtDateTime(l.at)}</span>
                  {l.viewerName} ({VIA[l.via] ?? l.via}) {VERB[l.action] ?? l.action} {l.personName}&rsquo;s{' '}
                  {isHealthKind(l.kind) ? `${HEALTH_KIND[l.kind].label}${l.page ? `, ${pageName(l.kind, l.page).toLowerCase()}` : ''}` : 'record'}
                </li>
              ))}
            </ul>
          )}
        </div>
      </PageShell>
    </>
  );
}
