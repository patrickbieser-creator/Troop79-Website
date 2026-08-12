import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  createResource,
  loadPublishedFor,
  searchPublishedResources
} from '../src/lib/library-data';
import { validateNewResource } from '../src/lib/library';
import { DOCUMENT_UPLOAD_TYPES, IMAGE_UPLOAD_TYPES, checkUpload } from '../src/lib/upload-limits';

/**
 * Admin resource entry (Plans/Library-Admin-Resource-Entry.md).
 *
 * Until now a library_resources row could only be born on the PUBLIC submit
 * form (link-shaped, always pending) or the sparkler import script — so the
 * webmaster stocked the library by submitting as a family and approving their
 * own submission, and three of the five kinds were unreachable entirely.
 *
 * Two invariants carry the most risk and are covered hardest here:
 *   1. an admin-created resource publishes directly (Patrick 2026-08-12) but
 *      an incomplete one must NOT — completeness is enforced at publish, since
 *      the schema deliberately allows a messy pending row;
 *   2. visibility='leaders' must actually hide the resource from public
 *      loaders. The column shipped with the library but no loader ever
 *      filtered on it, so exposing the control without the filter would leak
 *      leaders-only material to every family.
 */

const TEST_TOPIC_KEY = 'test-admin-entry-vitest';
const REVIEWER = 'VITEST';

describe('admin resource entry', () => {
  let resourceIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    // Placements cascade on resource delete.
    if (resourceIds.length > 0) {
      await admin.from('library_resources').delete().in('id', resourceIds);
    }
    resourceIds = [];
  });

  /** Runs createResource and remembers the id for cleanup, pass or fail. */
  async function create(
    admin: ReturnType<typeof adminClient>,
    input: Parameters<typeof createResource>[1]
  ) {
    const res = await createResource(admin, input, REVIEWER);
    if (res.id) resourceIds.push(res.id);
    return res;
  }

  it('AdminResource_IsPublishedOnSave_WhenCreatedByWebmaster', async () => {
    const admin = adminClient();
    const { error, id } = await create(admin, {
      title: '[TEST] Knot tying walkthrough',
      kind: 'link',
      url: 'https://example.com/knots',
      publish: true,
      visibility: 'public',
      placements: []
    });
    expect(error).toBeNull();

    const { data } = await admin
      .from('library_resources')
      .select('status, reviewed_by, reviewed_at, submitted_by_label')
      .eq('id', id!)
      .single();
    expect(data!.status).toBe('published');
    expect(data!.reviewed_by).toBe(REVIEWER);
    expect(data!.reviewed_at).not.toBeNull();
    // No submitter — this is how the queue tells an admin draft apart from a
    // family submission, which always carries a name.
    expect(data!.submitted_by_label).toBeNull();
  });

  it('AdminResource_IsPending_WhenSavedAsDraft', async () => {
    const admin = adminClient();
    const { error, id } = await create(admin, {
      title: '[TEST] Half-written post',
      kind: 'post',
      bodyMd: 'Notes so far…',
      publish: false,
      visibility: 'public',
      placements: []
    });
    expect(error).toBeNull();

    const { data } = await admin.from('library_resources').select('status').eq('id', id!).single();
    expect(data!.status).toBe('pending');
  });

  it('AdminResource_AppearsOnItsTargets_WhenPlacementsChosenAtCreation', async () => {
    const admin = adminClient();
    const { error, id } = await create(admin, {
      title: '[TEST] Placed at creation',
      kind: 'link',
      url: 'https://example.com/placed',
      publish: true,
      visibility: 'public',
      placements: [{ targetKind: 'topic', targetKey: TEST_TOPIC_KEY }]
    });
    expect(error).toBeNull();

    const placed = await loadPublishedFor(admin, 'topic', TEST_TOPIC_KEY);
    expect(placed.map((r) => r.id)).toContain(id);
  });

  it('AdminResource_RejectsNonHttpUrl_WhenUrlSupplied', async () => {
    const admin = adminClient();
    const { error, id } = await create(admin, {
      title: '[TEST] Sneaky scheme',
      kind: 'link',
      url: 'javascript:alert(1)',
      publish: true,
      visibility: 'public',
      placements: []
    });
    expect(error).toMatch(/http/i);
    expect(id).toBeUndefined();
  });

  it('AdminResource_RequiresBodyForPostKind_WhenPublishing', async () => {
    const admin = adminClient();
    const { error, id } = await create(admin, {
      title: '[TEST] Empty post',
      kind: 'post',
      publish: true,
      visibility: 'public',
      placements: []
    });
    expect(error).not.toBeNull();
    expect(id).toBeUndefined();
  });

  it('AdminResource_RequiresUrlForLinkKinds_WhenPublishing', async () => {
    const admin = adminClient();
    const { error, id } = await create(admin, {
      title: '[TEST] Link with nowhere to go',
      kind: 'video',
      publish: true,
      visibility: 'public',
      placements: []
    });
    expect(error).not.toBeNull();
    expect(id).toBeUndefined();
  });

  it('AdminDraft_SkipsCompletenessChecks_WhenNotPublishing', async () => {
    // The other half of the rule above: an unfinished draft is allowed to be
    // incomplete, exactly as a messy family submission is.
    const admin = adminClient();
    const { error, id } = await create(admin, {
      title: '[TEST] Nothing but a title',
      kind: 'document',
      publish: false,
      visibility: 'public',
      placements: []
    });
    expect(error).toBeNull();
    expect(id).toBeDefined();
  });

  it('LeadersOnlyResource_IsHiddenFromPublicLoaders_WhenVisibilityIsLeaders', async () => {
    const admin = adminClient();
    const { id } = await create(admin, {
      title: '[TEST] Leaders only handbook',
      kind: 'link',
      url: 'https://example.com/leaders-only',
      publish: true,
      visibility: 'leaders',
      placements: [{ targetKind: 'topic', targetKey: TEST_TOPIC_KEY }]
    });

    const placed = await loadPublishedFor(admin, 'topic', TEST_TOPIC_KEY);
    expect(placed.map((r) => r.id)).not.toContain(id);

    const hits = await searchPublishedResources(admin, 'Leaders only handbook');
    expect(hits.map((r) => r.id)).not.toContain(id);
  });

  it('LeadersOnlyResource_IsVisibleToLeaders_WhenViewerIsLeader', async () => {
    const admin = adminClient();
    const { id } = await create(admin, {
      title: '[TEST] Leaders only handbook',
      kind: 'link',
      url: 'https://example.com/leaders-only',
      publish: true,
      visibility: 'leaders',
      placements: [{ targetKind: 'topic', targetKey: TEST_TOPIC_KEY }]
    });

    const placed = await loadPublishedFor(admin, 'topic', TEST_TOPIC_KEY, true);
    expect(placed.map((r) => r.id)).toContain(id);

    const hits = await searchPublishedResources(admin, 'Leaders only handbook', true);
    expect(hits.map((r) => r.id)).toContain(id);
  });

  it('SearchIndex_IncludesAdminCreatedPost_WhenBodyMdSupplied', async () => {
    const admin = adminClient();
    const { id } = await create(admin, {
      title: '[TEST] Weekly notes',
      kind: 'post',
      bodyMd: 'This week the patrol practiced **pioneering** with a monkey bridge.',
      publish: true,
      visibility: 'public',
      placements: []
    });

    const hits = await searchPublishedResources(admin, 'pioneering');
    expect(hits.map((r) => r.id)).toContain(id);
  });
});

describe('resource entry validation (pure)', () => {
  const base = { title: 'A resource', visibility: 'public' as const, placements: [] };

  it('Validation_RequiresTitle_Always', () => {
    expect(validateNewResource({ ...base, title: '  ', kind: 'link', url: 'https://x.test', publish: false }))
      .toMatch(/title/i);
  });

  it('Validation_RejectsNonHttpUrl_EvenOnADraft', () => {
    // A bad scheme is never storable — unlike missing content, it can't be
    // "finished later" and it lands in an href (D-060 guards both paths).
    expect(validateNewResource({ ...base, kind: 'link', url: 'ftp://files.test/x', publish: false }))
      .toMatch(/http/i);
  });

  it('Validation_AcceptsPostWithBody_WhenPublishing', () => {
    expect(validateNewResource({ ...base, kind: 'post', bodyMd: 'Hello', publish: true })).toBeNull();
  });
});

describe('upload limits (pure)', () => {
  it('PdfUpload_IsAccepted_WhenUnderSizeLimit', () => {
    expect(checkUpload({ type: 'application/pdf', size: 2_000_000 }, DOCUMENT_UPLOAD_TYPES)).toBeNull();
  });

  it('Upload_RejectsDisallowedType_WhenNotInTheAllowedSet', () => {
    expect(checkUpload({ type: 'application/pdf', size: 2_000_000 }, IMAGE_UPLOAD_TYPES)).toMatch(/type/i);
    expect(checkUpload({ type: 'image/png', size: 2_000_000 }, DOCUMENT_UPLOAD_TYPES)).toMatch(/type/i);
  });

  it('Upload_RejectsOversizeFile_WhenOverTheLimit', () => {
    expect(checkUpload({ type: 'image/png', size: 99_000_000 }, IMAGE_UPLOAD_TYPES)).toMatch(/large|size/i);
  });
});
