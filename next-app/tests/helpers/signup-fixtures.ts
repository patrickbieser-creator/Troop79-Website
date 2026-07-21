import type { SupabaseClient } from '@supabase/supabase-js';

/** Every fixture id this file hands out is prefixed so cleanup queries (and a
 *  human staring at a stray row) can tell test data from real troop data at a
 *  glance. Scouts.id is a free-text business key, so this is a real, if soft,
 *  guard against colliding with a real scout code. */
export const TEST_PREFIX = 'ZZVITEST';

let counter = 0;
/** Unique-enough suffix per test run without touching Date.now()/Math.random()
 *  (both are fine in a Vitest process — this just avoids any temptation to
 *  reuse ids across concurrent test files). */
function nextId(): string {
  counter += 1;
  return `${TEST_PREFIX}${process.pid}_${counter}`;
}

export interface TestEvent {
  calendarEntryId: number;
  eventSignupId: number;
}

/** A calendar entry + event_signups row, deep enough for submit_household_signup
 *  to accept entries against it. Deleting calendarEntryId cascades away the
 *  event_signups row and everything under it (prices, slots, entries). */
export async function createTestEvent(
  admin: SupabaseClient,
  opts: {
    capacity?: number | null;
    waitlistEnabled?: boolean;
    audience?: 'scouts' | 'adults' | 'both';
  } = {}
): Promise<TestEvent> {
  const { data: entry, error: entryErr } = await admin
    .from('calendar_entries')
    .insert({
      entry_date: '2027-01-01',
      category: 'Campout / Overnight',
      title: `${TEST_PREFIX} fixture event`
    })
    .select('id')
    .single();
  if (entryErr || !entry) throw new Error(`fixture: calendar_entries insert failed: ${entryErr?.message}`);

  const { data: signup, error: signupErr } = await admin
    .from('event_signups')
    .insert({
      calendar_entry_id: entry.id,
      deadline: '2026-12-31T00:00:00Z',
      capacity: opts.capacity ?? null,
      waitlist_enabled: opts.waitlistEnabled ?? false,
      audience: opts.audience ?? 'both'
    })
    .select('id')
    .single();
  if (signupErr || !signup) throw new Error(`fixture: event_signups insert failed: ${signupErr?.message}`);

  return { calendarEntryId: entry.id, eventSignupId: signup.id };
}

/** Deleting the calendar entry cascades away event_signups/prices/slots/entries.
 *  Callers must delete the event BEFORE any scout/person it references —
 *  signup_entries.scout_id/scout_parent_id/leader_code have no ON DELETE
 *  CASCADE, so deleting the person first leaves the FK dangling and that
 *  delete fails. */
export async function deleteTestEvent(admin: SupabaseClient, event: TestEvent): Promise<void> {
  const { error } = await admin.from('calendar_entries').delete().eq('id', event.calendarEntryId);
  if (error) throw new Error(`fixture cleanup: calendar_entries delete failed: ${error.message}`);
}

export interface TestScout {
  scoutId: string;
  personId: number;
}

/** A minimal scout + its backing person row, both test-prefixed. */
export async function createTestScout(admin: SupabaseClient, label: string): Promise<TestScout> {
  const scoutId = nextId();

  const { data: person, error: personErr } = await admin
    .from('people')
    .insert({ display_name: `${TEST_PREFIX} Scout ${label}` })
    .select('id')
    .single();
  if (personErr || !person) throw new Error(`fixture: people insert failed: ${personErr?.message}`);

  const { error: scoutErr } = await admin.from('scouts').insert({
    id: scoutId,
    first_name: TEST_PREFIX,
    last_name: label,
    display_name: `${TEST_PREFIX} Scout ${label}`,
    active: true,
    person_id: person.id
  });
  if (scoutErr) throw new Error(`fixture: scouts insert failed: ${scoutErr.message}`);

  return { scoutId, personId: person.id };
}

export async function deleteTestScout(admin: SupabaseClient, scout: TestScout): Promise<void> {
  // Errors surfaced, not swallowed: a lingering signup_entries FK (caller
  // deleted the scout before the event that references it) used to fail
  // silently here and leave orphaned fixture rows in the database.
  const { error: scoutErr } = await admin.from('scouts').delete().eq('id', scout.scoutId);
  if (scoutErr) throw new Error(`fixture cleanup: scouts delete failed: ${scoutErr.message}`);
  const { error: personErr } = await admin.from('people').delete().eq('id', scout.personId);
  if (personErr) throw new Error(`fixture cleanup: people delete failed: ${personErr.message}`);
}

export interface TestDualIdentityAdult {
  personId: number;
  scoutParentId: number;
  leaderCode: string;
  /** The scout scout_parents hangs off of — required by its schema, not
   *  meaningful to the test itself. */
  anchorScout: TestScout;
}

/** The exact shape of the historical bug (D-042): one adult reachable through
 *  BOTH a scout_parents row and a leaders row, sharing one person_id. */
export async function createDualIdentityAdult(
  admin: SupabaseClient,
  label: string
): Promise<TestDualIdentityAdult> {
  const anchorScout = await createTestScout(admin, `${label}Anchor`);

  const { data: person, error: personErr } = await admin
    .from('people')
    .insert({ display_name: `${TEST_PREFIX} Adult ${label}` })
    .select('id')
    .single();
  if (personErr || !person) throw new Error(`fixture: people insert failed: ${personErr?.message}`);

  const { data: parent, error: parentErr } = await admin
    .from('scout_parents')
    .insert({
      scout_id: anchorScout.scoutId,
      name: `${TEST_PREFIX} Adult ${label}`,
      person_id: person.id
    })
    .select('id')
    .single();
  if (parentErr || !parent) throw new Error(`fixture: scout_parents insert failed: ${parentErr?.message}`);

  const leaderCode = nextId().slice(-8);
  const { error: leaderErr } = await admin.from('leaders').insert({
    code: leaderCode,
    name: `${TEST_PREFIX} Adult ${label}`,
    is_person: true,
    person_id: person.id
  });
  if (leaderErr) throw new Error(`fixture: leaders insert failed: ${leaderErr.message}`);

  return { personId: person.id, scoutParentId: parent.id, leaderCode, anchorScout };
}

export async function deleteDualIdentityAdult(admin: SupabaseClient, adult: TestDualIdentityAdult): Promise<void> {
  const { error: leaderErr } = await admin.from('leaders').delete().eq('code', adult.leaderCode);
  if (leaderErr) throw new Error(`fixture cleanup: leaders delete failed: ${leaderErr.message}`);
  const { error: parentErr } = await admin.from('scout_parents').delete().eq('id', adult.scoutParentId);
  if (parentErr) throw new Error(`fixture cleanup: scout_parents delete failed: ${parentErr.message}`);
  const { error: personErr } = await admin.from('people').delete().eq('id', adult.personId);
  if (personErr) throw new Error(`fixture cleanup: people delete failed: ${personErr.message}`);
  await deleteTestScout(admin, adult.anchorScout);
}
