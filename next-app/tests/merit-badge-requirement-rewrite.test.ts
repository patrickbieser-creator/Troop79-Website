import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import type { Capability } from '../src/lib/capabilities';

/**
 * Merit Badge Catalog editor: saving a badge rewrites its requirement tree (delete, then re-insert). What the editor
 * doesn't send — each requirement's teach_minutes and venue — must ride through the rewrite, matched by code (the
 * original code when a requirement is renamed). A test-owned badge; cleanup by its id.
 */
const admin = adminClient();
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/admin-actor', () => ({
  resolveAdminActor: async () => ({ kind: 'identity', label: 'Vitest Leader', personId: null, capabilities: new Set(['roster.manage']) as Set<Capability>, legacyRole: null, subjectKind: 'adult' }),
  actorHas: () => true
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const MB = `vitest-mbr-${process.pid}`;

type Node = { id?: number; originalCode?: string; code: string; label: string; complete_rule: 'all'; complete_n: null; children: Node[] };
const node = (code: string, children: Node[] = [], originalCode = code): Node => ({ id: 1, originalCode, code, label: `Req ${code}`, complete_rule: 'all', complete_n: null, children });

beforeEach(async () => {
  await admin.from('merit_badges').insert({ id: MB, name: `${TEST_PREFIX} Rewrite` });
  const { data: one } = await admin.from('merit_badge_requirements').insert({ mb_id: MB, code: '1', label: 'Req 1', teach_minutes: 40, venue: 'outing', sort_order: 0 }).select('id').single();
  await admin.from('merit_badge_requirements').insert({ mb_id: MB, code: '1a', label: 'Req 1a', parent_id: one!.id, teach_minutes: 25, sort_order: 0 });
  await admin.from('merit_badge_requirements').insert({ mb_id: MB, code: '2', label: 'Req 2', teach_minutes: 30, sort_order: 1 });
});
afterEach(async () => {
  await admin.from('merit_badges').delete().eq('id', MB);
});

async function save(tree: Node[]) {
  const { updateMeritBadge } = await import('../src/app/admin/(workspace)/advancement/lookups/actions');
  const fd = new FormData();
  fd.set('id', MB);
  fd.set('name', `${TEST_PREFIX} Rewrite`);
  fd.set('counselors', '[]');
  fd.set('reqTree', JSON.stringify(tree));
  const res = await updateMeritBadge(fd);
  if (!res.ok) throw new Error(res.error);
}
const rows = async () =>
  Object.fromEntries(
    (((await admin.from('merit_badge_requirements').select('code, teach_minutes, venue').eq('mb_id', MB)).data ?? []) as { code: string; teach_minutes: number; venue: string }[]).map((r) => [
      r.code,
      [r.teach_minutes, r.venue]
    ])
  );

describe('Merit Badge Catalog save keeps per-requirement data', () => {
  it('Save_KeepsEachRequirementsTeachMinutes', async () => {
    await save([node('1', [node('1a')]), node('2')]);
    const r = await rows();
    expect([r['1'][0], r['1a'][0], r['2'][0]]).toEqual([40, 25, 30]);
  });

  it('Save_KeepsEachRequirementsVenue', async () => {
    await save([node('1', [node('1a')]), node('2')]);
    expect((await rows())['1'][1]).toBe('outing');
  });

  it('Save_RenamedRequirement_KeepsItsTeachMinutes', async () => {
    await save([node('1', [node('1a')]), node('3', [], '2')]);
    expect((await rows())['3'][0]).toBe(30);
  });

  it('Save_NewRequirement_GetsTheDefaultMinutes', async () => {
    await save([node('1', [node('1a')]), node('2'), { ...node('4'), id: undefined, originalCode: undefined }]);
    expect((await rows())['4'][0]).toBe(15);
  });
});
