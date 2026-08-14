/**
 * Roll Call's write cascade — attendance in, credit through to the ledger.
 *
 * Extracted from the `'use server'` actions file so it can be called directly
 * from tests. That is not tidiness: qa-lead found a credit-duplication bug in
 * this exact logic that a green 171-test suite had sailed past, precisely
 * because the cascade lived inside a server action nothing could invoke. The
 * codebase already had this pattern — `lib/event-signup-admin.ts` exists for
 * the same reason — and Roll Call should have followed it first time.
 *
 * The rules, in one place:
 *   check   → upsert attendance, then upsert credit
 *   uncheck → soft-delete credit FIRST, then delete attendance
 *   qty     → update both
 *
 * ORDERING. Both directions are ordered so that a partial failure leaves
 * ATTENDANCE WITHOUT CREDIT, never credit without attendance. The first is
 * loud (the scout is visibly short, and the reconciliation audit says so); the
 * second is a scout silently holding credit for an event they were removed
 * from. On the uncheck path that means retiring the credit before dropping the
 * attendance row that justifies it — the reverse of the obvious order, and the
 * reason it is spelled out here.
 *
 * SOFT DELETE, NEVER HARD. Unchecking a box must not destroy advancement
 * history: a mis-click has to be recoverable, and the Universal Ledger's own
 * delete already works this way.
 */

import type { createAdminClient } from '@/lib/supabase/server';
import { ledgerCodeFor, type CreditKind } from '@/lib/attendance-shared';

export type Result = { ok: boolean; error?: string };

export interface EntryContext {
  id: number;
  entryDate: string;
  title: string;
  creditKind: CreditKind | null;
  defaultQty: number;
}

type Db = ReturnType<typeof createAdminClient>;

export function unitFor(creditKind: CreditKind): string {
  if (creditKind === 'camping_nights') return 'nights';
  if (creditKind === 'service_hours') return 'hours';
  if (creditKind === 'hiking_miles') return 'miles';
  return 'each';
}

/**
 * The scout this person is, or null for an adult. Adults have no ledger at all,
 * so this is also the "does credit apply?" test — a role check would be the
 * wrong question, since the ledger is keyed by scout_id.
 */
export async function scoutIdFor(db: Db, personId: number): Promise<string | null> {
  const { data, error } = await db
    .from('scouts')
    .select('id')
    .eq('person_id', personId)
    .maybeSingle();
  // Fail closed: a read error here previously read as "adult", which silently
  // skipped credit for a scout.
  if (error) throw new Error(`Could not resolve the scout for person ${personId}: ${error.message}`);
  return (data?.id as string) ?? null;
}

/**
 * Bring the ledger in line with one person's attendance.
 *
 * IDEMPOTENT VIA THE DATABASE, not via a read-then-branch. The previous version
 * looked for an existing row with `.maybeSingle()`, discarded its error, and
 * inserted when it saw null — so two rows sharing the pair (a race, or a
 * pre-existing duplicate) made it insert a third. `ledger_entries` now carries
 * `unique (calendar_entry_id, scout_id) where calendar_entry_id is not null`,
 * and this upserts against it, which makes duplication impossible rather than
 * merely unlikely.
 *
 * A soft-deleted row is REVIVED by the same upsert, which is what makes
 * uncheck-then-recheck return to where it started instead of stacking rows.
 */
export async function syncCredit(
  db: Db,
  ctx: EntryContext,
  personId: number,
  qty: number,
  by: string
): Promise<Result> {
  if (!ctx.creditKind) return { ok: true }; // category grants nothing

  let scoutId: string | null;
  try {
    scoutId = await scoutIdFor(db, personId);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (!scoutId) return { ok: true }; // adults have no ledger

  const { error } = await db.from('ledger_entries').upsert(
    {
      scout_id: scoutId,
      date: ctx.entryDate,
      kind: ctx.creditKind,
      code: ledgerCodeFor(ctx.creditKind, ctx.id, ctx.entryDate),
      label: ctx.title,
      qty,
      unit: unitFor(ctx.creditKind),
      entered_by: by,
      calendar_entry_id: ctx.id,
      // Revive rather than duplicate when this pair was previously removed.
      deleted_at: null,
      deleted_by: null,
      deleted_reason: null
    },
    { onConflict: 'calendar_entry_id,scout_id' }
  );
  return error ? { ok: false, error: `Attendance saved, credit failed: ${error.message}` } : { ok: true };
}

/**
 * Retire the credit an attendance row justified.
 *
 * Also matches the OLD meeting-attendance screen's rows, which were written
 * with `code='MTG:<date>'` and no `calendar_entry_id`. Without that fallback a
 * meeting checked in on the old screen and unchecked here would leave its
 * credit standing.
 */
export async function retireCredit(
  db: Db,
  ctx: EntryContext,
  personId: number,
  by: string
): Promise<Result> {
  if (!ctx.creditKind) return { ok: true };

  let scoutId: string | null;
  try {
    scoutId = await scoutIdFor(db, personId);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (!scoutId) return { ok: true };

  const removal = {
    deleted_at: new Date().toISOString(),
    deleted_by: by,
    deleted_reason: `Removed from Roll Call for "${ctx.title}"`
  };

  const { error } = await db
    .from('ledger_entries')
    .update(removal)
    .eq('calendar_entry_id', ctx.id)
    .eq('scout_id', scoutId)
    .is('deleted_at', null);
  if (error) return { ok: false, error: `Could not remove the credit: ${error.message}` };

  // Legacy rows from the retired meetings screen carry the code but no entry
  // link. Same scout, same code, same date — the same fact, recorded before
  // Roll Call existed.
  const { error: legacyErr } = await db
    .from('ledger_entries')
    .update(removal)
    .is('calendar_entry_id', null)
    .eq('scout_id', scoutId)
    .eq('code', ledgerCodeFor(ctx.creditKind, ctx.id, ctx.entryDate))
    .eq('date', ctx.entryDate)
    .is('deleted_at', null);
  return legacyErr
    ? { ok: false, error: `Could not remove the legacy credit: ${legacyErr.message}` }
    : { ok: true };
}

/**
 * Adopt any pre-Roll-Call credit for this scout/event so the upsert recognises
 * it instead of inserting alongside it.
 *
 * The old meetings screen wrote `MTG:<date>` rows with no `calendar_entry_id`.
 * `syncCredit` keys on that column, so without this the first Roll Call of a
 * meeting somebody was already checked into would create a SECOND
 * meeting_attendance row for the same scout and date.
 */
export async function adoptLegacyCredit(
  db: Db,
  ctx: EntryContext,
  scoutId: string
): Promise<void> {
  if (!ctx.creditKind) return;
  await db
    .from('ledger_entries')
    .update({ calendar_entry_id: ctx.id })
    .is('calendar_entry_id', null)
    .eq('scout_id', scoutId)
    .eq('code', ledgerCodeFor(ctx.creditKind, ctx.id, ctx.entryDate))
    .eq('date', ctx.entryDate);
}
