/**
 * Whose scout account may pay an event fee (Patrick, 2026-10-05: "allow scout
 * account funds to be applied to anyone in the family" — Winnie's balance pays
 * her dad's High Cliff fee).
 *
 * The rule, in one place: the attendee's own account, or the account of anyone
 * who shares a household with them. A guest has no account of their own, so a
 * guest's family is the household that brought them. The ledger needs nothing
 * new for this — a fee row has always carried its own person (whose balance
 * moves) and its own signup entry (whose fee it pays); they simply stop having
 * to be the same person.
 *
 * Takes the client as an argument (no next/headers) so the db tests can call it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeScoutAccountBalances, type FinancialTransactionRow } from './finance';
import { fetchAllRows } from './supabase/paginate';

export interface FamilyScoutAccount {
  personId: number;
  name: string;
  balance: number;
}

export interface FamilyScoutAccounts {
  /** The attendee's display name; null when the person row is missing. */
  name: string | null;
  /** The attendee's own balance; null for a guest (no scout account). */
  ownBalance: number | null;
  /** Everyone else in the family who has a scout account — at least one
   *  live scout_account row — with its derived balance. Sorted by name. */
  family: FamilyScoutAccount[];
}

export async function loadFamilyScoutAccounts(supabase: SupabaseClient, personId: number): Promise<FamilyScoutAccounts> {
  const [{ data: me }, { data: mine }] = await Promise.all([
    supabase.from('people').select('display_name, guest_host_household_id').eq('id', personId).maybeSingle(),
    supabase.from('household_members').select('household_id').eq('person_id', personId)
  ]);
  const self = me as { display_name: string; guest_host_household_id: number | null } | null;
  const isGuest = self?.guest_host_household_id != null;
  const householdIds = ((mine ?? []) as { household_id: number }[]).map((m) => m.household_id);
  if (self?.guest_host_household_id != null) householdIds.push(self.guest_host_household_id);

  let relatives: number[] = [];
  if (householdIds.length > 0) {
    const { data: members } = await supabase.from('household_members').select('person_id').in('household_id', householdIds);
    relatives = [...new Set(((members ?? []) as { person_id: number }[]).map((m) => m.person_id))].filter((id) => id !== personId);
  }

  const rows = await fetchAllRows<FinancialTransactionRow>((from, to) =>
    supabase
      .from('financial_transactions')
      .select('account, amount, person_id, voided_at')
      .eq('account', 'scout_account')
      .in('person_id', [personId, ...relatives])
      .order('id')
      .range(from, to)
  );
  const balances = computeScoutAccountBalances(rows);

  const withAccount = relatives.filter((id) => balances.has(id));
  const names = new Map<number, string>();
  if (withAccount.length > 0) {
    const { data: people } = await supabase.from('people').select('id, display_name').in('id', withAccount);
    for (const p of (people ?? []) as { id: number; display_name: string }[]) names.set(p.id, p.display_name);
  }

  return {
    name: self?.display_name ?? null,
    ownBalance: isGuest ? null : (balances.get(personId) ?? 0),
    family: withAccount
      .map((id) => ({ personId: id, name: names.get(id) ?? `#${id}`, balance: balances.get(id) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name))
  };
}

export type ScoutAccountPayer =
  | {
      ok: true;
      /** Whose scout_account the row lands on. */
      personId: number | null;
      /** The attendee's name when someone else's account pays — the memo
       *  says who the fee was for, so the paying family's history reads right. */
      onBehalfOf: string | null;
    }
  | { ok: false; error: string };

/** The server-side gate behind the picker: a requested account that is not the
 *  attendee's own must belong to the attendee's family, whatever the client sent. */
export async function resolveScoutAccountPayer(
  supabase: SupabaseClient,
  entryPersonId: number | null,
  requestedPersonId: number | null | undefined
): Promise<ScoutAccountPayer> {
  if (requestedPersonId == null || requestedPersonId === entryPersonId) return { ok: true, personId: entryPersonId, onBehalfOf: null };
  if (entryPersonId == null) return { ok: false, error: 'This row has no person, so it has no family account to draw on.' };
  const accounts = await loadFamilyScoutAccounts(supabase, entryPersonId);
  if (!accounts.family.some((a) => a.personId === requestedPersonId)) {
    return { ok: false, error: `That scout account is not in ${accounts.name ?? 'this person'}'s family.` };
  }
  return { ok: true, personId: requestedPersonId, onBehalfOf: accounts.name };
}
