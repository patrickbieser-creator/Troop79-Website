/**
 * /admin/advancement/audits — Audits.
 *
 * Deterministic (no model, plain SQL scans), on-demand data-quality checks.
 * Each check is a self-contained module in `checks/` exporting
 * `run(supabase): Promise<Finding[]>` — add a new one here and it gets the
 * same section/card/sign-off UI for free. Nothing on this page is cached or
 * persisted; every check recomputes fresh on every page load.
 */

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { AuditCard } from './audit-card';
import type { Finding } from './types';
import * as borRequirements from './checks/bor-requirements';
import * as activityThresholds from './checks/activity-thresholds';
import styles from './audits.module.css';

export const metadata = {
  title: 'Audits — Troop 79'
};

const CHECKS = [
  {
    id: 'bor-requirements',
    title: 'Board of Review Requirements',
    description:
      'Board of Review is on record for a rank, but one or more of that rank’s own requirements have no ledger entry — invisible on the Clipboard until someone notices. The BoR being on record already means current_rank is correct; filling in a gap below only backfills the historical completeness record.',
    run: borRequirements.run
  },
  {
    id: 'activity-thresholds',
    title: 'Activity & Campout Thresholds',
    description:
      'A scout has logged enough activities and campouts to satisfy Second Class 1a (5 activities, 3 campouts) or First Class 1a (10 activities, 6 campouts), but that requirement isn’t signed off yet. Runs regardless of Board of Review status — a proactive check that can catch the gap before the rank is otherwise complete.',
    run: activityThresholds.run
  }
] as const;

export default async function AuditsPage() {
  const supabase = await createClient();
  const [findingsByCheck, leadersRes] = await Promise.all([
    Promise.all(CHECKS.map((c) => c.run(supabase))),
    supabase.from('leaders').select('code, name').order('code')
  ]);
  const leaders = (leadersRes.data ?? []) as { code: string; name: string }[];

  return (
    <>
      <div className={styles.pageTitle}>
        <div>
          <h1>Audits</h1>
          <p>
            Deterministic data-quality checks over the ledger &mdash; no model, just SQL.
            Recomputed fresh every time this page loads; nothing here is cached or persisted.
          </p>
        </div>
      </div>

      {CHECKS.map((check, i) => (
        <AuditSection
          key={check.id}
          title={check.title}
          description={check.description}
          findings={findingsByCheck[i]}
          leaders={leaders}
        />
      ))}

      <p className={styles.footnote}>
        <Link href="/admin/advancement/dashboard">&larr; Back to Dashboard</Link>
      </p>
    </>
  );
}

function AuditSection({
  title,
  description,
  findings,
  leaders
}: {
  title: string;
  description: string;
  findings: Finding[];
  leaders: { code: string; name: string }[];
}) {
  const totalMissing = findings.reduce((sum, f) => sum + f.missing.length, 0);
  const scoutCount = new Set(findings.map((f) => f.scoutId)).size;

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <p className={styles.sectionDesc}>{description}</p>

      {findings.length === 0 ? (
        <div className={styles.empty}>No inconsistencies found.</div>
      ) : (
        <>
          <div className={styles.summary}>
            <strong>{findings.length}</strong> finding{findings.length === 1 ? '' : 's'} across{' '}
            <strong>{scoutCount}</strong> scout{scoutCount === 1 ? '' : 's'} &mdash;{' '}
            <strong>{totalMissing}</strong> requirement{totalMissing === 1 ? '' : 's'} missing in total.
          </div>
          <div className={styles.list}>
            {findings.map((f) => (
              <AuditCard key={`${f.checkId}-${f.scoutId}-${f.groupLabel}`} finding={f} leaders={leaders} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
