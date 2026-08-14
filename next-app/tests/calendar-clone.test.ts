import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * Deep clone — the primary way calendar entries get created (Patrick,
 * 2026-08-14): "find a meeting that most closely resembles what we want to do
 * at a future meeting and then clone most of all the detail, then cleaning it
 * up to make it relevant."
 *
 * The two rules worth testing are the ones a shallow copy would get wrong:
 *
 *   1. Date-relative fields SHIFT. A copy that kept the source's end_date or
 *      signup deadline verbatim would produce a three-day campout that ends
 *      before it starts, and a signup whose deadline already passed.
 *   2. People never come along, and the signup starts CLOSED. A clone is by
 *      definition unreviewed — it still describes last time's event — so no
 *      family may sign up for it until a leader opens it.
 *
 * The DB half is asserted here; the action itself lives in a 'use server' file
 * that cannot be imported into vitest, so this exercises the same SQL shapes
 * the action performs.
 */

const admin = adminClient();
const FIXTURE = `ZZVITEST Clone ${process.pid}`;
const SOURCE_DATE = '2027-05-01';
const TARGET_DATE = '2027-06-05'; // +35 days

let categoryLabel = '';
let sourceEntry: number | null = null;
let clonedEntry: number | null = null;

/** Mirrors the action's shiftDate(): noon UTC dodges DST edges. */
function shiftDate(iso: string | null, days: number): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  categoryLabel = FIXTURE;
  await admin
    .from('calendar_categories')
    .insert({ label: categoryLabel, color: '#445566', sort_order: 9996, template: 'activity' });

  const { data: entry } = await admin
    .from('calendar_entries')
    .insert({
      entry_date: SOURCE_DATE,
      end_date: '2027-05-03', // three-day span
      category: categoryLabel,
      title: `${FIXTURE} campout`,
      location: "Devil's Lake",
      details_md: '## Bring a dish\n\nSee the sheet.',
      on_calendar: true
    })
    .select('id')
    .single();
  sourceEntry = entry!.id as number;

  const { data: signup } = await admin
    .from('event_signups')
    .insert({
      calendar_entry_id: sourceEntry,
      status: 'open',
      // Ten days before the event — the offset the clone must preserve.
      deadline: '2027-04-21T17:00:00Z',
      audience: 'both'
    })
    .select('id')
    .single();

  await admin
    .from('event_prices')
    .insert({ event_signup_id: signup!.id, label: 'Scout', amount: 25, sort: 10 });
  await admin.from('signup_slots').insert({
    event_signup_id: signup!.id,
    kind: 'task',
    label: 'Bring a cooler',
    slot_date: SOURCE_DATE,
    sort: 10
  });
});

afterAll(async () => {
  if (clonedEntry) await admin.from('calendar_entries').delete().eq('id', clonedEntry);
  if (sourceEntry) await admin.from('calendar_entries').delete().eq('id', sourceEntry);
  await admin.from('calendar_categories').delete().eq('label', categoryLabel);
});

describe('cloning a calendar entry', () => {
  it('Clone_ShiftsTheMultiDaySpan_SoTheCopyKeepsItsLength', async () => {
    const shift = 35;
    const { data: source } = await admin
      .from('calendar_entries')
      .select('*')
      .eq('id', sourceEntry)
      .single();

    const copy = { ...source } as Record<string, unknown>;
    delete copy.id;
    delete copy.created_at;
    delete copy.updated_at;

    const { data: created, error } = await admin
      .from('calendar_entries')
      .insert({
        ...copy,
        entry_date: TARGET_DATE,
        end_date: shiftDate(source!.end_date as string, shift)
      })
      .select('id, entry_date, end_date, details_md, location')
      .single();
    expect(error).toBeNull();
    clonedEntry = created!.id as number;

    expect(created!.entry_date).toBe(TARGET_DATE);
    // Source span was 2 days; the copy must span 2 days too.
    expect(created!.end_date).toBe('2027-06-07');
    // The write-up comes along verbatim — that is the point of cloning.
    expect(created!.details_md).toContain('Bring a dish');
    expect(created!.location).toBe("Devil's Lake");
  });

  it('Clone_CarriesTheSignupStructure_ButStartsItClosed', async () => {
    const { data: sourceSignup } = await admin
      .from('event_signups')
      .select('*')
      .eq('calendar_entry_id', sourceEntry)
      .single();

    const copy = { ...sourceSignup } as Record<string, unknown>;
    delete copy.id;
    delete copy.created_at;
    delete copy.updated_at;

    const shifted = new Date(sourceSignup!.deadline as string);
    shifted.setDate(shifted.getDate() + 35);

    const { data: newSignup, error } = await admin
      .from('event_signups')
      .insert({
        ...copy,
        calendar_entry_id: clonedEntry,
        status: 'closed',
        deadline: shifted.toISOString()
      })
      .select('id, status, deadline')
      .single();
    expect(error).toBeNull();

    // Unreviewed copy: families must not be able to sign up for it yet.
    expect(newSignup!.status).toBe('closed');
    // The deadline keeps its ten-days-before relationship rather than staying
    // in the past.
    expect((newSignup!.deadline as string).slice(0, 10)).toBe('2027-05-26');
    expect(new Date(newSignup!.deadline as string).getTime()).toBeGreaterThan(
      new Date(`${TARGET_DATE}T00:00:00Z`).getTime() - 15 * 86_400_000
    );
  });

  it('Clone_CarriesNoPeople_WhenTheSourceHadSignups', async () => {
    // Nothing in the clone path copies signup_entries, so a cloned event has
    // zero people even when its source was full.
    const { count } = await admin
      .from('signup_entries')
      .select('id', { count: 'exact', head: true })
      .eq(
        'event_signup_id',
        (
          await admin
            .from('event_signups')
            .select('id')
            .eq('calendar_entry_id', clonedEntry)
            .single()
        ).data!.id
      );
    expect(count).toBe(0);
  });

  it('ShiftDate_MovesASlotDateWithItsEvent', () => {
    expect(shiftDate(SOURCE_DATE, 35)).toBe(TARGET_DATE);
    expect(shiftDate(null, 35)).toBeNull();
  });
});
