/**
 * /admin/advancement/roster-import — review queue for staged roster imports.
 *
 * LEADER-ONLY (same gate as Roster and Scoutbook Export). Scouts are also
 * blocked at the edge by proxy.ts's allowlist, which this route is absent
 * from — the page gate below is the second, independent layer (D-037).
 *
 * Reads staged rows and suggestions only. Nothing on this page's load path
 * writes to people / scouts / leaders / scout_parents; every mutation lives in
 * ./actions.ts behind an explicit click.
 */

import { cookies } from 'next/headers';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { createAdminClient } from '@/lib/supabase/server';
import { ReviewClient, type QueueRow, type BatchSummary } from './review-client';
import styles from './roster-import.module.css';

export const metadata = {
  title: 'Roster Import — Troop 79'
};

export default async function RosterImportPage({
  searchParams
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  const jar = await cookies();
  const session = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  if (!session || session.role !== 'leader') {
    return <div className={styles.gate}>Roster Import is available to adult leaders only.</div>;
  }

  const { batch: batchParam } = await searchParams;
  const supabase = createAdminClient();

  const { data: batchRows } = await supabase
    .from('import_batches')
    .select('id, source_label, source_filename, row_count, status, created_at')
    .order('created_at', { ascending: false });
  const batches = (batchRows ?? []) as BatchSummary[];

  if (batches.length === 0) {
    return (
      <>
        <div className={styles.pageTitle}>
          <h1>Roster Import</h1>
          <p>No import batches have been staged yet.</p>
        </div>
        <div className={styles.empty}>
          Stage a file first:
          <code className={styles.code}>npm run import-roster-csv -- &quot;&lt;path&gt;&quot; --apply</code>
          The matcher writes only to the staging tables. Nothing reaches the roster until it is
          accepted here.
        </div>
      </>
    );
  }

  const activeBatch = batchParam ? Number(batchParam) : batches[0].id;

  const { data: queue } = await supabase
    .from('merge_review_queue')
    .select('*')
    .eq('batch_id', activeBatch);

  const rows = (queue ?? []) as QueueRow[];

  // Decided rows, for the progress counter. Counted separately from the queue
  // view, which by definition only carries what is still pending.
  const { count: decidedCount } = await supabase
    .from('merge_suggestions')
    .select('id, import_rows!inner(batch_id)', { count: 'exact', head: true })
    .in('status', ['accepted', 'rejected'])
    .eq('import_rows.batch_id', activeBatch);

  const batch = batches.find((b) => b.id === activeBatch) ?? batches[0];

  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Roster Import</h1>
        <p>
          Every row from a staged roster file, matched against the people already on record. A
          suggestion is only a proposal — nothing is written to the roster until you accept it, and
          a conflict you skip keeps whatever is already stored. The source file may be older than
          what is on record, so nothing here prefers it by default.
        </p>
      </div>

      <ReviewClient
        batches={batches}
        activeBatch={batch}
        rows={rows}
        decidedCount={decidedCount ?? 0}
      />
    </>
  );
}
