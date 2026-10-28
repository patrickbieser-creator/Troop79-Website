import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Admin › Lookups › Requirement classes and the Req codes tags (Plans/Requirement-Classification.md step 2).
 * Test-owned: class 'Q' and one badge with one requirement; cleanup by them.
 */
const admin = adminClient();
let allowed = true;
vi.mock('@/lib/require-capability', () => ({
  requireCapability: async () => {
    if (!allowed) throw new Error('This action requires: Roster.');
    return { personId: null };
  }
}));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => null, actorHas: () => true }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const MB = `vitest-rcla-${process.pid}`;
let reqId = 0;

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const actions = () => import('../src/app/admin/(workspace)/advancement/lookups/requirement-class-actions');
const classQ = async () => (await admin.from('requirement_classes').select('name, description, retired_at').eq('code', 'Q').maybeSingle()).data;

async function tag(classCodes: string[]) {
  const { updateReqCode } = await import('../src/app/admin/(workspace)/advancement/lookups/actions');
  return updateReqCode(
    fd({ id: String(reqId), source: 'mb', parent_id: MB, original_code: '1', code: '1', label: 'Req 1', official_text: '', class_codes: JSON.stringify(classCodes) })
  );
}
const tagsNow = async () => ((await admin.from('merit_badge_requirements').select('class_codes').eq('id', reqId).single()).data as { class_codes: string[] }).class_codes;

beforeAll(async () => {
  await admin.from('merit_badges').insert({ id: MB, name: `${TEST_PREFIX} Class actions` });
  const { data } = await admin.from('merit_badge_requirements').insert({ mb_id: MB, code: '1', label: 'Req 1', sort_order: 0 }).select('id').single();
  reqId = (data as { id: number }).id;
});
afterEach(async () => {
  allowed = true;
  await admin.from('merit_badge_requirements').update({ class_codes: [] }).eq('id', reqId);
  await admin.from('requirement_classes').delete().eq('code', 'Q');
});
afterAll(async () => {
  await admin.from('merit_badges').delete().eq('id', MB);
});

describe('requirement class actions', () => {
  it('Admin_CanAddARequirementClass', async () => {
    const { createRequirementClass } = await actions();
    expect(await createRequirementClass(fd({ code: 'q', name: `${TEST_PREFIX} Quiz`, description: 'A test class' }))).toEqual({ ok: true });
  });

  it('Admin_CanEditAClassesNameAndDescription', async () => {
    const { createRequirementClass, updateRequirementClass } = await actions();
    await createRequirementClass(fd({ code: 'Q', name: `${TEST_PREFIX} Quiz`, description: '' }));
    await updateRequirementClass(fd({ code: 'Q', name: `${TEST_PREFIX} Quiz night`, description: 'Edited' }));
    expect(await classQ()).toMatchObject({ name: `${TEST_PREFIX} Quiz night`, description: 'Edited' });
  });

  it('Admin_CanRetireAndRestoreAClass', async () => {
    const { createRequirementClass, setRequirementClassRetired } = await actions();
    await createRequirementClass(fd({ code: 'Q', name: `${TEST_PREFIX} Quiz`, description: '' }));
    await setRequirementClassRetired(fd({ code: 'Q', retired: 'true' }));
    const retired = (await classQ())?.retired_at != null;
    await setRequirementClassRetired(fd({ code: 'Q', retired: 'false' }));
    expect([retired, (await classQ())?.retired_at]).toEqual([true, null]);
  });

  it('Admin_CannotDeleteAClass_WhileARequirementUsesIt', async () => {
    const { createRequirementClass, deleteRequirementClass } = await actions();
    await createRequirementClass(fd({ code: 'Q', name: `${TEST_PREFIX} Quiz`, description: '' }));
    await tag(['Q']);
    expect((await deleteRequirementClass(fd({ code: 'Q' }))).error).toMatch(/in use by 1 requirement\. Retire it instead/);
  });

  it('Admin_CanDeleteAnUnusedClass', async () => {
    const { createRequirementClass, deleteRequirementClass } = await actions();
    await createRequirementClass(fd({ code: 'Q', name: `${TEST_PREFIX} Quiz`, description: '' }));
    await deleteRequirementClass(fd({ code: 'Q' }));
    expect(await classQ()).toBeNull();
  });

  it('AddingAClass_RefusesACodeThatIsNotOneLetter', async () => {
    const { createRequirementClass } = await actions();
    expect((await createRequirementClass(fd({ code: 'QQ', name: 'x', description: '' }))).ok).toBe(false);
  });

  it('NonLeader_CannotChangeClasses', async () => {
    const { createRequirementClass } = await actions();
    allowed = false;
    await createRequirementClass(fd({ code: 'Q', name: `${TEST_PREFIX} Quiz`, description: '' }));
    expect(await classQ()).toBeNull();
  });
});

describe('Req codes class tags', () => {
  it('Admin_CanTagARequirementWithSeveralClasses', async () => {
    await tag(['M', 'e']);
    expect(await tagsNow()).toEqual(['M', 'E']);
  });

  it('Admin_CannotSaveAnUnknownTag', async () => {
    expect((await tag(['Z'])).error).toMatch(/Z isn't a requirement class/);
  });

  it('Admin_CannotAddARetiredTag', async () => {
    const { createRequirementClass, setRequirementClassRetired } = await actions();
    await createRequirementClass(fd({ code: 'Q', name: `${TEST_PREFIX} Quiz`, description: '' }));
    await setRequirementClassRetired(fd({ code: 'Q', retired: 'true' }));
    expect((await tag(['Q'])).error).toMatch(/Q is retired/);
  });

  it('RetiredTag_AlreadyOnARequirement_SurvivesASave', async () => {
    const { createRequirementClass, setRequirementClassRetired } = await actions();
    await createRequirementClass(fd({ code: 'Q', name: `${TEST_PREFIX} Quiz`, description: '' }));
    await tag(['Q']);
    await setRequirementClassRetired(fd({ code: 'Q', retired: 'true' }));
    await tag(['Q', 'M']);
    expect(await tagsNow()).toEqual(['Q', 'M']);
  });

  it('NonLeader_CannotTagRequirements', async () => {
    allowed = false;
    await tag(['A']);
    expect(await tagsNow()).toEqual([]);
  });
});
