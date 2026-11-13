'use server';

/**
 * Scout Accounts (admin Money › Scout Accounts, 2026-11-12): every scout-account holder's balance, one holder's
 * ledger, and moving a departed scout's balance to the troop's general fund.
 *
 * Reads accept finance.manage or finance.view, like the Financial Ledger; the move requires finance.manage.
 *
 * The general fund is not an account of its own — Available funds is checking + savings minus every scout account
 * and the scholarship fund (finance/page.tsx). So moving a balance to the troop is ONE row on the scout's account
 * (−balance, kind Transfer): the earmark ends and Available funds rises by the same amount; no bank row moves.
 * The checks' transfer pairing only looks at bank accounts, so this lone leg is not an "unpaired transfer".
 */
import { revalidatePath } from 'next/cache';
import { requireAnyOf, requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { bucketNameOf } from '@/lib/buckets';
import { centralToday } from '@/lib/dates';
import { signOffName } from '@/lib/event-money';
import {
  buildHolderRows,
  canMoveToTroop,
  holderStatus,
  MOVE_TO_TROOP_MEMO,
  summarizeAccount,
  withRunningBalance,
  type AccountSummary,
  type HolderRow
} from '@/lib/scout-accounts';

const PAGE = '/admin/finance/scout-accounts';

type Supa = ReturnType<typeof createAdminClient>;

interface ScoutRow {
  person_id: number | null;
  active: boolean;
  is_webelos: boolean | null;
  inactive_reason: string | null;
}

async function loadScouts(supabase: Supa): Promise<Map<number, { active: boolean; isWebelos: boolean; inactiveReason: string | null }>> {
  const { data, error } = await supabase.from('scouts').select('person_id, active, is_webelos, inactive_reason');
  if (error) throw new Error(error.message);
  const out = new Map<number, { active: boolean; isWebelos: boolean; inactiveReason: string | null }>();
  for (const s of (data ?? []) as ScoutRow[]) {
    if (s.person_id != null) out.set(s.person_id, { active: s.active, isWebelos: s.is_webelos === true, inactiveReason: s.inactive_reason });
  }
  return out;
}

/** Every holder, by name, the Scholarship Fund last. */
export async function listScoutAccountsAction(): Promise<HolderRow[]> {
  await requireAnyOf(['finance.manage', 'finance.view']);
  const supabase = createAdminClient();
  const [txns, scouts] = await Promise.all([
    fetchAllRows<{ account: string; person_id: number | null; amount: number; occurred_on: string; voided_at: string | null }>((from, to) =>
      supabase
        .from('financial_transactions')
        .select('account, person_id, amount, occurred_on, voided_at')
        .in('account', ['scout_account', 'scholarship'])
        .order('id')
        .range(from, to)
    ),
    loadScouts(supabase)
  ]);
  const ids = new Set<number>();
  for (const t of txns) if (t.account === 'scout_account' && t.person_id != null) ids.add(t.person_id);
  for (const [id, s] of scouts) if (s.active) ids.add(id);
  const people = new Map<number, string>();
  if (ids.size > 0) {
    const { data, error } = await supabase.from('people').select('id, display_name').in('id', [...ids]);
    if (error) throw new Error(error.message);
    for (const p of (data ?? []) as { id: number; display_name: string }[]) people.set(p.id, p.display_name);
  }
  return buildHolderRows({
    txns: txns.map((t) => ({ account: t.account, personId: t.person_id, amount: Number(t.amount), occurredOn: t.occurred_on, voidedAt: t.voided_at })),
    people,
    scouts
  });
}

export type AccountTarget = { personId: number } | { account: 'scholarship' };

export interface AccountHistoryTxn {
  id: number;
  occurredOn: string;
  amount: number;
  /** The bucket's name (the event or fundraiser); null when the row sits in none. */
  bucketName: string | null;
  kindLabel: string;
  memo: string | null;
  enteredBy: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  balanceAfter: number | null;
}

export type AccountHistory = { ok: true; summary: AccountSummary; txns: AccountHistoryTxn[] } | { ok: false; error: string };

function validTarget(t: AccountTarget | null | undefined): t is AccountTarget {
  if (!t || typeof t !== 'object') return false;
  if ('account' in t) return t.account === 'scholarship';
  return Number.isSafeInteger(t.personId) && t.personId > 0;
}

interface HistoryRow {
  id: number;
  occurred_on: string;
  amount: number;
  kind: string;
  bucket: unknown;
  memo: string | null;
  voided_at: string | null;
  void_reason: string | null;
  voided_by_person_id: number | null;
  entered_by_person_id: number | null;
}

/** One holder's ledger, newest first, with the balance after each row and who recorded it (initials, else "First L."). */
export async function getScoutAccountHistoryAction(target: AccountTarget): Promise<AccountHistory> {
  await requireAnyOf(['finance.manage', 'finance.view']);
  if (!validTarget(target)) return { ok: false, error: 'Not an account.' };
  const supabase = createAdminClient();
  const rows = await fetchAllRows<HistoryRow>((from, to) => {
    const q = supabase
      .from('financial_transactions')
      .select('id, occurred_on, amount, kind, bucket:buckets(name), memo, voided_at, void_reason, voided_by_person_id, entered_by_person_id')
      .order('id')
      .range(from, to);
    return 'account' in target ? q.eq('account', 'scholarship') : q.eq('account', 'scout_account').eq('person_id', target.personId);
  });

  const signerIds = [...new Set(rows.flatMap((r) => [r.entered_by_person_id, r.voided_by_person_id]).filter((id): id is number => id != null))];
  const [{ data: kinds }, { data: signers }, { data: codes }] = await Promise.all([
    supabase.from('transaction_kinds').select('code, label'),
    signerIds.length > 0
      ? supabase.from('people').select('id, display_name, first_name, last_name').in('id', signerIds)
      : Promise.resolve({ data: [] }),
    signerIds.length > 0 ? supabase.from('leaders').select('code, person_id').in('person_id', signerIds) : Promise.resolve({ data: [] })
  ]);
  const kindLabel = new Map(((kinds ?? []) as { code: string; label: string }[]).map((k) => [k.code, k.label]));
  const codeOf = new Map(((codes ?? []) as { code: string; person_id: number }[]).map((l) => [l.person_id, l.code]));
  const personOf = new Map(
    ((signers ?? []) as { id: number; display_name: string; first_name: string | null; last_name: string | null }[]).map((p) => [p.id, p])
  );
  const signer = (id: number | null): string | null => {
    if (id == null) return null;
    const p = personOf.get(id);
    if (!p) return codeOf.get(id) ?? null;
    return signOffName(codeOf.get(id), { first: p.first_name, last: p.last_name, display: p.display_name });
  };

  const base = rows.map((r) => ({
    id: r.id,
    occurredOn: r.occurred_on,
    amount: Number(r.amount),
    bucketName: bucketNameOf(r.bucket),
    kindLabel: kindLabel.get(r.kind) ?? r.kind,
    memo: r.memo,
    enteredBy: signer(r.entered_by_person_id),
    voidedAt: r.voided_at,
    voidedBy: signer(r.voided_by_person_id),
    voidReason: r.void_reason
  }));
  return { ok: true, summary: summarizeAccount(base), txns: withRunningBalance(base) };
}

export type MoveResult = { ok: true; moved: number } | { ok: false; error: string };

/**
 * Moves a departed scout's whole balance to the troop's general fund: one Transfer row of −balance on their account,
 * dated today. Only for a scout who is no longer active (left, moved, aged out); the balance is read here, never
 * trusted from the screen. Void the row in the Financial Ledger to undo it.
 *
 * Two moves at once (two tabs, two treasurers, a double click) write ONE row: the idempotency key is derived from the
 * account's state as read — the person, the newest row id (voided rows included, so a voided move frees the next
 * one) and the balance in cents — so both requests carry the same key and the unique index admits only the first
 * (qa-lead, 2026-11-12). No lock or RPC needed.
 */
export async function moveScoutAccountToTroopAction(input: { personId: number }): Promise<MoveResult> {
  const actor = await requireCapability('finance.manage');
  if (!Number.isSafeInteger(input?.personId) || input.personId <= 0) return { ok: false, error: 'Not a scout.' };
  const supabase = createAdminClient();

  const { data: scout, error: scoutErr } = await supabase
    .from('scouts')
    .select('person_id, active, is_webelos, inactive_reason')
    .eq('person_id', input.personId)
    .maybeSingle();
  if (scoutErr) return { ok: false, error: 'Couldn’t move the balance. Nothing was changed — try again.' };
  const s = scout as ScoutRow | null;
  const status = holderStatus({ isScout: s != null, active: s?.active ?? null, isWebelos: s?.is_webelos ?? null, inactiveReason: s?.inactive_reason ?? null });
  const rows = await fetchAllRows<{ id: number; amount: number; occurred_on: string; voided_at: string | null }>((from, to) =>
    supabase
      .from('financial_transactions')
      .select('id, amount, occurred_on, voided_at')
      .eq('account', 'scout_account')
      .eq('person_id', input.personId)
      .order('id')
      .range(from, to)
  );
  const { balance } = summarizeAccount(rows.map((r) => ({ amount: Number(r.amount), occurredOn: r.occurred_on, voidedAt: r.voided_at })));
  const refusal = canMoveToTroop({ status, wasScout: s != null, balance });
  if (refusal) return { ok: false, error: refusal };
  const amountCents = Math.round(balance * 100);
  const newestId = rows.reduce((m, r) => Math.max(m, r.id), 0);

  const { error } = await supabase.from('financial_transactions').insert({
    occurred_on: centralToday(),
    account: 'scout_account',
    person_id: input.personId,
    amount: -amountCents / 100,
    kind: 'transfer',
    method: null,
    memo: MOVE_TO_TROOP_MEMO,
    source: 'app',
    entered_by_person_id: actor.personId,
    idempotency_key: `move-to-troop:${input.personId}:${newestId}:${amountCents}`
  });
  if (error) {
    // The same move already landed (a concurrent or repeated request): the money is moved, once.
    if (error.code === '23505') return { ok: true, moved: amountCents / 100 };
    return { ok: false, error: 'Couldn’t move the balance. Nothing was changed — try again.' };
  }
  revalidatePath(PAGE);
  revalidatePath('/admin/finance');
  return { ok: true, moved: amountCents / 100 };
}
