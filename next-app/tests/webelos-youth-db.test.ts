import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * A Webelos is YOUTH (Plans/Webelos-On-The-Roster.md, 2026-11-12). Their scouts row is is_webelos = true AND
 * active = false, so every "adult = no ACTIVE scouts row" or "tab !== 'active_scout'" test used to call them an
 * adult. These hold the line: never in an adult pool, never a teacher, never signs in with their own address
 * (a parent signs in for them), and a proxy viewer can still pick their family. Test-owned rows only (ZZYTH*).
 */
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});

const { youthPersonIds, loadScoutSwitchOptions } = await import('../src/lib/youth');
const { loadAdultLeaders } = await import('../src/lib/authorized-adults');
const { loadAccessScreen } = await import('../src/lib/capabilities-admin');
const { searchSignInCandidates } = await import('../src/lib/signin-roster');
const { targetForPerson, identityForPerson, requestChallenge } = await import('../src/lib/identity-challenge');
const { loadTeachingKind, loadTeachingProfile } = await import('../src/lib/teaching-skills');
const { loadNewTalent } = await import('../src/lib/teaching-interests');
const { adultRecipients } = await import('../src/lib/meeting-invites-db');
const { loadActiveScoutOptions } = await import('../src/lib/member-viewer');
const { listMenuOwnerCandidatesWith } = await import('../src/lib/menu-monster/menus-store');

const admin = adminClient();
const LAST = 'Zzyouthtest';
const WEB = 'ZZYTH1';
const SIB = 'ZZYTH2';
const CODE = 'ZZYTH';
const stamp = `${Date.now()}-${process.pid}`;
const webEmail = `zzyth-web-${stamp}@example.com`;
const parentEmail = `zzyth-parent-${stamp}@example.com`;
let household = 0;
let webPerson = 0;
let sibPerson = 0;
let parentPerson = 0;

async function person(first: string, email: string | null): Promise<number> {
  const { data, error } = await admin
    .from('people')
    .insert({ first_name: first, last_name: LAST, display_name: `${first} ${LAST}`, primary_email: email, active: true })
    .select('id')
    .single();
  if (error || !data) throw new Error(`fixture: person: ${error?.message}`);
  const id = (data as { id: number }).id;
  const { error: me } = await admin.from('household_members').insert({ household_id: household, person_id: id });
  if (me) throw new Error(`fixture: member: ${me.message}`);
  return id;
}

async function scoutRow(id: string, personId: number, first: string, webelos: boolean) {
  const { error } = await admin.from('scouts').insert({
    id,
    first_name: first,
    last_name: LAST,
    display_name: `${first} ${LAST}`,
    active: !webelos,
    is_webelos: webelos,
    person_id: personId
  });
  if (error) throw new Error(`fixture: scout: ${error.message}`);
}

beforeAll(async () => {
  const { data: h, error } = await admin.from('households').insert({ label: `[TEST] ${LAST}` }).select('id').single();
  if (error || !h) throw new Error(`fixture: household: ${error?.message}`);
  household = (h as { id: number }).id;
  parentPerson = await person('Pam', parentEmail);
  webPerson = await person('Wally', webEmail);
  sibPerson = await person('Sid', null);
  await scoutRow(WEB, webPerson, 'Wally', true);
  await scoutRow(SIB, sibPerson, 'Sid', false);
  const { data: reqs } = await admin.from('rank_requirements').select('rank_id, code').eq('rank_id', 'tenderfoot').is('parent_id', null).limit(1);
  const r = ((reqs ?? []) as { rank_id: string; code: string }[])[0];
  if (r) {
    const { error: ie } = await admin.from('teaching_interests').insert({ person_id: webPerson, topic_key: `${r.rank_id}-${r.code}`, source: 'member' });
    if (ie) throw new Error(`fixture: interest: ${ie.message}`);
  }
}, 60_000);

afterAll(async () => {
  const ids = [webPerson, sibPerson, parentPerson].filter(Boolean);
  await admin.from('teaching_interests').delete().in('person_id', ids);
  await admin.from('login_tokens').delete().in('person_id', ids);
  await admin.from('leaders').delete().eq('code', CODE);
  await admin.from('scouts').delete().in('id', [WEB, SIB]);
  await admin.from('household_members').delete().eq('household_id', household);
  await admin.from('person_emails').delete().in('person_id', ids);
  await admin.from('people').delete().eq('last_name', LAST);
  await admin.from('households').delete().eq('id', household);
});

describe('a Webelos is youth', () => {
  it('YouthPersonIds_IncludesAWebelos', async () => {
    expect((await youthPersonIds(admin, [webPerson, parentPerson])).has(webPerson)).toBe(true);
  });

  it('YouthPersonIds_LeavesOutTheParent', async () => {
    expect((await youthPersonIds(admin, [webPerson, parentPerson])).has(parentPerson)).toBe(false);
  });

  describe('with leader initials pointing at the Webelos', () => {
    beforeAll(async () => {
      const { error } = await admin.from('leaders').insert({ code: CODE, name: `Wally ${LAST}`, role: 'Test', is_person: true, person_id: webPerson });
      if (error) throw new Error(`fixture: leader: ${error.message}`);
    });
    afterAll(async () => {
      await admin.from('leaders').delete().eq('code', CODE);
    });

    it('AuthorizedAdults_LeavesOutAWebelos', async () => {
      const pool = await loadAdultLeaders(admin);
      expect(pool.some((a) => a.code === CODE)).toBe(false);
    });

    it('AccessScreen_DoesNotListAWebelosAsAnEligibleAdult', async () => {
      const { rows } = await loadAccessScreen(admin);
      expect(rows.some((r) => r.personId === webPerson)).toBe(false);
    });

    it('MenuOwnerCandidates_NeverCallsAWebelosALeader', async () => {
      const all = await listMenuOwnerCandidatesWith(admin);
      expect(all.some((c) => c.personId === webPerson)).toBe(false);
    }, 60_000);
  });

  it('AccessScreen_TagsAWebelosAsYouth_InTheAddPicker', async () => {
    const { addable } = await loadAccessScreen(admin);
    expect(addable.find((p) => p.personId === webPerson)?.isActiveScout).toBe(true);
  });

  it('TeachingKind_IsNone_ForAWebelos', async () => {
    expect(await loadTeachingKind(admin, webPerson, '2026-11-15')).toBe('none');
  });

  it('TeachingProfile_IsNone_ForAWebelos', async () => {
    expect((await loadTeachingProfile(admin, webPerson, '2026-11-15')).kind).toBe('none');
  });

  it('NewTalent_LeavesOutAWebelos', async () => {
    const groups = await loadNewTalent(admin, { canEdit: true, canEmail: true });
    expect(groups.some((g) => g.personId === webPerson)).toBe(false);
  });

  it('AdultRecipients_NeverMailsAWebelosAsAnAdult', async () => {
    const { to } = await adultRecipients(admin, [webPerson]);
    expect(to.has(webPerson)).toBe(false);
  });

  it('MenuOwnerCandidates_NeverCallsAWebelosAParent', async () => {
    const all = await listMenuOwnerCandidatesWith(admin);
    expect(all.some((c) => c.personId === webPerson)).toBe(false);
  }, 60_000);
});

describe('a Webelos signs in through a parent', () => {
  it('NamePicker_OffersNoOwnAddress_ForAWebelos', async () => {
    const { candidates } = await searchSignInCandidates(`Wally ${LAST}`);
    expect(candidates.find((c) => c.personId === webPerson)?.maskedEmail).toBeNull();
  });

  it('NamePicker_OffersTheParents_ForAWebelos', async () => {
    const { candidates } = await searchSignInCandidates(`Wally ${LAST}`);
    expect(candidates.find((c) => c.personId === webPerson)?.parents.map((p) => p.personId)).toEqual([parentPerson]);
  });

  it('NamePicker_TagsAWebelosAsYouth', async () => {
    const { candidates } = await searchSignInCandidates(`Wally ${LAST}`);
    expect(candidates.find((c) => c.personId === webPerson)?.isScout).toBe(true);
  });

  it('TargetForPerson_RefusesAWebelos', async () => {
    expect(await targetForPerson(admin, webPerson)).toBeNull();
  });

  it('IdentityForPerson_RefusesAWebelos', async () => {
    expect(await identityForPerson(admin, webPerson, null)).toBeNull();
  });

  it('EmailChallenge_IsNotMintedForAWebelosAddress', async () => {
    await requestChallenge(admin, webEmail);
    const { data } = await admin.from('login_tokens').select('id').eq('person_id', webPerson);
    expect(data ?? []).toEqual([]);
  });

  it('TargetForPerson_StillAcceptsTheParent', async () => {
    expect((await targetForPerson(admin, parentPerson))?.subjectKind).toBe('adult');
  });
});

describe('a proxy viewer can pick a Webelos family', () => {
  it('MemberProxyOptions_IncludeAWebelos_Labelled', async () => {
    const opts = await loadActiveScoutOptions(admin);
    expect(opts.find((o) => o.personId === webPerson)?.name).toBe(`Wally ${LAST} (Webelos)`);
  });

  it('FinanceProxyOptions_IncludeAWebelos_Labelled', async () => {
    const opts = await loadScoutSwitchOptions(admin);
    expect(opts.find((o) => o.personId === webPerson)?.name).toBe(`Wally ${LAST} (Webelos)`);
  });
});
