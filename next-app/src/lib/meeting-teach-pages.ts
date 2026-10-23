/**
 * Build a Plan B10b (Plans/Build-A-Plan.md "B10 spec"): the teacher digest's ONE answer page, /i/teach/<token>.
 * Server only, service role. The SQL (20261220100000_teach_invite_pages.sql) holds the rules; this is its edge.
 *
 * The page token is a SCOPED capability like an /i/<token> invite link (qa-lead, 2026-10-20), never a sign-in:
 *   - only the peppered hash is stored (unique, lowercase hex); the raw token lives only in the email;
 *   - reading the page (inspectTeachPage) writes NOTHING, so a mail scanner's prefetch spends nothing;
 *   - a submit (answerTeachPage) is one transaction (meeting_answer_teach_page) that locks the page, refuses an
 *     unknown, superseded, expired or over-the-cap page, re-checks the recipient's session_epoch, and answers only
 *     invites on that page; a line nobody answered stays open; until the 6 PM expiry a Yes may become "Not this
 *     week" (it releases the teaching sign-up) and back (Patrick, 2026-10-22);
 *   - a resend mints a new page and supersedes the old one only after its email went out (supersedeOlderTeachPages);
 *     a failed email deletes the new page (deleteTeachPages) and the old one keeps working.
 * The page shows only the send's snapshot of each class (`lines`: short code, title, minutes, the scouts it would
 * help, test scouts already left out by scoutsHelped).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { hashSecret } from '@/lib/identity-challenge';
import type { ScoutsHelped } from '@/lib/meeting-invite-digest';

/** Submits one page takes (re-answering is allowed until the expiry, so more than an invite's single use). */
export const TEACH_PAGE_SUBMIT_CAP = 10;

/** One class as the send snapshotted it, keyed by topic key in the page's `lines`. */
export interface TeachLineSnapshot {
  /** 'Tenderfoot 3a' (the page shows it short: 'Ten 3a'). */
  code: string;
  topic: string;
  minutes: number | null;
  helped: ScoutsHelped;
}

export type TeachPageState = 'open' | 'expired' | 'superseded' | 'void' | 'unknown';

export interface TeachPageLine extends TeachLineSnapshot {
  inviteId: number;
  key: string;
  /** The current answer; null = not answered yet. */
  answer: 'yes' | 'no' | null;
  /** False: voided, or no longer this page's to answer ("No longer available"). */
  available: boolean;
}

export interface TeachPageView {
  recipientName: string;
  meetingDate: string;
  lines: TeachPageLine[];
}

const TOKEN = /^[0-9a-f]{64}$/i;

interface PageRow {
  id: number;
  calendar_entry_id: number;
  recipient_person_id: number;
  recipient_epoch: number;
  expires_at: string;
  superseded_at: string | null;
  lines: Record<string, TeachLineSnapshot>;
}

const EMPTY_HELPED: ScoutsHelped = { count: 0, names: [], more: 0 };

/** Read-only: what a page link shows, for the GET. Writes NOTHING. */
export async function inspectTeachPage(sb: SupabaseClient, token: string, now: Date = new Date()): Promise<{ state: TeachPageState; page: TeachPageView | null }> {
  if (!TOKEN.test(token)) return { state: 'unknown', page: null };
  const { data } = await sb
    .from('meeting_invite_pages')
    .select('id, calendar_entry_id, recipient_person_id, recipient_epoch, expires_at, superseded_at, lines')
    .eq('token_hash', await hashSecret(token.toLowerCase()))
    .maybeSingle();
  const page = data as PageRow | null;
  if (!page) return { state: 'unknown', page: null };
  const [{ data: person }, { data: entry }, { data: rows }] = await Promise.all([
    sb.from('people').select('display_name, active, session_epoch').eq('id', page.recipient_person_id).maybeSingle(),
    sb.from('calendar_entries').select('entry_date').eq('id', page.calendar_entry_id).maybeSingle(),
    sb.from('meeting_invites').select('id, topic_key, consumed_at, response').eq('page_id', page.id).eq('kind', 'teach').order('id')
  ]);
  const who = person as { display_name: string; active: boolean; session_epoch: number } | null;
  const stale = !who || !who.active || who.session_epoch !== page.recipient_epoch;
  const lines: TeachPageLine[] = ((rows ?? []) as { id: number; topic_key: string; consumed_at: string | null; response: string | null }[]).map((r) => {
    const snap = page.lines?.[r.topic_key];
    const answered = r.response === 'accepted' || r.response === 'declined';
    return {
      inviteId: r.id,
      key: r.topic_key,
      code: snap?.code ?? '',
      topic: snap?.topic ?? r.topic_key,
      minutes: snap?.minutes ?? null,
      helped: snap?.helped ?? EMPTY_HELPED,
      answer: r.response === 'accepted' ? 'yes' : r.response === 'declined' ? 'no' : null,
      available: !stale && (answered || (r.consumed_at == null && r.response == null))
    };
  });
  const state: TeachPageState = page.superseded_at ? 'superseded' : new Date(page.expires_at) <= now ? 'expired' : stale ? 'void' : 'open';
  return { state, page: { recipientName: who?.display_name ?? '', meetingDate: (entry as { entry_date: string } | null)?.entry_date ?? '', lines } };
}

export interface TeachAnswer {
  inviteId: number;
  answer: 'yes' | 'no';
}

export interface TeachAnswerLine {
  inviteId: number;
  key: string | null;
  /** yes / no = changed to that; unchanged; gone / void = not this page's to answer; error = the teach rules refused. */
  result: 'yes' | 'no' | 'unchanged' | 'gone' | 'void' | 'error';
  error: string | null;
  /** The answer before this submit. */
  was: string | null;
}

export type TeachAnswerResult =
  | { ok: true; pageId: number; entryId: number; recipientId: number; lines: TeachAnswerLine[] }
  | { ok: false; state: 'unknown' | 'expired' | 'superseded' | 'void' | 'busy' | 'save' };

/** The teach RPCs' messages that are written for people (meeting-board-supply's KNOWN); anything else stays private. */
const TEACH_RPC_KNOWN = /^(That person can’t teach|Teaching is for|There’s no teaching|That meeting|That isn’t something|Junior Leaders can’t)/;

/** Submits a page's answers. One transaction; see the module header for what is checked. */
export async function answerTeachPage(sb: SupabaseClient, token: string, answers: readonly TeachAnswer[]): Promise<TeachAnswerResult> {
  if (!TOKEN.test(token)) return { ok: false, state: 'unknown' };
  const clean = answers.filter((a) => Number.isInteger(a.inviteId) && a.inviteId > 0 && (a.answer === 'yes' || a.answer === 'no')).slice(0, 50);
  const { data, error } = await sb.rpc('meeting_answer_teach_page', {
    p_token_hash: await hashSecret(token.toLowerCase()),
    p_answers: clean.map((a) => ({ invite_id: a.inviteId, answer: a.answer }))
  });
  if (error) return { ok: false, state: 'save' };
  const res = data as {
    state: 'answered' | 'unknown' | 'expired' | 'superseded' | 'void' | 'busy';
    page_id?: number;
    entry?: number;
    recipient?: number;
    lines?: { invite_id: number; topic_key: string | null; result: TeachAnswerLine['result']; error: string | null; was: string | null }[];
  };
  if (res.state !== 'answered') return { ok: false, state: res.state };
  return {
    ok: true,
    pageId: res.page_id!,
    entryId: res.entry!,
    recipientId: res.recipient!,
    lines: (res.lines ?? []).map((l) => ({
      inviteId: l.invite_id,
      key: l.topic_key,
      result: l.result,
      error: l.error == null ? null : TEACH_RPC_KNOWN.test(l.error) ? l.error : 'That didn’t save. Please try again.',
      was: l.was
    }))
  };
}

export interface MintedTeachPage {
  pageId: number;
  /** For the email only; never stored or logged. */
  token: string;
  invites: { inviteId: number; key: string }[];
}

/**
 * Mints one recipient's page and their teach rows on it (meeting_mint_teach_page: one transaction, the per-meeting
 * lock and 24-hour dedupe meeting_mint_invites uses). Null when every row was a duplicate (no page is left behind).
 */
export async function mintTeachPage(
  sb: SupabaseClient,
  input: {
    entryId: number;
    since: string;
    recipientId: number;
    epoch: number;
    expiresAt: string;
    sentTo: string;
    sentBy: number | null;
    lines: Record<string, TeachLineSnapshot>;
    keys: readonly string[];
  },
  randomToken: () => string
): Promise<MintedTeachPage | null> {
  const token = randomToken();
  const { data, error } = await sb.rpc('meeting_mint_teach_page', {
    p_entry: input.entryId,
    p_since: input.since,
    p_recipient: input.recipientId,
    p_recipient_epoch: input.epoch,
    p_token_hash: await hashSecret(token),
    p_expires_at: input.expiresAt,
    p_lines: Object.fromEntries(input.keys.filter((k) => input.lines[k]).map((k) => [k, input.lines[k]])),
    p_rows: input.keys.map((k) => ({ topic_key: k, sent_to: input.sentTo, invitee_epoch: input.epoch, sent_by: input.sentBy }))
  });
  if (error) throw new Error(error.message);
  const res = data as { page_id: number | null; invites: { invite_id: number; topic_key: string }[] };
  if (res.page_id == null) return null;
  return { pageId: res.page_id, token, invites: res.invites.map((i) => ({ inviteId: i.invite_id, key: i.topic_key })) };
}

/** After the new page's email went out: the recipient's older live pages for that meeting are superseded into it. */
export async function supersedeOlderTeachPages(sb: SupabaseClient, pageId: number): Promise<boolean> {
  const { error } = await sb.rpc('meeting_supersede_teach_pages', { p_page: pageId });
  return !error;
}

/** Undo pages whose email never went out (their teach rows go with them). True when they are gone. */
export async function deleteTeachPages(sb: SupabaseClient, pageIds: readonly number[]): Promise<boolean> {
  if (!pageIds.length) return true;
  const { error } = await sb.from('meeting_invite_pages').delete().in('id', [...pageIds]);
  return !error;
}
