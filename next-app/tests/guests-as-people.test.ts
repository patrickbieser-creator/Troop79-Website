import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  createTestEvent,
  deleteTestEvent,
  createTestScout,
  deleteTestScout,
  TEST_PREFIX,
  type TestEvent,
  type TestScout
} from './helpers/signup-fixtures';

/**
 * Guests as people — Phase 0a schema + Phase 0b RPC
 * (Plans/Guests-As-People.md, Patrick 2026-08-22/23).
 *
 * A guest is a `people` row flagged with guest_host_household_id: not a
 * household member, hidden from person_directory, sign-up-able only through
 * the host household's form (submit_household_signup) or a leader. The RPC
 * enforces guest_mode (none / count / named), creates the people row under
 * the per-household cap, and reconciles dropped guests.
 */

type Admin = ReturnType<typeof adminClient>;

async function makeHousehold(admin: Admin, label: string): Promise<number> {
  const { data, error } = await admin
    .from('households')
    .insert({ label: `${TEST_PREFIX} ${label}` })
    .select('id')
    .single();
  if (error || !data) throw new Error(`fixture: households insert failed: ${error?.message}`);
  return data.id as number;
}

async function joinHousehold(admin: Admin, householdId: number, personId: number) {
  const { error } = await admin.from('household_members').insert({ household_id: householdId, person_id: personId });
  if (error) throw new Error(`fixture: household_members insert failed: ${error.message}`);
}

async function makeGuestPerson(admin: Admin, householdId: number, name: string): Promise<number> {
  const { data, error } = await admin
    .from('people')
    .insert({ display_name: `${TEST_PREFIX} ${name}`, guest_host_household_id: householdId })
    .select('id')
    .single();
  if (error || !data) throw new Error(`fixture: guest people insert failed: ${error?.message}`);
  return data.id as number;
}

/** The household's guest people rows (what the cleanup must remove). */
async function guestIds(admin: Admin, householdId: number): Promise<number[]> {
  const { data } = await admin.from('people').select('id').eq('guest_host_household_id', householdId);
  return ((data ?? []) as { id: number }[]).map((r) => r.id);
}

function memberEntry(key: string, personId: number, kind: 'scout' | 'adult', status: 'yes' | 'no' = 'yes', extra: Record<string, unknown> = {}) {
  return { key, person_id: personId, person_kind: kind, status, participation: 'full', guest_count: 0, ...extra };
}

function guestEntry(key: string, hostKey: string, cls: string, extra: Record<string, unknown> = {}) {
  return { key, guest: true, guest_of_key: hostKey, participant_class: cls, participation: 'full', ...extra };
}

describe('guests as people — schema (db)', () => {
  let admin: Admin;
  let event: TestEvent | null = null;
  let scout: TestScout | null = null;
  let household: number | null = null;
  let extraPeople: number[] = [];

  afterEach(async () => {
    if (event) await deleteTestEvent(admin, event);
    if (extraPeople.length) await admin.from('people').delete().in('id', extraPeople);
    if (household) {
      const gids = await guestIds(admin, household);
      if (gids.length) await admin.from('people').delete().in('id', gids);
      await admin.from('households').delete().eq('id', household);
    }
    if (scout) await deleteTestScout(admin, scout);
    event = null;
    scout = null;
    household = null;
    extraPeople = [];
  });

  it('GuestMode_IsTheOnlySwitch_AndIsCheckConstrained', async () => {
    admin = adminClient();
    event = await createTestEvent(admin, { guestMode: 'count' });
    const { data } = await admin.from('event_signups').select('guest_mode').eq('id', event.eventSignupId).single();
    expect(data).toEqual({ guest_mode: 'count' });
    const bad = await admin.from('event_signups').update({ guest_mode: 'maybe' }).eq('id', event.eventSignupId);
    expect(bad.error).not.toBeNull();
    // Phase 3 (2026-08-23): allow_guests is gone.
    const legacy = await admin.from('event_signups').select('allow_guests').eq('id', event.eventSignupId);
    expect(legacy.error).not.toBeNull();
  });

  it('GuestPerson_CannotAlsoBeAHouseholdMember_EitherWayRound', async () => {
    admin = adminClient();
    household = await makeHousehold(admin, 'GuardHH');
    const guest = await makeGuestPerson(admin, household, 'Guard Guest');

    // A guest cannot be added to a household.
    const join = await admin.from('household_members').insert({ household_id: household, person_id: guest });
    expect(join.error?.message).toContain('GUEST_CANNOT_BE_HOUSEHOLD_MEMBER');

    // A member cannot be flagged as a guest.
    scout = await createTestScout(admin, 'GRDM');
    await joinHousehold(admin, household, scout.personId);
    const flag = await admin.from('people').update({ guest_host_household_id: household }).eq('id', scout.personId);
    expect(flag.error?.message).toContain('GUEST_CANNOT_BE_HOUSEHOLD_MEMBER');
  });

  it('GuestPerson_IsAbsentFromPersonDirectory_ButPresentInPeople', async () => {
    admin = adminClient();
    household = await makeHousehold(admin, 'DirHH');
    const guest = await makeGuestPerson(admin, household, 'Dir Guest');
    const { data: dir } = await admin.from('person_directory').select('person_id').eq('person_id', guest);
    expect(dir).toEqual([]);
    const { data: person } = await admin.from('people').select('id, guest_host_household_id').eq('id', guest).single();
    expect(person?.guest_host_household_id).toBe(household);
  });

  it('SignupEntries_GuestPersonRow_RequiresAGuestClass', async () => {
    admin = adminClient();
    household = await makeHousehold(admin, 'ClassHH');
    event = await createTestEvent(admin, { guestMode: 'named' });
    const guest = await makeGuestPerson(admin, household, 'Class Guest');

    const noClass = await admin.from('signup_entries').insert({
      event_signup_id: event.eventSignupId, person_id: guest, person_kind: 'scout', status: 'yes'
    });
    expect(noClass.error?.message).toContain('GUEST_CLASS_REQUIRED');

    const memberClass = await admin.from('signup_entries').insert({
      event_signup_id: event.eventSignupId, person_id: guest, person_kind: 'scout', participant_class: 'scout', status: 'yes'
    });
    expect(memberClass.error?.message).toContain('GUEST_CLASS_INVALID');

    const ok = await admin.from('signup_entries').insert({
      event_signup_id: event.eventSignupId, person_id: guest, person_kind: 'scout', participant_class: 'webelos', status: 'yes'
    });
    expect(ok.error).toBeNull();
  });

  it('Merge_ClearsGuestHostHousehold_OnPromotion_AndMovesTheHistory', async () => {
    admin = adminClient();
    household = await makeHousehold(admin, 'PromoHH');
    event = await createTestEvent(admin, { guestMode: 'named' });
    const guest = await makeGuestPerson(admin, household, 'Webelos Who Crossed Over');
    const { error: entryErr } = await admin.from('signup_entries').insert({
      event_signup_id: event.eventSignupId, person_id: guest, person_kind: 'scout', participant_class: 'webelos', status: 'yes'
    });
    expect(entryErr).toBeNull();

    // The new scout record (a member of the household) survives the merge.
    scout = await createTestScout(admin, 'PRMO');
    await joinHousehold(admin, household, scout.personId);

    const { error: mergeErr } = await admin.rpc('merge_people', {
      p_survivor: scout.personId, p_loser: guest, p_decided_by: 'test:promotion'
    });
    expect(mergeErr).toBeNull();

    const { data: people } = await admin
      .from('people').select('id, guest_host_household_id, merged_into_person_id').in('id', [scout.personId, guest]);
    const byId = new Map((people ?? []).map((p) => [p.id, p]));
    expect(byId.get(scout.personId)?.guest_host_household_id).toBeNull();
    expect(byId.get(guest)?.guest_host_household_id).toBeNull();
    expect(byId.get(guest)?.merged_into_person_id).toBe(scout.personId);

    const { data: entry } = await admin.from('signup_entries').select('person_id, participant_class').eq('event_signup_id', event.eventSignupId).single();
    expect(entry?.person_id).toBe(scout.personId);
    expect(entry?.participant_class).toBe('webelos'); // per-event history carries as-is

    // The other direction: a guest SURVIVOR absorbing a member loser becomes a member too.
    const guest2 = await makeGuestPerson(admin, household, 'Guest Survivor');
    const { data: loserRow } = await admin.from('people').insert({ display_name: `${TEST_PREFIX} Member Loser` }).select('id').single();
    extraPeople.push(loserRow!.id);
    await joinHousehold(admin, household, loserRow!.id);
    const { error: merge2 } = await admin.rpc('merge_people', { p_survivor: guest2, p_loser: loserRow!.id, p_decided_by: 'test' });
    expect(merge2).toBeNull();
    const { data: g2 } = await admin.from('people').select('guest_host_household_id').eq('id', guest2).single();
    expect(g2?.guest_host_household_id).toBeNull();
    const { data: hm } = await admin.from('household_members').select('person_id').eq('household_id', household).eq('person_id', guest2);
    expect(hm?.length).toBe(1);
    extraPeople.push(guest2); // no longer a guest — the household cleanup will not find it
  });
});

describe('guests as people — submit_household_signup (db)', () => {
  let admin: Admin;
  let event: TestEvent | null = null;
  let scout: TestScout | null = null;
  let household: number | null = null;
  let otherHousehold: number | null = null;

  afterEach(async () => {
    if (event) await deleteTestEvent(admin, event);
    for (const hh of [household, otherHousehold]) {
      if (!hh) continue;
      const gids = await guestIds(admin, hh);
      if (gids.length) await admin.from('people').delete().in('id', gids);
      await admin.from('households').delete().eq('id', hh);
    }
    if (scout) await deleteTestScout(admin, scout);
    event = null;
    scout = null;
    household = null;
    otherHousehold = null;
  });

  async function setup(opts: { guestMode: 'none' | 'count' | 'named'; capacity?: number | null; waitlistEnabled?: boolean }, label: string) {
    admin = adminClient();
    household = await makeHousehold(admin, `RPC ${label}`);
    scout = await createTestScout(admin, label);
    await joinHousehold(admin, household, scout.personId);
    event = await createTestEvent(admin, opts);
  }

  function submit(entries: unknown[], opts: { householdId?: number | null; allowed?: number[] | null } = {}) {
    return admin.rpc('submit_household_signup', {
      p_event_signup_id: event!.eventSignupId,
      p_entries: entries,
      p_actor: 'test:guests',
      p_household_id: opts.householdId === undefined ? household : opts.householdId,
      p_allowed_person_ids: opts.allowed === undefined ? [scout!.personId] : opts.allowed
    });
  }

  async function rows() {
    const { data } = await admin
      .from('signup_entries')
      .select('id, person_id, participant_class, person_kind, status, host_entry_id, guest_count')
      .eq('event_signup_id', event!.eventSignupId)
      .order('id');
    return (data ?? []) as { id: number; person_id: number; participant_class: string; person_kind: string; status: string; host_entry_id: number | null; guest_count: number }[];
  }

  it('Rpc_RejectsGuestCount_UnlessCountMode', async () => {
    await setup({ guestMode: 'named' }, 'GCNT');
    const { error } = await submit([memberEntry('s', scout!.personId, 'scout', 'yes', { guest_count: 2 })]);
    expect(error?.message).toContain('GUESTS_NOT_ALLOWED');
  });

  it('Headcount_CountMode_Is1PlusN', async () => {
    await setup({ guestMode: 'count' }, 'GHC');
    const { error } = await submit([memberEntry('s', scout!.personId, 'scout', 'yes', { guest_count: 3, guest_note: 'grandparents' })]);
    expect(error).toBeNull();
    const { data: head } = await admin.rpc('event_signup_headcount', { p_event_signup_id: event!.eventSignupId });
    expect(head).toBe(4);
  });

  it('Rpc_RejectsNamedGuestRows_UnlessNamedMode', async () => {
    await setup({ guestMode: 'count' }, 'GNMD');
    const { error } = await submit([
      memberEntry('s', scout!.personId, 'scout'),
      guestEntry('g1', 's', 'youth_guest', { guest_name: 'Sam Lee' })
    ]);
    expect(error?.message).toContain('GUESTS_NOT_ALLOWED');
  });

  it('Rpc_NamedGuest_CreatesAPeopleRow_FlaggedGuestOfHostHousehold_WithAHostedEntry', async () => {
    await setup({ guestMode: 'named' }, 'GNEW');
    const { data, error } = await submit([
      memberEntry('s', scout!.personId, 'scout'),
      guestEntry('g1', 's', 'adult_guest', { guest_name: '  Grandma Pat ', guest_phone: '414-555-0100' }),
      guestEntry('g2', 's', 'webelos', { guest_name: 'Webelos Wes', guest_phone: '414-555-0199' })
    ]);
    expect(error).toBeNull();
    const result = data as { key: string; entry_id: number; status: string }[];
    expect(result.map((r) => r.key).sort()).toEqual(['g1', 'g2', 's']);

    const all = await rows();
    const host = all.find((r) => r.person_id === scout!.personId)!;
    const guests = all.filter((r) => r.host_entry_id === host.id);
    expect(guests.length).toBe(2);
    expect(guests.map((g) => g.participant_class).sort()).toEqual(['adult_guest', 'webelos']);
    expect(guests.find((g) => g.participant_class === 'adult_guest')?.person_kind).toBe('adult');
    expect(guests.find((g) => g.participant_class === 'webelos')?.person_kind).toBe('scout');
    expect(guests.every((g) => g.status === 'yes')).toBe(true);

    const { data: people } = await admin
      .from('people')
      .select('display_name, guest_host_household_id, primary_phone')
      .in('id', guests.map((g) => g.person_id))
      .order('display_name');
    expect(people).toEqual([
      { display_name: 'Grandma Pat', guest_host_household_id: household, primary_phone: '414-555-0100' },
      // A youth guest never carries contact info — the phone is dropped.
      { display_name: 'Webelos Wes', guest_host_household_id: household, primary_phone: null }
    ]);

    // Named guests count themselves; the host's guest_count stays 0.
    expect(host.guest_count).toBe(0);
    const { data: head } = await admin.rpc('event_signup_headcount', { p_event_signup_id: event!.eventSignupId });
    expect(head).toBe(3);

    // And they are NOT in the directory or the household.
    const { data: dir } = await admin.from('person_directory').select('person_id').in('person_id', guests.map((g) => g.person_id));
    expect(dir).toEqual([]);
  });

  it('Rpc_NamedGuest_RepickByPersonId_ReusesThePerson_AndADroppedGuestBecomesNo', async () => {
    await setup({ guestMode: 'named' }, 'GPCK');
    const grandma = await makeGuestPerson(admin, household!, 'Grandma Again');

    const first = await submit([
      memberEntry('s', scout!.personId, 'scout'),
      guestEntry('g1', 's', 'adult_guest', { person_id: grandma }),
      guestEntry('g2', 's', 'cub_scout', { guest_name: 'Cub Cal' })
    ]);
    expect(first.error).toBeNull();
    let all = await rows();
    expect(all.filter((r) => r.host_entry_id != null).length).toBe(2);
    const grandmaRow = all.find((r) => r.person_id === grandma)!;
    expect(grandmaRow.status).toBe('yes');
    const calRow = all.find((r) => r.participant_class === 'cub_scout')!;

    // Second submit: Grandma stays (re-picked), Cal dropped → his row becomes 'no', no twin.
    const second = await submit([
      memberEntry('s', scout!.personId, 'scout'),
      guestEntry('g1', 's', 'adult_guest', { person_id: grandma })
    ]);
    expect(second.error).toBeNull();
    all = await rows();
    expect(all.filter((r) => r.person_id === grandma).length).toBe(1);
    expect(all.find((r) => r.id === calRow.id)?.status).toBe('no');
    // Only one people row per guest — no twin created on the re-pick.
    const gids = await guestIds(admin, household!);
    expect(gids.length).toBe(2);

    // Third submit: Cal re-added by person_id revives his row (status yes again).
    const third = await submit([
      memberEntry('s', scout!.personId, 'scout'),
      guestEntry('g1', 's', 'adult_guest', { person_id: grandma }),
      guestEntry('g2', 's', 'cub_scout', { person_id: calRow.person_id })
    ]);
    expect(third.error).toBeNull();
    all = await rows();
    expect(all.find((r) => r.id === calRow.id)?.status).toBe('yes');
    expect(all.filter((r) => r.person_id === calRow.person_id).length).toBe(1);
  });

  it('Rpc_RejectsARepick_OfAnotherHouseholdsGuest_AndOfAMember', async () => {
    await setup({ guestMode: 'named' }, 'GOTH');
    otherHousehold = await makeHousehold(admin, 'Other HH');
    const theirs = await makeGuestPerson(admin, otherHousehold, 'Their Guest');

    const stolen = await submit([
      memberEntry('s', scout!.personId, 'scout'),
      guestEntry('g1', 's', 'youth_guest', { person_id: theirs })
    ]);
    expect(stolen.error?.message).toContain('PERSON_NOT_IN_PARTY');

    // A member's person_id is not a guest either.
    const member = await submit([
      memberEntry('s', scout!.personId, 'scout'),
      guestEntry('g1', 's', 'youth_guest', { person_id: scout!.personId })
    ]);
    expect(member.error?.message).toContain('PERSON_NOT_IN_PARTY');
  });

  it('Rpc_RejectsAGuest_WhoseHostIsNotInThePayload_OrHasNoHousehold', async () => {
    await setup({ guestMode: 'named' }, 'GHST');
    const orphan = await submit([
      memberEntry('s', scout!.personId, 'scout'),
      guestEntry('g1', 'nobody', 'youth_guest', { guest_name: 'Orphan Olly' })
    ]);
    expect(orphan.error?.message).toContain('GUEST_NEEDS_HOST');

    const noHousehold = await submit(
      [memberEntry('s', scout!.personId, 'scout'), guestEntry('g1', 's', 'youth_guest', { guest_name: 'No Home' })],
      { householdId: null }
    );
    expect(noHousehold.error?.message).toContain('GUEST_NEEDS_HOUSEHOLD');

    const badClass = await submit([
      memberEntry('s', scout!.personId, 'scout'),
      guestEntry('g1', 's', 'scout', { guest_name: 'Not A Guest Class' })
    ]);
    expect(badClass.error?.message).toContain('GUEST_CLASS_INVALID');
  });

  it('Rpc_RejectsGuestCreation_WhenHouseholdExceedsCap', async () => {
    await setup({ guestMode: 'named' }, 'GCAP');
    for (let i = 0; i < 25; i++) await makeGuestPerson(admin, household!, `Cap Guest ${i}`);
    const { error } = await submit([
      memberEntry('s', scout!.personId, 'scout'),
      guestEntry('g1', 's', 'youth_guest', { guest_name: 'One Too Many' })
    ]);
    expect(error?.message).toContain('GUEST_HOUSEHOLD_CAP');
    expect((await guestIds(admin, household!)).length).toBe(25);
  });

  it('Rpc_RejectsGuestName_ExceedingLengthLimit_OrBlank', async () => {
    await setup({ guestMode: 'named' }, 'GLEN');
    const long = await submit([
      memberEntry('s', scout!.personId, 'scout'),
      guestEntry('g1', 's', 'youth_guest', { guest_name: 'x'.repeat(81) })
    ]);
    expect(long.error?.message).toContain('GUEST_NAME_TOO_LONG');
    const blank = await submit([
      memberEntry('s', scout!.personId, 'scout'),
      guestEntry('g1', 's', 'youth_guest', { guest_name: '   ' })
    ]);
    expect(blank.error?.message).toContain('GUEST_NAME_REQUIRED');
    expect((await guestIds(admin, household!)).length).toBe(0);
  });

  it('Rpc_GuestFollowsItsHost_NoWhenHostSaysNo_WaitlistWhenTheEventIsFull', async () => {
    await setup({ guestMode: 'named', capacity: 1, waitlistEnabled: true }, 'GFLW');
    // Host 'no' ⇒ guest 'no' (nothing takes a seat).
    const no = await submit([
      memberEntry('s', scout!.personId, 'scout', 'no'),
      guestEntry('g1', 's', 'youth_guest', { guest_name: 'Follows No' })
    ]);
    expect(no.error).toBeNull();
    let all = await rows();
    expect(all.every((r) => r.status === 'no')).toBe(true);

    // Host 'yes' takes the only seat; the guest is waitlisted, not refused.
    const yes = await submit([
      memberEntry('s', scout!.personId, 'scout', 'yes'),
      guestEntry('g1', 's', 'youth_guest', { person_id: all.find((r) => r.host_entry_id != null)!.person_id })
    ]);
    expect(yes.error).toBeNull();
    all = await rows();
    expect(all.find((r) => r.person_id === scout!.personId)?.status).toBe('yes');
    expect(all.find((r) => r.host_entry_id != null)?.status).toBe('waitlist');
  });

  it('Rpc_RevivesTheCancelledRow_InsteadOfTwinning_WhenAFamilyReRegisters', async () => {
    await setup({ guestMode: 'none' }, 'GRVV');
    const first = await submit([memberEntry('s', scout!.personId, 'scout')]);
    expect(first.error).toBeNull();
    let all = await rows();
    const original = all[0];
    // Leader removes (soft cancel) …
    await admin.from('signup_entries').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', original.id);
    // … and the family re-registers: same row comes back, no second one.
    const again = await submit([memberEntry('s', scout!.personId, 'scout')]);
    expect(again.error).toBeNull();
    all = await rows();
    expect(all.length).toBe(1);
    expect(all[0].id).toBe(original.id);
    expect(all[0].status).toBe('yes');
    const { data: row } = await admin.from('signup_entries').select('cancelled_at').eq('id', original.id).single();
    expect(row?.cancelled_at).toBeNull();
  });
});
