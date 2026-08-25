/**
 * /admin/advancement/roster-import — review queue for staged roster imports.
 *
 * Reads staged rows and suggestions only. Nothing on this page's load path
 * writes to people / scouts / leaders; every mutation lives in ./actions.ts
 * behind an explicit click (already gated on requireCapability('roster.manage')
 * there, and has been throughout).
 *
 * This page's own gate was, until 2026-08-19, still the legacy
 * verifySession()/LEADER_COOKIE check — the same never-converted-during-
 * Phase-B2 bug found in scoutbook-export/page.tsx (see that file's header for
 * the full story). LEADER_PASSWORD is fully retired, so this page was
 * unreachable via any Access & Permissions grant despite every mutation
 * behind it already working correctly. Converted to
 * requireCapability('roster.manage'), matching the nav item (sub-nav.tsx)
 * and every action in ./actions.ts.
 */

import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import {
  ReviewClient,
  type QueueRow,
  type BatchSummary,
  type PersonRelationship,
  type MergeCandidate
} from './review-client';
import styles from './roster-import.module.css';
import { PageTitle } from '../../_components/page-title';

/** Shape returned by the two-sided relationships join below. */
interface RawRelationship {
  id: number;
  person_id: number;
  related_person_id: number;
  type: PersonRelationship['type'];
  is_guardian: boolean;
  person: { display_name: string } | null;
  related: { display_name: string } | null;
}

export const metadata = {
  title: 'Roster Import — Troop 79'
};

export default async function RosterImportPage({
  searchParams
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  await requireCapability('roster.manage');

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
        <PageTitle back={null} title="Roster Import" sub="No import batches have been staged yet." />
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

  // Duplicate people the exact-email backfill could not resolve. These block
  // the next phase: until they are merged, pointing households.ts at person_id
  // would list each of these humans twice in the family signup picker.
  const { data: candidateRows } = await supabase
    .from('person_merge_candidate_detail')
    .select('*');
  const candidates = (candidateRows ?? []) as MergeCandidate[];

  const { count: cleanCount } = await supabase
    .from('merge_review_queue')
    .select('suggestion_id', { count: 'exact', head: true })
    .eq('batch_id', activeBatch)
    .in('confidence', ['bsa_member_id', 'email'])
    .eq('conflict_count', 0);

  // Relationships already recorded for anyone in this queue, BOTH directions.
  // A person routinely has several — two children, or a child plus a spouse's
  // child — so the screen has to show the whole set, not just the last one
  // added, or a reviewer cannot tell what is already recorded from what is not.
  const personIds = [...new Set(rows.map((r) => r.person_id).filter((id): id is number => id !== null))];
  const relationshipsByPerson: Record<number, PersonRelationship[]> = {};

  if (personIds.length > 0) {
    const idList = personIds.join(',');
    const { data: relRows } = await supabase
      .from('relationships')
      .select(
        'id, person_id, related_person_id, type, is_guardian,' +
          'person:people!relationships_person_id_fkey(display_name),' +
          'related:people!relationships_related_person_id_fkey(display_name)'
      )
      .or(`person_id.in.(${idList}),related_person_id.in.(${idList})`);

    for (const row of (relRows ?? []) as unknown as RawRelationship[]) {
      const push = (owner: number, rel: PersonRelationship) => {
        relationshipsByPerson[owner] = [...(relationshipsByPerson[owner] ?? []), rel];
      };
      if (personIds.includes(row.person_id)) {
        push(row.person_id, {
          id: row.id,
          direction: 'outgoing',
          type: row.type,
          isGuardian: row.is_guardian,
          otherName: row.related?.display_name ?? 'someone'
        });
      }
      if (personIds.includes(row.related_person_id)) {
        push(row.related_person_id, {
          id: row.id,
          direction: 'incoming',
          type: row.type,
          isGuardian: row.is_guardian,
          otherName: row.person?.display_name ?? 'someone'
        });
      }
    }
  }

  return (
    <>
      <PageTitle back={null}
        title="Roster Import"
        sub="Every row from a staged roster file, matched against the people already on record. A
          suggestion is only a proposal — nothing is written to the roster until you accept it, and
          a conflict you skip keeps whatever is already stored. The source file may be older than
          what is on record, so nothing here prefers it by default."
      />

      <ReviewClient
        batches={batches}
        activeBatch={batch}
        rows={rows}
        decidedCount={decidedCount ?? 0}
        relationshipsByPerson={relationshipsByPerson}
        candidates={candidates}
        cleanCount={cleanCount ?? 0}
      />
    </>
  );
}
