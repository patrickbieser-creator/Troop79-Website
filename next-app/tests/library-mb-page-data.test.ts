import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  loadMbPageResources,
  loadMbPendingSubmissions,
  loadMbRequirementNotes,
  loadPublishedFor
} from '../src/lib/library-data';

/**
 * Library MB consolidation, Phase 1 (Plans/Library-MB-Consolidation.md) —
 * the consolidated per-badge loader the page reads instead of its
 * hand-rolled `mb_req` placement query. Phase 2 renders resources, notes and
 * the viewer's own pending proofs per requirement ROW, so the loader must
 * key by the LEAF code ('4a'), not the top-level code the old page grouped
 * by; group-level keys ('4') stay reachable under their own code.
 *
 * Real local Postgres, no mocks (D-049). Badge id `zz-mb` is synthetic —
 * `target_key` has no FK to merit_badges, so no catalog row is needed.
 * Every fixture id carries the `zz-mb` prefix and is deleted in afterAll.
 */

const MB = 'zz-mb';
const SCOUT_A = 'zz-mb-scout-a';
const SCOUT_B = 'zz-mb-scout-b';

type Admin = ReturnType<typeof adminClient>;

let admin: Admin;
const resourceIds: number[] = [];
const noteIds: number[] = [];
const submissionIds: number[] = [];

// Resource ids by role, filled in beforeAll.
const R: Record<string, number> = {};

async function purgeStale(a: Admin) {
  // A crashed earlier run leaves rows this file can't know the ids of —
  // sweep by the zz-mb prefix before building fixtures.
  await a.from('requirement_submissions').delete().like('target_key', `${MB}-%`);
  await a.from('requirement_notes').delete().like('target_key', `${MB}%`);
  await a.from('library_resources').delete().like('title', `[TEST] ${MB} %`);
  await a.from('scouts').delete().in('id', [SCOUT_A, SCOUT_B]);
}

async function makeScout(a: Admin, id: string) {
  const { error } = await a.from('scouts').insert({
    id,
    first_name: '[TEST]',
    last_name: 'Vitest',
    display_name: `[TEST] Vitest ${id}`,
    active: true
  });
  if (error) throw new Error(`fixture: scout insert failed: ${error.message}`);
}

async function makeResource(
  a: Admin,
  name: string,
  opts: { status?: 'pending' | 'published'; visibility?: 'public' | 'leaders'; createdAt?: string } = {}
): Promise<number> {
  const { data, error } = await a
    .from('library_resources')
    .insert({
      title: `[TEST] ${MB} ${name}`,
      kind: 'link',
      url: `https://example.com/${MB}/${name}`,
      status: opts.status ?? 'published',
      visibility: opts.visibility ?? 'public',
      submitted_by_label: 'Vitest Fixture',
      ...(opts.createdAt ? { created_at: opts.createdAt } : {})
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`fixture: resource insert failed: ${error?.message}`);
  resourceIds.push(data.id as number);
  return data.id as number;
}

async function place(
  a: Admin,
  resourceId: number,
  targetKind: 'mb' | 'mb_req',
  targetKey: string,
  opts: { pinned?: boolean; sortOrder?: number } = {}
) {
  const { error } = await a.from('library_placements').insert({
    resource_id: resourceId,
    target_kind: targetKind,
    target_key: targetKey,
    pinned: opts.pinned ?? false,
    sort_order: opts.sortOrder ?? 0
  });
  if (error) throw new Error(`fixture: placement insert failed: ${error.message}`);
}

async function makeNote(a: Admin, targetKind: 'mb' | 'mb_req', targetKey: string, md: string) {
  const { data, error } = await a
    .from('requirement_notes')
    .insert({ target_kind: targetKind, target_key: targetKey, narrative_md: md, updated_by: 'Vitest' })
    .select('id')
    .single();
  if (error || !data) throw new Error(`fixture: note insert failed: ${error?.message}`);
  noteIds.push(data.id as number);
}

async function makeSubmission(
  a: Admin,
  scoutId: string,
  targetKey: string,
  status: 'pending' | 'approved' | 'returned'
) {
  const { data, error } = await a
    .from('requirement_submissions')
    .insert({
      scout_id: scoutId,
      target_kind: 'mb_req',
      target_key: targetKey,
      proof_type: 'report',
      body_md: 'vitest',
      submitted_via: 'family',
      status
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`fixture: submission insert failed: ${error?.message}`);
  submissionIds.push(data.id as number);
}

beforeAll(async () => {
  admin = adminClient();
  await purgeStale(admin);
  await makeScout(admin, SCOUT_A);
  await makeScout(admin, SCOUT_B);

  // Grouping: leaves 4a / 4b, a GROUP-level placement on 4, and the badge itself.
  R.leaf4a = await makeResource(admin, 'leaf 4a');
  R.leaf4b = await makeResource(admin, 'leaf 4b');
  R.group4 = await makeResource(admin, 'group 4');
  R.whole = await makeResource(admin, 'whole badge');
  await place(admin, R.leaf4a, 'mb_req', `${MB}-4a`);
  await place(admin, R.leaf4b, 'mb_req', `${MB}-4b`);
  await place(admin, R.group4, 'mb_req', `${MB}-4`);
  await place(admin, R.whole, 'mb', MB);

  // Visibility gate: leaders-only and a still-pending resource, both on 4a.
  R.leaders4a = await makeResource(admin, 'leaders only 4a', { visibility: 'leaders' });
  R.pending4a = await makeResource(admin, 'pending 4a', { status: 'pending' });
  await place(admin, R.leaders4a, 'mb_req', `${MB}-4a`);
  await place(admin, R.pending4a, 'mb_req', `${MB}-4a`);

  // Ordering on 5a: pinned → sort_order → newest resource date.
  R.o_pinned = await makeResource(admin, 'order pinned', { createdAt: '2026-01-01T00:00:00Z' });
  R.o_older = await makeResource(admin, 'order older', { createdAt: '2026-02-01T00:00:00Z' });
  R.o_newer = await makeResource(admin, 'order newer', { createdAt: '2026-03-01T00:00:00Z' });
  R.o_sorted = await makeResource(admin, 'order sorted', { createdAt: '2026-04-01T00:00:00Z' });
  await place(admin, R.o_pinned, 'mb_req', `${MB}-5a`, { pinned: true, sortOrder: 5 });
  await place(admin, R.o_older, 'mb_req', `${MB}-5a`);
  await place(admin, R.o_newer, 'mb_req', `${MB}-5a`);
  await place(admin, R.o_sorted, 'mb_req', `${MB}-5a`, { sortOrder: 1 });

  // Notes: one leaf, one group, one whole-badge narrative.
  await makeNote(admin, 'mb_req', `${MB}-4a`, 'Leaf note 4a');
  await makeNote(admin, 'mb_req', `${MB}-4`, 'Group note 4');
  await makeNote(admin, 'mb', MB, 'Whole-badge narrative');

  // Pending proofs: A pending on 4a, B pending on 4b, A already approved on 4b.
  await makeSubmission(admin, SCOUT_A, `${MB}-4a`, 'pending');
  await makeSubmission(admin, SCOUT_B, `${MB}-4b`, 'pending');
  await makeSubmission(admin, SCOUT_A, `${MB}-4b`, 'approved');
});

afterAll(async () => {
  // Submissions before scouts (FK), resources cascade their placements.
  if (submissionIds.length) await admin.from('requirement_submissions').delete().in('id', submissionIds);
  if (noteIds.length) await admin.from('requirement_notes').delete().in('id', noteIds);
  if (resourceIds.length) await admin.from('library_resources').delete().in('id', resourceIds);
  await admin.from('scouts').delete().in('id', [SCOUT_A, SCOUT_B]);
});

const ids = (list: { id: number }[] | undefined) => (list ?? []).map((r) => r.id);

describe('Library MB page data — consolidated loader (Phase 1)', () => {
  it('Visitor_SeesResourcesGroupedByLeafRequirement_WhenViewingMbPage', async () => {
    const { byLeafCode } = await loadMbPageResources(admin, MB, false);
    expect({
      '4a': ids(byLeafCode.get('4a')),
      '4b': ids(byLeafCode.get('4b')),
      '4': ids(byLeafCode.get('4'))
    }).toEqual({ '4a': [R.leaf4a], '4b': [R.leaf4b], '4': [R.group4] });
  });

  it('Visitor_SeesWholeBadgeResources_AlongsideLeafResources_OnOnePage', async () => {
    const { wholeBadge, byLeafCode } = await loadMbPageResources(admin, MB, false);
    const viaOldPath = await loadPublishedFor(admin, 'mb', MB, false);
    expect({
      whole: ids(wholeBadge),
      sameAsToday: ids(wholeBadge).join(',') === ids(viaOldPath).join(','),
      wholeLeakedIntoLeaves: [...byLeafCode.values()].some((l) => ids(l).includes(R.whole))
    }).toEqual({ whole: [R.whole], sameAsToday: true, wholeLeakedIntoLeaves: false });
  });

  it('Leader_SeesLeaderOnlyResources_VisitorDoesNot', async () => {
    const visitor = await loadMbPageResources(admin, MB, false);
    const leader = await loadMbPageResources(admin, MB, true);
    expect({
      visitorSeesLeadersOnly: ids(visitor.byLeafCode.get('4a')).includes(R.leaders4a),
      leaderSeesLeadersOnly: ids(leader.byLeafCode.get('4a')).includes(R.leaders4a),
      anyoneSeesPending:
        ids(visitor.byLeafCode.get('4a')).includes(R.pending4a) ||
        ids(leader.byLeafCode.get('4a')).includes(R.pending4a)
    }).toEqual({ visitorSeesLeadersOnly: false, leaderSeesLeadersOnly: true, anyoneSeesPending: false });
  });

  it('Resources_OrderPinnedThenSortOrderThenNewest', async () => {
    const { byLeafCode } = await loadMbPageResources(admin, MB, false);
    // pinned first; then sort_order 0 ties read newest resource first; then sort_order 1.
    expect(ids(byLeafCode.get('5a'))).toEqual([R.o_pinned, R.o_newer, R.o_older, R.o_sorted]);
  });

  it('Family_SeesOwnPendingSubmissions_ByLeaf_NotAnotherFamilys', async () => {
    const own = await loadMbPendingSubmissions(admin, MB, [SCOUT_A]);
    const nobody = await loadMbPendingSubmissions(admin, MB, []);
    expect({
      keys: [...own.keys()],
      on4a: [...(own.get('4a') ?? [])],
      nobody: nobody.size
    }).toEqual({ keys: ['4a'], on4a: [SCOUT_A], nobody: 0 });
  });

  it('Notes_KeyedByLeafCode', async () => {
    const notes = await loadMbRequirementNotes(admin, MB);
    expect({
      keys: [...notes.byLeafCode.keys()].sort(),
      leaf: notes.byLeafCode.get('4a')?.narrative_md,
      group: notes.byLeafCode.get('4')?.narrative_md,
      whole: notes.wholeBadge?.narrative_md
    }).toEqual({ keys: ['4', '4a'], leaf: 'Leaf note 4a', group: 'Group note 4', whole: 'Whole-badge narrative' });
  });
});
