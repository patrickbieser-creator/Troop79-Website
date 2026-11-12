import { describe, it, expect, vi, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * Sign-off initials on the person record (Plans/Sign-Off-Initials.md,
 * 20270101130000_sign_off_initials). Real local DB; request glue mocked as in
 * webelos-roster-actions-db. Test-owned codes only (ZQ…), people named
 * "ZZ Initials …", every row removed in afterEach.
 */
const actor = { kind: 'identity', label: 'ZZ Vitest Leader', personId: null, capabilities: new Set(['roster.manage']) };
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => actor }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => actor }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => adminClient() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, updateTag: () => undefined, revalidateTag: () => undefined }));

import {
  addInitials,
  renameInitials,
  setInitialsRetired
} from '../src/app/admin/(workspace)/advancement/roster/[personId]/initials-actions';
import { promoteScoutToAdult } from '../src/app/admin/(workspace)/advancement/lookups/actions';
import { loadSignOffChoices } from '../src/lib/sign-off-pickers';

const admin = adminClient();
const LAST = 'ZZInitials';
const SCOUT = 'ZZINI1';
let people: number[] = [];

afterEach(async () => {
  await admin.from('ledger_entries').delete().eq('scout_id', SCOUT);
  await admin.from('scouts').delete().eq('id', SCOUT);
  await admin.from('library_superusers').delete().like('leader_code', 'ZQ%');
  await admin.from('leaders').delete().like('code', 'ZQ%');
  await admin.from('leaders').delete().like('code', 'zq%');
  if (people.length) {
    await admin.from('audit_log').delete().eq('entity_type', 'person').in('entity_id', people.map(String));
    await admin.from('people').delete().in('id', people);
  }
  people = [];
});

async function person(first: string): Promise<number> {
  const { data, error } = await admin
    .from('people')
    .insert({ first_name: first, last_name: LAST, display_name: `${first} ${LAST}` })
    .select('id')
    .single();
  if (error || !data) throw new Error(`fixture person: ${error?.message}`);
  people.push(data.id as number);
  return data.id as number;
}

async function scoutWithEntries(dates: string[], by: string) {
  const pid = await person('Scouty');
  await admin.from('scouts').insert({ id: SCOUT, first_name: 'Scouty', last_name: LAST, display_name: `Scouty ${LAST}`, active: true, person_id: pid });
  for (const date of dates) {
    const { error } = await admin.from('ledger_entries').insert({
      scout_id: SCOUT, date, kind: 'rank_requirement', code: 'tenderfoot-1a', label: 'ZZ', by, entered_by: 'ZZ'
    });
    if (error) throw new Error(`fixture ledger: ${error.message}`);
  }
}

const leaderRow = async (code: string) =>
  (await admin.from('leaders').select('code, person_id, can_login, retired_at').eq('code', code).maybeSingle()).data;
const byOf = async () =>
  ((await admin.from('ledger_entries').select('id, by').eq('scout_id', SCOUT).order('id')).data ?? []) as { id: number; by: string }[];

describe('Sign-off initials — add', () => {
  it('Leader_CanAddInitials_ToAParentWithNone', async () => {
    const pid = await person('Ada');
    expect(await addInitials(pid, 'ZQA')).toEqual({ ok: true });
    expect(await leaderRow('ZQA')).toMatchObject({ person_id: pid, can_login: false, retired_at: null });
  });

  it('AddInitials_Refuses_ACodeHeldByAnotherActiveLeader_IgnoringCase', async () => {
    await addInitials(await person('Ada'), 'ZQA');
    const res = await addInitials(await person('Bea'), 'zqa');
    expect(res.error).toBe(`ZQA already belongs to Ada ${LAST}.`);
  });

  it('AddInitials_Refuses_ANonPersonSourceCode', async () => {
    const res = await addInitials(await person('Ada'), 'Camp');
    expect(res.error).toBe('Camp is the code for Summer Camp, not a person.');
  });

  it('AddInitials_Refuses_ABadlyShapedCode_BeforeAnythingIsWritten', async () => {
    const pid = await person('Ada');
    expect((await addInitials(pid, 'Z1')).error).toMatch(/2–5 letters/);
    expect((await admin.from('leaders').select('code').eq('person_id', pid)).data).toEqual([]);
  });

  it('AddInitials_Refuses_ASecondCodeForThePerson', async () => {
    const pid = await person('Ada');
    await addInitials(pid, 'ZQA');
    expect((await addInitials(pid, 'ZQB')).error).toBe(`Ada ${LAST} already has initials ZQA.`);
  });

  it('AddInitials_Refuses_ARetiredCodeUsedWithinFiveYears_AndSaysWhen', async () => {
    const old = await person('Ada');
    await addInitials(old, 'ZQA');
    await scoutWithEntries(['2026-10-18'], 'ZQA');
    await setInitialsRetired(old, true);
    const res = await addInitials(await person('Bea'), 'ZQA');
    expect(res.error).toBe('ZQA signed an entry on Oct 18, 2026; it can be reused from Oct 18, 2031.');
  });

  it('AddInitials_ReusesARetiredCode_UnusedForFiveYears', async () => {
    const old = await person('Ada');
    await addInitials(old, 'ZQA');
    expect((await admin.from('library_superusers').insert({ leader_code: 'ZQA' })).error).toBeNull();
    await scoutWithEntries(['2019-06-01'], 'ZQA');
    await setInitialsRetired(old, true);
    const year = new Date().getFullYear();
    const fresh = await person('Bea');
    expect(await addInitials(fresh, 'ZQA')).toEqual({ ok: true });
    expect({
      fresh: await leaderRow('ZQA'),
      archived: (
        await admin.from('leaders').select('person_id, archived_person_id, is_person, can_login').eq('code', `ZQA~${year}`).single()
      ).data,
      // The old holder's links follow the archived row; the new holder starts with none.
      superuser: (await admin.from('library_superusers').select('leader_code').like('leader_code', 'ZQ%')).data,
      ledger: (await byOf()).map((r) => r.by)
    }).toMatchObject({
      fresh: { person_id: fresh, retired_at: null },
      // No longer the old person's row: off every person lookup and the adult and login pools.
      archived: { person_id: null, archived_person_id: old, is_person: false, can_login: false },
      superuser: [{ leader_code: `ZQA~${year}` }],
      ledger: ['ZQA']
    });
  });
});

describe('Sign-off initials — after reuse', () => {
  it('OldHolder_CanBeGivenNewInitials_AfterTheirsWereReused', async () => {
    const old = await person('Ada');
    await addInitials(old, 'ZQA');
    await setInitialsRetired(old, true);
    await addInitials(await person('Bea'), 'ZQA');
    expect(await addInitials(old, 'ZQAD')).toEqual({ ok: true });
  });
});

describe('Sign-off initials — rename', () => {
  it('RenameInitials_RewritesEveryLedgerEntry_AndEveryLink_InOneTransaction', async () => {
    const pid = await person('Ada');
    await addInitials(pid, 'ZQA');
    expect((await admin.from('library_superusers').insert({ leader_code: 'ZQA' })).error).toBeNull();
    await scoutWithEntries(['2026-01-01', '2026-02-01'], 'ZQA');
    expect(await renameInitials(pid, 'ZQAB')).toEqual({ ok: true });
    const superuser = (await admin.from('library_superusers').select('leader_code').eq('leader_code', 'ZQAB')).data;
    expect({ ledger: (await byOf()).map((r) => r.by), superuser, old: await leaderRow('ZQA') }).toEqual({
      ledger: ['ZQAB', 'ZQAB'],
      superuser: [{ leader_code: 'ZQAB' }],
      old: null
    });
  });

  it('RenameInitials_LeavesTheScoutsRankAlone', async () => {
    const pid = await person('Ada');
    await addInitials(pid, 'ZQA');
    await scoutWithEntries([], 'ZQA');
    await admin.from('ledger_entries').insert({
      scout_id: SCOUT, date: '2026-01-05', kind: 'rank_award', code: 'scout', label: 'ZZ', by: 'ZQA', entered_by: 'ZZ'
    });
    const rank = async () => (await admin.from('scouts').select('current_rank').eq('id', SCOUT).single()).data?.current_rank;
    const before = await rank();
    await renameInitials(pid, 'ZQAB');
    expect({ before, after: await rank() }).toEqual({ before: 'scout', after: 'scout' });
  });

  it('RenameInitials_LeavesOtherLeadersEntriesUntouched', async () => {
    const pid = await person('Ada');
    await addInitials(pid, 'ZQA');
    await scoutWithEntries(['2026-01-01'], 'ZQA');
    await admin.from('ledger_entries').insert({
      scout_id: SCOUT, date: '2026-01-02', kind: 'rank_requirement', code: 'tenderfoot-1b', label: 'ZZ', by: 'PB', entered_by: 'ZZ'
    });
    await renameInitials(pid, 'ZQAB');
    expect((await byOf()).map((r) => r.by)).toEqual(['ZQAB', 'PB']);
  });

  it('RenameInitials_ChangingOnlyTheCase_IsAllowed', async () => {
    const pid = await person('Ada');
    await addInitials(pid, 'ZQA');
    expect(await renameInitials(pid, 'ZQa')).toEqual({ ok: true });
  });

  it('RenameInitials_WritesTheChangeToThePersonsHistory', async () => {
    const pid = await person('Ada');
    await addInitials(pid, 'ZQA');
    await renameInitials(pid, 'ZQAB');
    const { data } = await admin.from('audit_log').select('details').eq('entity_type', 'person').eq('entity_id', String(pid)).order('id');
    expect((data ?? []).map((r) => r.details)).toEqual([
      [{ field: 'Sign-off initials', from: '—', to: 'ZQA' }],
      [{ field: 'Sign-off initials', from: 'ZQA', to: 'ZQAB' }]
    ]);
  });
});

describe('Sign-off initials — retire and restore', () => {
  it('RetireInitials_KeepsTheRow_WithRetiredAtSet', async () => {
    const pid = await person('Ada');
    await addInitials(pid, 'ZQA');
    await setInitialsRetired(pid, true);
    expect((await leaderRow('ZQA'))?.retired_at).not.toBeNull();
  });

  it('RetireInitials_LeavesLedgerEntriesIntact', async () => {
    const pid = await person('Ada');
    await addInitials(pid, 'ZQA');
    await scoutWithEntries(['2026-01-01', '2026-02-01'], 'ZQA');
    const before = await byOf();
    await setInitialsRetired(pid, true);
    expect(await byOf()).toEqual(before);
  });

  it('RestoreInitials_PutsTheCodeBack', async () => {
    const pid = await person('Ada');
    await addInitials(pid, 'ZQA');
    await setInitialsRetired(pid, true);
    expect(await setInitialsRetired(pid, false)).toEqual({ ok: true });
    expect((await leaderRow('ZQA'))?.retired_at).toBeNull();
  });

  it('AddInitials_ForSomeoneWithRetiredInitials_SaysRestore', async () => {
    const pid = await person('Ada');
    await addInitials(pid, 'ZQA');
    await setInitialsRetired(pid, true);
    expect((await addInitials(pid, 'ZQB')).error).toBe(`Ada ${LAST} has retired initials ZQA. Restore them instead.`);
  });
});

describe('Sign-off initials — the Signed Off By pickers', () => {
  it('RetireInitials_HidesTheCodeFromSignOffPickers_RestorePutsItBack', async () => {
    const pid = await person('Ada');
    await addInitials(pid, 'ZQA');
    const listed = async () => (await loadSignOffChoices(admin)).some((l) => l.code === 'ZQA');
    const active = await listed();
    await setInitialsRetired(pid, true);
    const retired = await listed();
    await setInitialsRetired(pid, false);
    expect({ active, retired, restored: await listed() }).toEqual({ active: true, retired: false, restored: true });
  });
});

describe('Sign-off initials — Promote to adult', () => {
  const PROMO = 'ZZINI2';
  afterEach(async () => {
    await admin.from('audit_log').delete().eq('entity_type', 'scout').eq('entity_id', PROMO);
    await admin.from('scouts').delete().eq('id', PROMO);
  });
  async function promotable(): Promise<number> {
    const { data } = await admin
      .from('people')
      .insert({ first_name: 'Zed', last_name: 'Qzinitials', display_name: 'Zed Qzinitials' })
      .select('id')
      .single();
    const pid = (data as { id: number }).id;
    people.push(pid);
    await admin.from('scouts').insert({ id: PROMO, first_name: 'Zed', last_name: 'Qzinitials', display_name: 'Zed Qzinitials', active: true, person_id: pid });
    return pid;
  }
  const promote = () => {
    const fd = new FormData();
    fd.set('scout_id', PROMO);
    return promoteScoutToAdult(fd);
  };

  it('Promote_GivesNewInitials_WithAdminLoginAsBefore', async () => {
    const pid = await promotable();
    await promote();
    const { data } = await admin.from('leaders').select('code, can_login').eq('person_id', pid).single();
    expect(data).toEqual({ code: 'ZQ', can_login: true });
  });

  it('Promote_RestoresRetiredInitials_InsteadOfMakingNew', async () => {
    const pid = await promotable();
    await addInitials(pid, 'ZQZ');
    await setInitialsRetired(pid, true);
    await promote();
    expect((await admin.from('leaders').select('code, retired_at').eq('person_id', pid)).data).toEqual([
      { code: 'ZQZ', retired_at: null }
    ]);
  });
});

describe('Sign-off initials — need roster.manage', () => {
  it('NonManager_CannotChangeInitials', async () => {
    const pid = await person('Ada');
    const cap = await import('@/lib/require-capability');
    vi.spyOn(cap, 'requireCapability').mockRejectedValueOnce(new Error('forbidden'));
    expect(await addInitials(pid, 'ZQA')).toEqual({ ok: false, error: 'Not authenticated' });
  });
});
