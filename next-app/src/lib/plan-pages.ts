/**
 * Meeting Planner III, the published email's family link, /i/plan/<token> (Plans/Meeting-Planner-III.md, Decision 5;
 * qa-lead 2026-10-28). Server-only, service role. A SCOPED capability, never a sign-in:
 *   - 32 random bytes as 64 hex; only the peppered hash is stored; the raw token lives only in the email;
 *   - scope: the recipient's own scouts (fixed at mint), one meeting, intent + picks only; and, on a link minted
 *     as_teacher (F5), the recipient's own teacher card on that meeting (claimPlanPageTeacher). A teacher link may
 *     carry no scouts (an adult's Coming? reminder);
 *   - expires 6 PM Central on the meeting day; a republish supersedes the recipient's older links once the new email
 *     has gone out; a planner may revoke every link of a meeting;
 *   - reading (inspectPlanPage) writes NOTHING, so a mail scanner's prefetch spends nothing; each write goes through
 *     meeting_plan_page_claim, which locks the page, refuses anything not open, re-checks the recipient's
 *     session_epoch and scope, and counts the write (at most 200);
 *   - unknown, expired, superseded and revoked links all read the same to a stranger: "closed".
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { hashSecret } from '@/lib/identity-challenge';

const TOKEN = /^[0-9a-f]{64}$/;

export function randomPlanToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export type PlanPageState = 'open' | 'closed';

export interface PlanPage {
  id: number;
  entryId: number;
  recipientId: number;
  recipientName: string;
  scoutIds: number[];
  /** The link also carries the recipient's own teacher card (F5). */
  asTeacher: boolean;
  /** Expired, superseded and revoked pages say why to the one who has the link (the scope is never shown). */
  reason: 'open' | 'expired' | 'superseded' | 'revoked';
}

type Row = {
  id: number;
  calendar_entry_id: number;
  recipient_person_id: number;
  recipient_epoch: number;
  scout_person_ids: number[];
  as_teacher: boolean;
  expires_at: string;
  superseded_at: string | null;
  revoked_at: string | null;
};

/** Read-only: the link as it stands. Writes nothing. A token that isn't ours, or a stale recipient, is 'closed' with no page. */
export async function inspectPlanPage(sb: SupabaseClient, token: string, now: Date = new Date()): Promise<{ state: PlanPageState; page: PlanPage | null }> {
  const t = token.toLowerCase();
  if (!TOKEN.test(t)) return { state: 'closed', page: null };
  const { data } = await sb
    .from('meeting_plan_pages')
    .select('id, calendar_entry_id, recipient_person_id, recipient_epoch, scout_person_ids, as_teacher, expires_at, superseded_at, revoked_at')
    .eq('token_hash', await hashSecret(t))
    .maybeSingle();
  const r = data as Row | null;
  if (!r) return { state: 'closed', page: null };
  const { data: who } = await sb.from('people').select('display_name, active, session_epoch').eq('id', r.recipient_person_id).maybeSingle();
  const person = who as { display_name: string; active: boolean; session_epoch: number } | null;
  if (!person || !person.active || person.session_epoch !== r.recipient_epoch) return { state: 'closed', page: null };
  const reason: PlanPage['reason'] = r.revoked_at ? 'revoked' : r.superseded_at ? 'superseded' : new Date(r.expires_at) <= now ? 'expired' : 'open';
  return {
    state: reason === 'open' ? 'open' : 'closed',
    page: { id: r.id, entryId: r.calendar_entry_id, recipientId: r.recipient_person_id, recipientName: person.display_name, scoutIds: r.scout_person_ids.map(Number), asTeacher: r.as_teacher, reason }
  };
}

export type ClaimResult = { ok: true; pageId: number; entryId: number; recipientId: number } | { ok: false; state: 'unknown' | 'closed' | 'expired' | 'scope' | 'limit' | 'error' };

/** One write on a link, for one scout: the claim (lock, state, epoch, scope, count) in one transaction. */
export async function claimPlanPage(sb: SupabaseClient, token: string, scoutPersonId: number): Promise<ClaimResult> {
  const t = token.toLowerCase();
  if (!TOKEN.test(t)) return { ok: false, state: 'unknown' };
  return claimed(await sb.rpc('meeting_plan_page_claim', { p_token_hash: await hashSecret(t), p_scout: scoutPersonId }));
}

/**
 * One teacher write on a link (F5): the recipient answering for themself. Same claim (lock, state, epoch, the shared
 * 200-write count); 'scope' unless the link was minted as_teacher. Who is written for comes only from the result.
 */
export async function claimPlanPageTeacher(sb: SupabaseClient, token: string): Promise<ClaimResult> {
  const t = token.toLowerCase();
  if (!TOKEN.test(t)) return { ok: false, state: 'unknown' };
  return claimed(await sb.rpc('meeting_plan_page_claim_teacher', { p_token_hash: await hashSecret(t) }));
}

function claimed({ data, error }: { data: unknown; error: { message: string } | null }): ClaimResult {
  if (error) {
    const m = error.message;
    const state = (['unknown', 'closed', 'expired', 'scope', 'limit'] as const).find((s) => m.includes(s)) ?? 'error';
    return { ok: false, state };
  }
  const row = ((data ?? []) as { page_id: number; calendar_entry_id: number; recipient_person_id: number }[])[0];
  return row ? { ok: true, pageId: row.page_id, entryId: row.calendar_entry_id, recipientId: row.recipient_person_id } : { ok: false, state: 'error' };
}

/** A new link for one recipient. Returns the raw token (for the email only). */
export async function mintPlanPage(
  sb: SupabaseClient,
  input: { entryId: number; recipientId: number; epoch: number; scoutIds: readonly number[]; expiresAt: string; asTeacher?: boolean }
): Promise<{ id: number; token: string }> {
  const token = randomPlanToken();
  const { data, error } = await sb
    .from('meeting_plan_pages')
    .insert({
      calendar_entry_id: input.entryId,
      recipient_person_id: input.recipientId,
      recipient_epoch: input.epoch,
      token_hash: await hashSecret(token),
      scout_person_ids: [...new Set(input.scoutIds)],
      as_teacher: input.asTeacher ?? false,
      expires_at: input.expiresAt
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return { id: (data as { id: number }).id, token };
}

/** After the new link's email went out: the recipient's older open links for that meeting point at it. */
export async function supersedeOlderPlanPages(sb: SupabaseClient, page: { id: number; entryId: number; recipientId: number }): Promise<void> {
  const { error } = await sb
    .from('meeting_plan_pages')
    .update({ superseded_at: new Date().toISOString() })
    .eq('calendar_entry_id', page.entryId)
    .eq('recipient_person_id', page.recipientId)
    .lt('id', page.id)
    .is('superseded_at', null);
  if (error) throw new Error(error.message);
}

/** A link whose email didn't go out never existed. */
export async function deletePlanPage(sb: SupabaseClient, id: number): Promise<void> {
  await sb.from('meeting_plan_pages').delete().eq('id', id);
}

/** A planner cancels a publish: every open link of the meeting closes. */
export async function revokePlanPages(sb: SupabaseClient, entryId: number): Promise<number> {
  const { data, error } = await sb.from('meeting_plan_pages').update({ revoked_at: new Date().toISOString() }).eq('calendar_entry_id', entryId).is('revoked_at', null).select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}
