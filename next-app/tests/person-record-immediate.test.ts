import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * Person Editor Rethink, Phase 3 (Plans/Person-Editor-Rethink.md) — the one
 * server-action change behind the immediate blocks. createAdultForScout has
 * always LINKED an existing person when the typed email is already on record
 * (rather than creating a second copy); it now says which happened through
 * `linked: true`, so the record page's Parents & guardians block can report
 * "already belonged to someone — linked them" instead of "Added".
 *
 * Same request-glue mocks as person-record-writes.test.ts; the DB is real.
 */
const actor = { kind: 'identity', label: 'ZZ Vitest Leader', personId: null, capabilities: new Set(['roster.manage']) };
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => actor }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => actor }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => adminClient() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, updateTag: () => undefined, revalidateTag: () => undefined }));

import { createAdultForScout } from '../src/app/admin/(workspace)/advancement/roster/person-actions';

const admin = adminClient();
const EXISTING_EMAIL = 'zzimm.parent@example.com';
const NEW_EMAIL = 'zzimm.newparent@example.com';
let scoutPersonId = 0;
let existingAdultId = 0;
const created: number[] = [];

async function insertPerson(row: Record<string, unknown>): Promise<number> {
  const { data, error } = await admin.from('people').insert(row).select('id').single();
  if (error || !data) throw new Error(`fixture: people insert failed: ${error?.message}`);
  return (data as { id: number }).id;
}

beforeAll(async () => {
  scoutPersonId = await insertPerson({
    first_name: 'ZZImm',
    last_name: 'Scout',
    display_name: 'ZZImm Scout',
    active: true
  });
  existingAdultId = await insertPerson({
    first_name: 'ZZImm',
    last_name: 'Parent',
    display_name: 'ZZImm Parent',
    primary_email: EXISTING_EMAIL,
    active: true
  });
});

afterAll(async () => {
  const ids = [scoutPersonId, existingAdultId, ...created].filter((id) => id > 0);
  await admin.from('relationships').delete().or(`person_id.in.(${ids.join(',')}),related_person_id.in.(${ids.join(',')})`);
  await admin.from('person_emails').delete().in('person_id', ids);
  await admin.from('people').delete().in('id', ids);
});

describe('createAdultForScout — link-or-create by email', () => {
  it('CreateAdultForScout_LinksExisting_AndSaysSo_WhenEmailAlreadyOnRecord', async () => {
    const before = await admin.from('people').select('id', { count: 'exact', head: true }).ilike('display_name', 'ZZImm%');

    const res = await createAdultForScout(scoutPersonId, 'Someone Typed', EXISTING_EMAIL.toUpperCase(), '', 'parent_of', true);
    expect(res).toEqual({ ok: true, personId: existingAdultId, linked: true });

    // No second copy of the parent…
    const after = await admin.from('people').select('id', { count: 'exact', head: true }).ilike('display_name', 'ZZImm%');
    expect(after.count).toBe(before.count);
    // …and the relationship points at the existing person.
    const { data: rel } = await admin
      .from('relationships')
      .select('person_id, type, is_guardian')
      .eq('related_person_id', scoutPersonId)
      .eq('person_id', existingAdultId)
      .maybeSingle();
    expect(rel).toEqual({ person_id: existingAdultId, type: 'parent_of', is_guardian: true });
  });

  it('CreateAdultForScout_CreatesAndLinks_WhenEmailIsNew', async () => {
    const res = await createAdultForScout(scoutPersonId, 'ZZImm Newparent', NEW_EMAIL, '(414) 555-0199', 'guardian_of', false);
    expect(res.ok).toBe(true);
    expect(res.linked).toBeUndefined();
    expect(res.personId).toBeTypeOf('number');
    created.push(res.personId as number);
    expect(res.personId).not.toBe(existingAdultId);

    const { data: person } = await admin.from('people').select('display_name').eq('id', res.personId!).maybeSingle();
    expect(person).toEqual({ display_name: 'ZZImm Newparent' });
  });
});
