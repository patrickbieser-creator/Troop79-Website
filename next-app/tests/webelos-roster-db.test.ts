import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * Webelos on the roster (Plans/Webelos-On-The-Roster.md, 2026-11-12). A
 * Webelos is a scouts row with is_webelos = true and active = false: its
 * advancement is tracked (ledger_active) but never reported
 * (reportable_ledger), the Scout rank is held back until crossover, and
 * cross_over_webelos / undo_cross_over flip it atomically with an audit row.
 * Test-owned rows only (ids ZZWEB*).
 */
const admin = adminClient();
const WEB = 'ZZWEB1';
const WEB2 = 'ZZWEB2';
const LAST = 'ZZWebelosTest';
let webPerson = 0;
let web2Person = 0;
let scoutReqCodes: string[] = [];

async function newWebelos(id: string, first: string): Promise<number> {
  const { data: p, error: pe } = await admin
    .from('people')
    .insert({ first_name: first, last_name: LAST, display_name: `${first} ${LAST}`, active: true })
    .select('id')
    .single();
  if (pe || !p) throw new Error(pe?.message);
  const personId = (p as { id: number }).id;
  const { error } = await admin.from('scouts').insert({
    id,
    first_name: first,
    last_name: LAST,
    display_name: `${first} ${LAST}`,
    active: false,
    is_webelos: true,
    person_id: personId
  });
  if (error) throw new Error(error.message);
  return personId;
}

async function recordAllScoutRequirements(scoutId: string) {
  const rows = scoutReqCodes.map((c) => ({
    scout_id: scoutId,
    date: '2026-11-15',
    kind: 'rank_requirement',
    code: `scout-${c}`,
    label: `ZZ ${c}`,
    by: 'ZZ Vitest',
    entered_by: 'ZZ Vitest'
  }));
  const { error } = await admin.from('ledger_entries').insert(rows);
  if (error) throw new Error(error.message);
}

beforeAll(async () => {
  const { data } = await admin.from('rank_requirements').select('code').eq('rank_id', 'scout');
  scoutReqCodes = ((data ?? []) as { code: string }[]).map((r) => r.code);
  webPerson = await newWebelos(WEB, 'Logan');
  web2Person = await newWebelos(WEB2, 'Hank');
});

afterAll(async () => {
  await admin.from('audit_log').delete().in('entity_id', [WEB, WEB2]);
  await admin.from('ledger_entries').delete().in('scout_id', [WEB, WEB2]);
  await admin.from('scouts').delete().in('id', [WEB, WEB2]);
  await admin.from('people').delete().eq('last_name', LAST);
});

describe('a Webelos on the roster', () => {
  it('Webelos_IsOnTheWebelosTab_NotTheInactiveScoutsTab', async () => {
    const { data } = await admin.from('person_directory').select('tab, in_picker').eq('person_id', webPerson).single();
    expect(data).toEqual({ tab: 'webelos', in_picker: false });
  });

  it('Webelos_CannotAlsoBeActive', async () => {
    const { error } = await admin.from('scouts').update({ active: true }).eq('id', WEB);
    expect(error).not.toBeNull();
  });

  it('LeftScout_StillNeedsAReasonToBeInactive', async () => {
    const { error } = await admin
      .from('scouts')
      .insert({ id: 'ZZWEB9', first_name: 'X', last_name: LAST, display_name: 'X', active: false });
    expect(error).not.toBeNull();
  });

  it('WebelosAdvancement_IsTracked_ButNotReportable', async () => {
    await admin.from('ledger_entries').insert({
      scout_id: WEB2,
      date: '2026-11-15',
      kind: 'merit_badge_requirement',
      code: 'climbing-1',
      label: 'ZZ climbing 1',
      by: 'ZZ Vitest',
      entered_by: 'ZZ Vitest'
    });
    const tracked = await admin.from('ledger_active').select('id').eq('scout_id', WEB2);
    const reportable = await admin.from('reportable_ledger').select('id').eq('scout_id', WEB2);
    expect([tracked.data?.length, reportable.data?.length]).toEqual([1, 0]);
  });

  it('WebelosSignup_DefaultsToClassWebelos', async () => {
    const { data } = await admin.rpc('default_participant_class', { p_person_id: webPerson, p_event_signup_id: 0 });
    expect(data).toBe('webelos');
  });

  it('ScoutRankDoneAsAWebelos_IsNotAutoAwarded', async () => {
    await recordAllScoutRequirements(WEB);
    const { data } = await admin
      .from('ledger_entries')
      .select('id')
      .eq('scout_id', WEB)
      .eq('kind', 'rank_award')
      .is('deleted_at', null);
    expect(data).toEqual([]);
  });
});

describe('crossing over', () => {
  it('CrossOver_OfAScout_IsRefused', async () => {
    const { error } = await admin.rpc('cross_over_webelos', {
      p_scout_id: 'ZZWEB-none',
      p_on: '2027-02-28',
      p_bsa_member_id: null,
      p_actor_person_id: null,
      p_actor_label: 'ZZ Vitest'
    });
    expect(error?.message).toMatch(/SCOUT_NOT_FOUND/);
  });

  it('CrossOver_MakesAnActiveScout_StampsTheDay_SavesTheBsaId_AndAwardsTheHeldScoutRank', async () => {
    const { error } = await admin.rpc('cross_over_webelos', {
      p_scout_id: WEB,
      p_on: '2027-02-28',
      p_bsa_member_id: ' 139000111 ',
      p_actor_person_id: null,
      p_actor_label: 'ZZ Vitest'
    });
    expect(error).toBeNull();
    const { data: s } = await admin.from('scouts').select('active, is_webelos, crossed_over_on').eq('id', WEB).single();
    const { data: p } = await admin.from('people').select('bsa_member_id').eq('id', webPerson).single();
    const { data: award } = await admin
      .from('ledger_entries')
      .select('date')
      .eq('scout_id', WEB)
      .eq('kind', 'rank_award')
      .eq('code', 'scout')
      .is('deleted_at', null);
    const { data: audit } = await admin.from('audit_log').select('action').eq('entity_id', WEB);
    expect({ s, bsa: p?.bsa_member_id, award, audit }).toEqual({
      s: { active: true, is_webelos: false, crossed_over_on: '2027-02-28' },
      bsa: '139000111',
      award: [{ date: '2027-02-28' }],
      audit: [{ action: 'cross_over' }]
    });
  });

  it('CrossedOverScout_TenureStartsOnCrossoverDay', async () => {
    const { data } = await admin.from('scout_tenure').select('first_activity_date').eq('scout_id', WEB).single();
    expect(data?.first_activity_date).toBe('2027-02-28');
  });

  it('CrossOver_Twice_IsRefused', async () => {
    const { error } = await admin.rpc('cross_over_webelos', {
      p_scout_id: WEB,
      p_on: '2027-03-01',
      p_bsa_member_id: null,
      p_actor_person_id: null,
      p_actor_label: 'ZZ Vitest'
    });
    expect(error?.message).toMatch(/NOT_A_WEBELOS/);
  });

  it('UndoCrossOver_MakesThemAWebelosAgain_AndRemovesTheCrossoverAward', async () => {
    const { error } = await admin.rpc('undo_cross_over', { p_scout_id: WEB, p_actor_person_id: null, p_actor_label: 'ZZ Vitest' });
    expect(error).toBeNull();
    const { data: s } = await admin.from('scouts').select('active, is_webelos, crossed_over_on').eq('id', WEB).single();
    const { data: award } = await admin
      .from('ledger_entries')
      .select('id')
      .eq('scout_id', WEB)
      .eq('kind', 'rank_award')
      .is('deleted_at', null);
    expect({ s, award }).toEqual({ s: { active: false, is_webelos: true, crossed_over_on: null }, award: [] });
  });
});
