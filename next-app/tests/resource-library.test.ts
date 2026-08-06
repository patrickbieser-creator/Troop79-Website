import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import {
  approveResource,
  approveSubmission,
  cascadeLibraryReqRename,
  loadPublishedFor,
  returnSubmission
} from '../src/lib/library-data';

/**
 * Resource Library Phase 1 (Plans/Resource-Library.md) — the invariants that
 * matter most:
 *
 *  1. pending/archived resources NEVER surface through the public read path;
 *  2. approving a queued submission publishes it and stamps default credit;
 *  3. the D-019 code-rename cascade moves placements, narratives, and proof
 *     submissions with the renamed code (tech-lead 2026-07-21 — orphaned keys
 *     silently empty a requirement page);
 *  4. the anon key reads nothing from any library table (D-051 RLS pattern).
 *
 * Same approach as the rest of this suite: real local Postgres, no mocks.
 */

const TEST_TOPIC_KEY = 'test-shelf-vitest';

describe('resource library', () => {
  let resourceIds: number[] = [];
  let noteIds: number[] = [];
  let submissionIds: number[] = [];
  let ledgerEntryIds: number[] = [];
  let scoutIds: string[] = [];

  afterEach(async () => {
    const admin = adminClient();
    // Submissions FIRST — requirement_submissions.ledger_entry_id FKs to
    // ledger_entries with no ON DELETE clause (default RESTRICT), so deleting
    // the ledger row first fails silently (Supabase returns {error}, doesn't
    // throw) and leaves both rows orphaned, which then also blocks the scout
    // delete below via ledger_entries.scout_id. Caught live in this suite:
    // Leader_ApprovingProof_WritesLedgerEntry_WithEnteredBy passed once, then
    // every subsequent run failed on a stale 'vitest-approve' scout row
    // (qa-lead review, 2026-08-06).
    if (submissionIds.length > 0) {
      await admin.from('requirement_submissions').delete().in('id', submissionIds);
    }
    if (ledgerEntryIds.length > 0) {
      await admin.from('ledger_entries').delete().in('id', ledgerEntryIds);
    }
    if (noteIds.length > 0) {
      await admin.from('requirement_notes').delete().in('id', noteIds);
    }
    // Resources after placements/notes — placements cascade on resource delete.
    if (resourceIds.length > 0) {
      await admin.from('library_resources').delete().in('id', resourceIds);
    }
    // Scouts LAST — ledger_entries.scout_id and requirement_submissions.scout_id
    // both FK to scouts with no cascade.
    if (scoutIds.length > 0) {
      await admin.from('scouts').delete().in('id', scoutIds);
    }
    resourceIds = [];
    noteIds = [];
    submissionIds = [];
    ledgerEntryIds = [];
    scoutIds = [];
  });

  /**
   * A throwaway scout row, not a read off whatever happens to be in local
   * Postgres — the shared local DB has been empty of seed data since a
   * mid-session `db reset` (Backlog: "restore local dev's realistic data
   * snapshot"), so tests that depend on "some scout exists" can't be trusted
   * to run standalone. `id` is a text primary key we must supply ourselves.
   */
  async function makeScout(admin: ReturnType<typeof adminClient>, suffix: string): Promise<string> {
    const id = `vitest-${suffix}`;
    const { error } = await admin.from('scouts').insert({
      id,
      first_name: '[TEST]',
      last_name: 'Vitest',
      display_name: `[TEST] Vitest ${suffix}`,
      active: true
    });
    if (error) throw new Error(`fixture: scout insert failed: ${error.message}`);
    scoutIds.push(id);
    return id;
  }

  async function makeResource(
    admin: ReturnType<typeof adminClient>,
    status: 'pending' | 'published' | 'archived',
    title: string
  ): Promise<number> {
    const { data, error } = await admin
      .from('library_resources')
      .insert({
        title: `[TEST] ${title}`,
        kind: 'link',
        url: 'https://example.com/vitest',
        status,
        submitted_by_label: 'Vitest Fixture'
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: resource insert failed: ${error?.message}`);
    resourceIds.push(data.id);
    return data.id as number;
  }

  async function place(
    admin: ReturnType<typeof adminClient>,
    resourceId: number,
    targetKind: string,
    targetKey: string
  ) {
    const { error } = await admin
      .from('library_placements')
      .insert({ resource_id: resourceId, target_kind: targetKind, target_key: targetKey });
    if (error) throw new Error(`fixture: placement insert failed: ${error.message}`);
  }

  it('Visitor_SeesOnlyPublishedResources_WhenBrowsingLibrary', async () => {
    const admin = adminClient();
    const pendingId = await makeResource(admin, 'pending', 'Pending item');
    const publishedId = await makeResource(admin, 'published', 'Published item');
    const archivedId = await makeResource(admin, 'archived', 'Archived item');
    await place(admin, pendingId, 'topic', TEST_TOPIC_KEY);
    await place(admin, publishedId, 'topic', TEST_TOPIC_KEY);
    await place(admin, archivedId, 'topic', TEST_TOPIC_KEY);

    const visible = await loadPublishedFor(admin, 'topic', TEST_TOPIC_KEY);
    const ids = visible.map((r) => r.id);
    expect(ids).toContain(publishedId);
    expect(ids).not.toContain(pendingId);
    expect(ids).not.toContain(archivedId);
  });

  it('Webmaster_PublishesResource_WhenApprovingQueuedSubmission', async () => {
    const admin = adminClient();
    const id = await makeResource(admin, 'pending', 'Queued item');

    const err = await approveResource(admin, id, 'VT');
    expect(err).toBeNull();

    const { data } = await admin
      .from('library_resources')
      .select('status, attribution_label, reviewed_by')
      .eq('id', id)
      .single();
    expect(data?.status).toBe('published');
    expect(data?.attribution_label).toBe('Shared by Vitest Fixture');
    expect(data?.reviewed_by).toBe('VT');
  });

  it('Renaming_RequirementCode_CascadesToPlacementsNotesAndSubmissions', async () => {
    const admin = adminClient();
    // Fictional composite keys — the cascade matches on exact (kind, key), so
    // no real catalog rows are needed or touched.
    const oldKey = 'first-class-9zz';
    const newKey = 'first-class-9zz-renamed';

    const resourceId = await makeResource(admin, 'published', 'Cascade item');
    await place(admin, resourceId, 'rank_req', oldKey);

    const { data: note, error: noteErr } = await admin
      .from('requirement_notes')
      .insert({ target_kind: 'rank_req', target_key: oldKey, narrative_md: '[TEST] narrative' })
      .select('id')
      .single();
    if (noteErr || !note) throw new Error(`fixture: note insert failed: ${noteErr?.message}`);
    noteIds.push(note.id);

    const scoutId = await makeScout(admin, 'rename');
    const { data: submission, error: subErr } = await admin
      .from('requirement_submissions')
      .insert({
        scout_id: scoutId,
        target_kind: 'rank_req',
        target_key: oldKey,
        proof_type: 'report',
        body_md: '[TEST] proof',
        submitted_via: 'family'
      })
      .select('id')
      .single();
    if (subErr || !submission) throw new Error(`fixture: submission insert failed: ${subErr?.message}`);
    submissionIds.push(submission.id);

    const err = await cascadeLibraryReqRename(admin, 'rank', 'first-class', '9zz', '9zz-renamed');
    expect(err).toBeNull();

    const [{ data: p }, { data: n }, { data: s }] = await Promise.all([
      admin.from('library_placements').select('target_key').eq('resource_id', resourceId).single(),
      admin.from('requirement_notes').select('target_key').eq('id', note.id).single(),
      admin.from('requirement_submissions').select('target_key').eq('id', submission.id).single()
    ]);
    expect(p?.target_key).toBe(newKey);
    expect(n?.target_key).toBe(newKey);
    expect(s?.target_key).toBe(newKey);
  });

  it('Leader_ApprovingProof_WritesLedgerEntry_WithEnteredBy', async () => {
    const admin = adminClient();
    const scoutId = await makeScout(admin, 'approve');

    // Fictional composite key — same convention as the rename test above.
    // 'first-class' is a real rank id (needed so splitRankReqKey resolves
    // the target back to a rank_id/code pair); the '9zz' leaf doesn't need
    // to exist in the catalog for the ledger write itself to succeed.
    const targetKey = 'first-class-9zz-proof';
    const { data: submission, error: subErr } = await admin
      .from('requirement_submissions')
      .insert({
        scout_id: scoutId,
        target_kind: 'rank_req',
        target_key: targetKey,
        proof_type: 'report',
        body_md: '[TEST] I did this',
        submitted_via: 'family',
        status: 'pending'
      })
      .select('id')
      .single();
    if (subErr || !submission) throw new Error(`fixture: submission insert failed: ${subErr?.message}`);
    submissionIds.push(submission.id);

    const result = await approveSubmission(admin, submission.id, 'VT');
    expect(result.error).toBeNull();
    expect(result.ledgerEntryId).toBeDefined();
    if (result.ledgerEntryId) ledgerEntryIds.push(result.ledgerEntryId);

    const { data: ledgerRow } = await admin
      .from('ledger_entries')
      .select('scout_id, kind, code, entered_by, by')
      .eq('id', result.ledgerEntryId)
      .single();
    expect(ledgerRow?.scout_id).toBe(scoutId);
    expect(ledgerRow?.kind).toBe('rank_requirement');
    expect(ledgerRow?.code).toBe(targetKey);
    expect(ledgerRow?.entered_by).toBe('VT');

    const { data: subRow } = await admin
      .from('requirement_submissions')
      .select('status, reviewed_by, ledger_entry_id')
      .eq('id', submission.id)
      .single();
    expect(subRow?.status).toBe('approved');
    expect(subRow?.reviewed_by).toBe('VT');
    expect(subRow?.ledger_entry_id).toBe(result.ledgerEntryId);
  });

  it('Leader_ApprovingProof_IsBlocked_WhenScoutAlreadyHasCode', async () => {
    const admin = adminClient();
    const scoutId = await makeScout(admin, 'dup');

    const targetKey = 'first-class-9zz-dup';
    const { data: existingLedgerRow, error: ledgerErr } = await admin
      .from('ledger_entries')
      .insert({
        scout_id: scoutId,
        date: '2026-01-01',
        kind: 'rank_requirement',
        code: targetKey,
        label: '[TEST] already signed off',
        by: 'VT',
        qty: 1,
        unit: 'complete',
        entered_by: 'VT',
        entered_at: new Date().toISOString()
      })
      .select('id')
      .single();
    if (ledgerErr || !existingLedgerRow) {
      throw new Error(`fixture: ledger insert failed: ${ledgerErr?.message}`);
    }
    ledgerEntryIds.push(existingLedgerRow.id);

    const { data: submission, error: subErr } = await admin
      .from('requirement_submissions')
      .insert({
        scout_id: scoutId,
        target_kind: 'rank_req',
        target_key: targetKey,
        proof_type: 'report',
        body_md: '[TEST] I did this too',
        submitted_via: 'family',
        status: 'pending'
      })
      .select('id')
      .single();
    if (subErr || !submission) throw new Error(`fixture: submission insert failed: ${subErr?.message}`);
    submissionIds.push(submission.id);

    const result = await approveSubmission(admin, submission.id, 'VT');
    expect(result.error).not.toBeNull();
    expect(result.ledgerEntryId).toBeUndefined();

    // Blocked, not silently dropped — the submission stays pending so the
    // leader can still return it with feedback instead.
    const { data: subRow } = await admin
      .from('requirement_submissions')
      .select('status, ledger_entry_id')
      .eq('id', submission.id)
      .single();
    expect(subRow?.status).toBe('pending');
    expect(subRow?.ledger_entry_id).toBeNull();

    const { data: allLedgerRows } = await admin
      .from('ledger_entries')
      .select('id')
      .eq('scout_id', scoutId)
      .eq('kind', 'rank_requirement')
      .eq('code', targetKey);
    expect((allLedgerRows ?? []).length).toBe(1);
  });

  it('Leader_ReturningProof_RecordsFeedbackWithoutTouchingLedger', async () => {
    const admin = adminClient();
    const scoutId = await makeScout(admin, 'return');

    const { data: submission, error: subErr } = await admin
      .from('requirement_submissions')
      .insert({
        scout_id: scoutId,
        target_kind: 'rank_req',
        target_key: 'first-class-9zz-return',
        proof_type: 'report',
        body_md: '[TEST] not quite',
        submitted_via: 'scout',
        status: 'pending'
      })
      .select('id')
      .single();
    if (subErr || !submission) throw new Error(`fixture: submission insert failed: ${subErr?.message}`);
    submissionIds.push(submission.id);

    const err = await returnSubmission(admin, submission.id, 'VT', 'Please redo with a clearer photo.');
    expect(err).toBeNull();

    const { data: subRow } = await admin
      .from('requirement_submissions')
      .select('status, feedback_md, reviewed_by, ledger_entry_id')
      .eq('id', submission.id)
      .single();
    expect(subRow?.status).toBe('returned');
    expect(subRow?.feedback_md).toBe('Please redo with a clearer photo.');
    expect(subRow?.reviewed_by).toBe('VT');
    expect(subRow?.ledger_entry_id).toBeNull();
  });

  it('AnonKey_CannotRead_AnyLibraryOrSubmissionTable', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error('anon key env missing — is .env.local present?');
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // Seed one row so an empty result proves RLS, not an empty table.
    const admin = adminClient();
    await makeResource(admin, 'published', 'RLS probe');

    for (const table of [
      'library_topics',
      'library_resources',
      'library_placements',
      'requirement_notes',
      'requirement_submissions'
    ]) {
      const { data, error } = await anon.from(table).select('*').limit(1);
      // RLS with zero policies: either an error or an empty result — never rows.
      if (error === null) {
        expect(data ?? []).toHaveLength(0);
      }
    }
  });
});
