import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import {
  approveResource,
  cascadeLibraryReqRename,
  loadPublishedFor
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

  afterEach(async () => {
    const admin = adminClient();
    // Resources first — placements cascade on resource delete.
    if (submissionIds.length > 0) {
      await admin.from('requirement_submissions').delete().in('id', submissionIds);
    }
    if (noteIds.length > 0) {
      await admin.from('requirement_notes').delete().in('id', noteIds);
    }
    if (resourceIds.length > 0) {
      await admin.from('library_resources').delete().in('id', resourceIds);
    }
    resourceIds = [];
    noteIds = [];
    submissionIds = [];
  });

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

    const { data: scout } = await admin.from('scouts').select('id').limit(1).single();
    if (!scout) throw new Error('fixture: no scouts in local DB');
    const { data: submission, error: subErr } = await admin
      .from('requirement_submissions')
      .insert({
        scout_id: scout.id,
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
