import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Leader-side event-builder business logic, separated from the 'use server'
 * actions in app/admin/(workspace)/events/actions.ts so it's testable without
 * a request-scoped `cookies()` call (see lib/library-data.ts for the same
 * pattern). Every function here takes an already-authenticated admin client —
 * callers are responsible for requireRole(['leader']) first.
 */

export interface BackfillPricesResult {
  applied: number;
  /** No tier at all applies to this person's kind — nothing to assign. */
  skippedNoTier: number;
  /** 2+ tiers apply to this person's kind — which one they'd have picked
   *  can't be inferred, so left for a leader to assign by hand. */
  skippedAmbiguous: number;
  /** The one eligible tier is priced per-day, but a pre-existing entry has no
   *  stored day count to multiply against — guessing would misstate the
   *  amount, so these are left alone too. */
  skippedPerDay: number;
}

interface PriceRow {
  id: number;
  per: string;
  applies_to: string;
}
interface EntryRow {
  id: number;
  person_kind: 'scout' | 'adult';
}

/**
 * Assigns a price_id to existing signup_entries that have none, wherever the
 * choice is unambiguous. Safe to call repeatedly (idempotent — only touches
 * price_id IS NULL rows) and safe to call with zero or many tiers on the
 * event; entries that already picked a tier are never touched.
 */
export async function backfillEventPrices(
  admin: SupabaseClient,
  signupId: number
): Promise<BackfillPricesResult> {
  const [{ data: priceData }, { data: entryData }] = await Promise.all([
    admin.from('event_prices').select('id, per, applies_to').eq('event_signup_id', signupId),
    admin
      .from('signup_entries')
      .select('id, person_kind')
      .eq('event_signup_id', signupId)
      .is('price_id', null)
      .neq('status', 'cancelled')
  ]);
  const tiers = (priceData ?? []) as PriceRow[];
  const entries = (entryData ?? []) as EntryRow[];

  const result: BackfillPricesResult = {
    applied: 0,
    skippedNoTier: 0,
    skippedAmbiguous: 0,
    skippedPerDay: 0
  };

  for (const kind of ['scout', 'adult'] as const) {
    const audience = kind === 'scout' ? 'scouts' : 'adults';
    const eligible = tiers.filter((t) => t.applies_to === 'both' || t.applies_to === audience);
    const kindEntries = entries.filter((e) => e.person_kind === kind);
    if (kindEntries.length === 0) continue;

    if (eligible.length === 0) {
      result.skippedNoTier += kindEntries.length;
      continue;
    }
    if (eligible.length > 1) {
      result.skippedAmbiguous += kindEntries.length;
      continue;
    }
    const tier = eligible[0];
    if (tier.per === 'day') {
      result.skippedPerDay += kindEntries.length;
      continue;
    }

    const ids = kindEntries.map((e) => e.id);
    const { error } = await admin.from('signup_entries').update({ price_id: tier.id }).in('id', ids);
    if (!error) result.applied += ids.length;
  }

  return result;
}

export interface SlotClaimant {
  name: string;
  status: string;
}

/** Who currently holds a claim on this slot — the dry-run info shown before
 *  a destructive delete (signup_slot_claims cascades on slot delete). */
export async function slotClaimants(admin: SupabaseClient, slotId: number): Promise<SlotClaimant[]> {
  const { data: claimData } = await admin
    .from('signup_slot_claims')
    .select('signup_entry_id')
    .eq('slot_id', slotId);
  const entryIds = ((claimData ?? []) as { signup_entry_id: number }[]).map((c) => c.signup_entry_id);
  if (entryIds.length === 0) return [];

  const { data: entryData } = await admin
    .from('signup_entries')
    .select('id, person_id, status')
    .in('id', entryIds)
    .neq('status', 'cancelled');
  const entries = (entryData ?? []) as { id: number; person_id: number | null; status: string }[];
  if (entries.length === 0) return [];

  const personIds = entries.map((e) => e.person_id).filter((v): v is number => v != null);
  const { data: peopleData } = await admin.from('people').select('id, display_name').in('id', personIds);
  const nameById = new Map(
    ((peopleData ?? []) as { id: number; display_name: string }[]).map((p) => [p.id, p.display_name])
  );

  return entries.map((e) => ({
    name: e.person_id != null ? (nameById.get(e.person_id) ?? 'Unknown') : 'Unknown',
    status: e.status
  }));
}

export interface QuestionAnswerRow {
  name: string;
  value: string;
}

/** Every recorded answer to this question — the dry-run info shown before a
 *  destructive delete (signup_answers cascades on question delete). */
export async function questionAnswers(
  admin: SupabaseClient,
  questionId: number
): Promise<QuestionAnswerRow[]> {
  const { data: answerData } = await admin
    .from('signup_answers')
    .select('signup_entry_id, value')
    .eq('question_id', questionId);
  const answers = (answerData ?? []) as { signup_entry_id: number; value: string }[];
  if (answers.length === 0) return [];

  const entryIds = answers.map((a) => a.signup_entry_id);
  const { data: entryData } = await admin.from('signup_entries').select('id, person_id').in('id', entryIds);
  const personIdByEntry = new Map(
    ((entryData ?? []) as { id: number; person_id: number | null }[]).map((e) => [e.id, e.person_id])
  );
  const personIds = [...personIdByEntry.values()].filter((v): v is number => v != null);
  const { data: peopleData } = await admin.from('people').select('id, display_name').in('id', personIds);
  const nameById = new Map(
    ((peopleData ?? []) as { id: number; display_name: string }[]).map((p) => [p.id, p.display_name])
  );

  return answers.map((a) => {
    const personId = personIdByEntry.get(a.signup_entry_id);
    return {
      name: personId != null ? (nameById.get(personId) ?? 'Unknown') : 'Unknown',
      value: a.value
    };
  });
}
