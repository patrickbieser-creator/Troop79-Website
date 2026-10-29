'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { recordAuditAs } from '@/lib/audit';
import { inviteAnswerAudit } from '@/lib/meeting-invite-audit';
import { recordInviteFailure, tooManyInviteFailures } from '@/lib/meeting-invites-db';
import { answerTeachPage, saveDeclineNotes, type TeachAnswer } from '@/lib/meeting-teach-pages';
import { boardName } from '@/lib/meeting-board-shared';
import {
  addInterestsFromPage,
  cleanPicks,
  describeInterests,
  interestShort,
  INTEREST_SEARCH_MAX,
  searchInterestsFromPage,
  type InterestHit
} from '@/lib/teaching-interests';

/**
 * Build a Plan B10b: submits a teacher's answer page (/i/teach/<token>). POST only; it answers the invites on that one
 * page and signs nobody in. Only explicit answers are sent (a class left blank stays open). Rate-limited per address
 * like /i/<token>: only an UNKNOWN token counts toward the limit (a re-submit on an expired or replaced page is a real
 * person). Never logs the token. Always lands back on the page, which then says how it stands.
 */
export async function answerTeachPageAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '').trim().toLowerCase();
  const back = /^[0-9a-f]{64}$/.test(token) ? `/i/teach/${token}` : '/member/meeting';
  const answers: TeachAnswer[] = [];
  for (const [name, value] of formData.entries()) {
    const m = /^line-(\d{1,12})$/.exec(name);
    if (m && (value === 'yes' || value === 'no')) answers.push({ inviteId: Number(m[1]), answer: value });
  }
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0].trim() || null;
  const sb = createAdminClient();

  if (await tooManyInviteFailures(sb, ip)) redirect(`${back}?err=busy`);

  const notes: { inviteId: number; note: string }[] = [];
  for (const [name, value] of formData.entries()) {
    const m = /^note-(\d{1,12})$/.exec(name);
    if (m && typeof value === 'string' && answers.some((a) => a.inviteId === Number(m[1]) && a.answer === 'no')) notes.push({ inviteId: Number(m[1]), note: value });
  }

  const res = await answerTeachPage(sb, token, answers);
  if (res.ok && !(await saveDeclineNotes(sb, res.pageId, notes))) console.error(`teach page ${res.pageId}: a Not this week note didn’t save`);
  // The redirect lands on the same URL; without this the router cache shows the old answers.
  revalidatePath('/i/teach/[token]', 'page');
  if (!res.ok) {
    if (res.state === 'unknown') {
      await recordInviteFailure(sb, ip, 'unknown teach page');
      redirect(back);
    }
    if (res.state === 'busy' || res.state === 'save') redirect(`${back}?err=${res.state === 'busy' ? 'limit' : 'save'}`);
    redirect(back);
  }

  // One audit row per class whose answer changed: "Patrick B said yes to teaching Ten 3a · Square Knot (Oct 25)".
  for (const line of res.lines) {
    if (line.result !== 'yes' && line.result !== 'no') continue;
    try {
      const audit = await inviteAnswerAudit(sb, {
        ok: true,
        kind: 'teach',
        response: line.result === 'yes' ? 'accepted' : 'declined',
        inviteId: line.inviteId,
        inviteeId: res.recipientId,
        recipientId: res.recipientId
      });
      await recordAuditAs(sb, audit.actor, audit.entry);
    } catch (e) {
      console.error('teach page audit failed:', e);
    }
  }
  const failed = res.lines.filter((l) => l.result === 'error').map((l) => l.inviteId);
  redirect(failed.length ? `${back}?failed=${failed.join('.')}` : `${back}?saved=1`);
}

// ── B10c: "What else would you enjoy teaching, now or in the future?" ─────────────────────────────────────────────

export type TeachInterestSearchResult = { ok: true; rows: InterestHit[] } | { ok: false; error: string };

const SEARCH_SAYS: Record<string, string> = {
  limit: 'That’s a lot of searches for one page. To add more, sign in to What I can teach.',
  expired: 'This page has closed.',
  superseded: 'A newer email replaced this page.',
  void: 'This link doesn’t work any more.',
  unknown: 'This link doesn’t work any more.',
  error: 'The search didn’t work. Try again.'
};

/** The page's own search (token-scoped, counted against the page's 60). Only an unknown token counts toward the IP limit. */
export async function searchTeachInterestsAction(token: unknown, q: unknown): Promise<TeachInterestSearchResult> {
  if (typeof token !== 'string' || typeof q !== 'string') return { ok: false, error: SEARCH_SAYS.error };
  const text = q.trim().slice(0, INTEREST_SEARCH_MAX);
  if (!text) return { ok: true, rows: [] };
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0].trim() || null;
  const sb = createAdminClient();
  if (await tooManyInviteFailures(sb, ip)) return { ok: false, error: 'Too many tries from here. Please try again in an hour.' };
  const res = await searchInterestsFromPage(sb, token.trim().toLowerCase(), text);
  if (res.ok) return res;
  if (res.state === 'unknown') await recordInviteFailure(sb, ip, 'unknown teach page');
  return { ok: false, error: SEARCH_SAYS[res.state] ?? SEARCH_SAYS.error };
}

export type TeachInterestSaveResult = { ok: true; saved: number; now: { key: string; ok: boolean; error: string | null }[] } | { ok: false; error: string };

const SAVE_SAYS: Record<string, string> = {
  busy: 'This page has been saved many times already. To add more, sign in to What I can teach.',
  expired: 'This page has closed.',
  superseded: 'A newer email replaced this page.',
  void: 'This link doesn’t work any more.',
  unknown: 'This link doesn’t work any more.',
  save: 'That didn’t save. Please try again.'
};

/**
 * "Save interests": separate from the answers' Submit (the answers form is dirty-gated per class and may have no open
 * class left; a refused interest must not block an answer, nor the reverse). One submit budget with the answers.
 * Audited as the page's adult, by name: "<name> (teach page)".
 */
export async function saveTeachInterestsAction(token: unknown, picks: unknown, nowKeys: unknown): Promise<TeachInterestSaveResult> {
  const clean = cleanPicks(picks);
  if (typeof token !== 'string' || !clean || !Array.isArray(nowKeys) || !nowKeys.every((k) => typeof k === 'string')) return { ok: false, error: SAVE_SAYS.save };
  if (!clean.length) return { ok: false, error: 'Pick something first.' };
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0].trim() || null;
  const sb = createAdminClient();
  if (await tooManyInviteFailures(sb, ip)) return { ok: false, error: 'Too many tries from here. Please try again in an hour.' };
  const res = await addInterestsFromPage(sb, token.trim().toLowerCase(), clean, nowKeys as string[]);
  if (!res.ok) {
    if (res.state === 'unknown') await recordInviteFailure(sb, ip, 'unknown teach page');
    return { ok: false, error: res.state === 'refused' ? (res.error ?? SAVE_SAYS.save) : (SAVE_SAYS[res.state] ?? SAVE_SAYS.save) };
  }
  try {
    const { data: who } = await sb.from('people').select('display_name').eq('id', res.recipientId).maybeSingle();
    const name = (who as { display_name: string } | null)?.display_name ?? 'Someone';
    const actor = { personId: res.recipientId, label: `${name} (teach page)` };
    const words = await describeInterests(sb, clean.map((p) => p.key));
    const short = (k: string) => {
      const w = words.get(k);
      return w ? interestShort(w) : k;
    };
    await recordAuditAs(sb, actor, {
      area: 'meeting',
      action: 'interest.add',
      entityType: 'person',
      entityId: res.recipientId,
      summary: `${boardName(name) || 'Someone'} would enjoy teaching ${clean.map((p) => short(p.key)).join(', ')}`
    });
    const offered = res.now.filter((n) => n.ok).map((n) => short(n.key));
    if (offered.length) {
      await recordAuditAs(sb, actor, {
        area: 'meeting',
        action: 'interest.teach_now',
        entityType: 'calendar_entry',
        entityId: res.entryId,
        summary: `${boardName(name) || 'Someone'} offered to teach ${offered.join(', ')} this Sunday`
      });
    }
  } catch (e) {
    console.error('teach interest audit failed:', e);
  }
  revalidatePath('/i/teach/[token]', 'page');
  return { ok: true, saved: clean.length, now: res.now };
}
