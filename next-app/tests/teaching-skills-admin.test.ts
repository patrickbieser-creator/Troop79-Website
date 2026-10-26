import { describe, it, expect, vi, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import type { Capability } from '../src/lib/capabilities';

/**
 * Admin › Lookups writes teaching skills by person (Phase 0a): one action for adults and scouts, diffing rather than
 * delete-then-insert (a mid-way failure can't wipe a person's skills), with the youth-teachable guard on the server.
 */
const admin = adminClient();
const state = vi.hoisted(() => ({ caps: new Set<string>(['roster.manage']) }));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/admin-actor', () => ({
  resolveAdminActor: async () => ({ kind: 'identity', label: 'Vitest Leader', personId: null, capabilities: state.caps as Set<Capability>, legacyRole: null, subjectKind: 'adult' }),
  actorHas: () => true
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

let personIds: number[] = [];
let scoutIds: string[] = [];
afterEach(async () => {
  if (scoutIds.length) await admin.from('scouts').delete().in('id', scoutIds);
  if (personIds.length) {
    await admin.from('teaching_skills').delete().in('person_id', personIds);
    await admin.from('people').delete().in('id', personIds);
  }
  personIds = [];
  scoutIds = [];
  state.caps = new Set(['roster.manage']);
});

async function makePerson(label: string): Promise<number> {
  const { data } = await admin.from('people').insert({ display_name: `${TEST_PREFIX} TS ${label}` }).select('id').single();
  personIds.push(data!.id);
  return data!.id;
}
async function makeScout(label: string): Promise<number> {
  const personId = await makePerson(label);
  const id = `vitest-ts-${personId}`;
  const { error } = await admin.from('scouts').insert({ id, first_name: TEST_PREFIX, last_name: label, display_name: `${TEST_PREFIX} TS ${label}`, person_id: personId, active: true });
  if (error) throw new Error(`fixture scout: ${error.message}`);
  scoutIds.push(id);
  return personId;
}
const save = async (personId: number, skills: string[]) => {
  const { setTeachingSkills } = await import('../src/app/admin/(workspace)/advancement/lookups/actions');
  const fd = new FormData();
  fd.set('person_id', String(personId));
  fd.set('skill_ids', JSON.stringify(skills));
  return setTeachingSkills(fd);
};
const skillsOf = async (personId: number) => ((await admin.from('teaching_skills').select('skill_id').eq('person_id', personId).order('skill_id')).data ?? []).map((r) => r.skill_id);

describe('setTeachingSkills', () => {
  it('Parent_WithoutLeaderCode_CanBeGivenTeachingSkills', async () => {
    const parent = await makePerson('Parent');
    expect(await save(parent, ['first-aid', 'knots'])).toMatchObject({ ok: true });
    expect(await skillsOf(parent)).toEqual(['first-aid', 'knots']);
  });

  it('SetTeachingSkills_KeepsAnUnchangedRow_AndRemovesOnlyWhatWasDropped', async () => {
    const parent = await makePerson('Diff');
    await save(parent, ['first-aid', 'knots']);
    const before = (await admin.from('teaching_skills').select('authorized_at').eq('person_id', parent).eq('skill_id', 'knots').single()).data!.authorized_at;
    expect(await save(parent, ['knots'])).toMatchObject({ ok: true });
    const after = (await admin.from('teaching_skills').select('authorized_at').eq('person_id', parent).eq('skill_id', 'knots').single()).data!.authorized_at;
    expect([await skillsOf(parent), after]).toEqual([['knots'], before]);
  });

  it('JuniorLeader_IsRefusedAdultOnlySkill_WhenPostedDirectly', async () => {
    const scout = await makeScout('Scout');
    expect(await save(scout, ['first-aid'])).toMatchObject({ ok: false });
    expect(await skillsOf(scout)).toEqual([]);
  });

  // qa-lead: a merged-away record must not quietly collect skills.
  it('SetTeachingSkills_RefusesAPersonMergedIntoAnother', async () => {
    const keep = await makePerson('Keep');
    const gone = await makePerson('Gone');
    await admin.from('people').update({ merged_into_person_id: keep }).eq('id', gone);
    expect(await save(gone, ['knots'])).toMatchObject({ ok: false });
    expect(await skillsOf(gone)).toEqual([]);
  });

  it('SetTeachingSkills_RequiresRosterManage', async () => {
    const parent = await makePerson('Gate');
    state.caps = new Set(['news.write']);
    expect(await save(parent, ['knots'])).toMatchObject({ ok: false });
    expect(await skillsOf(parent)).toEqual([]);
  });
});

describe('merit badge counselors save', () => {
  // Summer Camp stands in for the council camp staff (Patrick, 2026-10-18): pickable next to people.
  it('SaveCounselors_SummerCampAndAParent_BothKeptInOrder', async () => {
    const parent = await makePerson('Counselor');
    const { updateMeritBadge } = await import('../src/app/admin/(workspace)/advancement/lookups/actions');
    const { data: mb } = await admin.from('merit_badges').select('id, name, eagle, scoutbook_id, bsa_page_url, workbook_url').eq('id', 'art').single();
    const { data: before } = await admin.from('merit_badge_counselors').select('person_id, leader_code').eq('mb_id', 'art').order('sort_order');
    const form = (counselors: unknown[]) => {
      const fd = new FormData();
      fd.set('id', mb!.id);
      fd.set('name', mb!.name);
      fd.set('eagle', String(mb!.eagle));
      fd.set('scoutbook_id', mb!.scoutbook_id ?? '');
      fd.set('bsa_page_url', mb!.bsa_page_url ?? '');
      fd.set('workbook_url', mb!.workbook_url ?? '');
      fd.set('counselors', JSON.stringify(counselors));
      return fd;
    };
    try {
      await updateMeritBadge(form([{ leader_code: 'Camp' }, { person_id: parent }, { leader_code: 'Camp' }]));
      const { data } = await admin.from('merit_badge_counselors').select('person_id, leader_code').eq('mb_id', 'art').order('sort_order');
      expect(data).toEqual([{ person_id: null, leader_code: 'Camp' }, { person_id: parent, leader_code: null }]);
    } finally {
      await updateMeritBadge(form((before ?? []).map((c) => (c.person_id != null ? { person_id: c.person_id } : { leader_code: c.leader_code }))));
    }
  });
});

describe('Delete on Adult Skills (2026-10-26)', () => {
  // Patrick: removing an adult as a teacher must leave every ledger entry they signed off untouched. Delete is a save
  // of no skills, so it may touch teaching_skills and the change log only.
  it('DeletingAnAdultsSkills_LeavesTheLedgerEntriesTheySignedIntact', async () => {
    const adult = await makePerson('Signer');
    const scout = await makeScout('Signed');
    const code = `VT${adult}`;
    const { error: le } = await admin.from('leaders').insert({ code, name: `${TEST_PREFIX} TS Signer`, person_id: adult });
    if (le) throw new Error(`fixture leader: ${le.message}`);
    const { data: entry, error: ee } = await admin
      .from('ledger_entries')
      .insert({ scout_id: `vitest-ts-${scout}`, kind: 'rank_requirement', code: 'tenderfoot-1a', date: '2026-01-04', by: code })
      .select('*')
      .single();
    if (ee) throw new Error(`fixture entry: ${ee.message}`);
    try {
      expect(await save(adult, ['knots'])).toMatchObject({ ok: true });
      expect(await save(adult, [])).toMatchObject({ ok: true });
      const { data: after } = await admin.from('ledger_entries').select('*').eq('id', entry!.id).single();
      expect(after).toEqual(entry);
    } finally {
      await admin.from('ledger_entries').delete().eq('id', entry!.id);
      await admin.from('teaching_skill_changes').delete().eq('person_id', adult);
      await admin.from('leaders').delete().eq('code', code);
    }
  });
});
