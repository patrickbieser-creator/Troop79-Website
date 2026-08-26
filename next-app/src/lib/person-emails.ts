import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Multiple email addresses per person (Plans/Retire-Roster-Contact-Columns.md
 * Phase 2) — the layer above `person_emails`, the table added in
 * `20260826200000_people_canonical_and_person_emails.sql`.
 *
 * `people.primary_email` stays a denormalized cache of the `is_primary` row,
 * kept in sync by two DB triggers (person_emails -> people, and the reverse)
 * so every existing reader of `people.primary_email` keeps working unchanged.
 * This module is the only thing that should write `person_emails` directly —
 * the profile self-service editor, the roster adult/leader editor, and
 * lib/email-recipients.ts read through it (the last via emailsForPeople()).
 *
 * THE ONE-PRIMARY INVARIANT is a partial unique index
 * (`person_emails_one_primary`, `where is_primary`) — Postgres enforces it,
 * this module just has to never violate it mid-transaction. setPrimaryEmail()
 * demotes the current primary BEFORE promoting the new one for exactly that
 * reason: promote-then-demote would momentarily hold two primary rows for the
 * same person and the index would reject the promote.
 */

export type PersonEmailLabel = 'home' | 'work' | 'other';

export interface PersonEmailRow {
  id: number;
  personId: number;
  email: string;
  label: PersonEmailLabel;
  isPrimary: boolean;
  verifiedAt: string | null;
  bouncedAt: string | null;
  unsubscribedAt: string | null;
}

interface RawPersonEmailRow {
  id: number;
  person_id: number;
  email: string;
  label: string;
  is_primary: boolean;
  verified_at: string | null;
  bounced_at: string | null;
  unsubscribed_at: string | null;
}

function toRow(r: RawPersonEmailRow): PersonEmailRow {
  return {
    id: r.id,
    personId: r.person_id,
    email: r.email,
    label: (r.label as PersonEmailLabel) ?? 'home',
    isPrimary: r.is_primary,
    verifiedAt: r.verified_at,
    bouncedAt: r.bounced_at,
    unsubscribedAt: r.unsubscribed_at
  };
}

const COLUMNS = 'id, person_id, email, label, is_primary, verified_at, bounced_at, unsubscribed_at';

/** Primary first, then alphabetically — the same order every list in the UI
 *  should render in, so callers never have to re-sort. */
function sortRows(rows: PersonEmailRow[]): PersonEmailRow[] {
  return [...rows].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.email.localeCompare(b.email);
  });
}

export async function listPersonEmails(
  supabase: SupabaseClient,
  personId: number
): Promise<PersonEmailRow[]> {
  const { data, error } = await supabase
    .from('person_emails')
    .select(COLUMNS)
    .eq('person_id', personId);
  if (error) throw new Error(`Could not load email addresses: ${error.message}`);
  return sortRows(((data ?? []) as unknown as RawPersonEmailRow[]).map(toRow));
}

/**
 * Add an address for a person. The FIRST address a person gets is made
 * primary automatically — there is nothing to choose between yet, and
 * without this a brand-new person would have zero deliverable addresses
 * despite `email` having just been typed in.
 */
export async function addPersonEmail(
  supabase: SupabaseClient,
  personId: number,
  email: string,
  label: PersonEmailLabel = 'home'
): Promise<PersonEmailRow> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.indexOf('@') <= 0) {
    throw new Error('Enter a valid email address.');
  }

  const { count } = await supabase
    .from('person_emails')
    .select('id', { count: 'exact', head: true })
    .eq('person_id', personId);
  const makesPrimary = (count ?? 0) === 0;

  const { data, error } = await supabase
    .from('person_emails')
    .insert({ person_id: personId, email: normalized, label, is_primary: makesPrimary })
    .select(COLUMNS)
    .single();
  if (error) {
    if (error.code === '23505') {
      throw new Error('That address is already on file for this person.');
    }
    throw new Error(`Could not add that address: ${error.message}`);
  }
  return toRow(data as unknown as RawPersonEmailRow);
}

/**
 * Make one of a person's existing addresses the primary — demote, then
 * promote, never the reverse (see the module header for why the order is
 * load-bearing against the partial unique index).
 */
export async function setPrimaryEmail(
  supabase: SupabaseClient,
  personId: number,
  emailId: number
): Promise<void> {
  const { data: target, error: findErr } = await supabase
    .from('person_emails')
    .select('id, is_primary')
    .eq('id', emailId)
    .eq('person_id', personId)
    .maybeSingle();
  if (findErr) throw new Error(`Could not load that address: ${findErr.message}`);
  if (!target) throw new Error('That address does not belong to this person.');
  if ((target as { is_primary: boolean }).is_primary) return; // already primary — nothing to do

  const { error: demoteErr } = await supabase
    .from('person_emails')
    .update({ is_primary: false })
    .eq('person_id', personId)
    .eq('is_primary', true);
  if (demoteErr) throw new Error(`Could not update the primary address: ${demoteErr.message}`);

  const { error: promoteErr } = await supabase
    .from('person_emails')
    .update({ is_primary: true })
    .eq('id', emailId);
  if (promoteErr) throw new Error(`Could not update the primary address: ${promoteErr.message}`);
}

/**
 * Remove one of a person's addresses. REFUSES two ways, both by design
 * (Plans/Retire-Roster-Contact-Columns.md Phase 2):
 *
 *   - the person's only address — everyone needs at least one way to be
 *     reached, and person_emails backfeeds people.primary_email, so an empty
 *     table would silently null out the roster's contact address too.
 *   - the primary address — set another one as primary first. Removing a
 *     primary out from under the one-primary index would either leave the
 *     person with none (people.primary_email goes null on the very row a
 *     sign-in code might be mid-flight to) or require this function to guess
 *     a replacement, which is a leader/family decision, not this module's.
 */
export async function removePersonEmail(
  supabase: SupabaseClient,
  personId: number,
  emailId: number
): Promise<void> {
  const rows = await listPersonEmails(supabase, personId);
  if (rows.length <= 1) {
    throw new Error('This is the only address on file — add another before removing this one.');
  }
  const target = rows.find((r) => r.id === emailId);
  if (!target) throw new Error('That address does not belong to this person.');
  if (target.isPrimary) {
    throw new Error('Cannot remove the primary address — set another address as primary first.');
  }

  const { error } = await supabase.from('person_emails').delete().eq('id', emailId).eq('person_id', personId);
  if (error) throw new Error(`Could not remove that address: ${error.message}`);
}

/**
 * Batch read for lib/email-recipients.ts — every household adult's addresses
 * in one query rather than one per person. Keyed by person id; a person with
 * no rows is simply absent from the map (callers use `.get(id) ?? []`).
 */
export async function emailsForPeople(
  supabase: SupabaseClient,
  personIds: number[]
): Promise<Map<number, PersonEmailRow[]>> {
  const out = new Map<number, PersonEmailRow[]>();
  if (personIds.length === 0) return out;

  const { data, error } = await supabase.from('person_emails').select(COLUMNS).in('person_id', personIds);
  if (error) throw new Error(`Could not load email addresses: ${error.message}`);
  for (const raw of (data ?? []) as unknown as RawPersonEmailRow[]) {
    const row = toRow(raw);
    out.set(row.personId, [...(out.get(row.personId) ?? []), row]);
  }
  for (const [personId, rows] of out) out.set(personId, sortRows(rows));
  return out;
}
