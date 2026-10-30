'use server';

/**
 * The published plan's family link (/i/plan/<token>; Plans/Meeting-Planner-III.md, Decision 5; qa-lead 2026-10-28):
 * one write for one scout. POST only; it signs nobody in. The claim (lib/plan-pages claimPlanPage) locks the link,
 * refuses anything but an open link, re-checks the recipient and the scope, and counts the write, before
 * lib/family-week writes as the recipient. Rate-limited per address like /i/<token>: only an UNKNOWN link counts.
 * Never logs the token.
 *
 * planPageTeachAction (F5): on a link minted as_teacher, the recipient's own teacher card, through the same core as
 * /member/meeting (lib/teach-write). Who is written for and which meeting come only from the claim; an offer is for
 * this meeting only.
 */
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { recordInviteFailure, tooManyInviteFailures } from '@/lib/meeting-invites-db';
import { familyWrite, loadOpenMeeting, type FamilyOp, type FamilyWrite } from '@/lib/family-week';
import { claimPlanPage, claimPlanPageTeacher, type ClaimResult } from '@/lib/plan-pages';
import { teachFail, teachWrite, type TeachActionResult, type TeachOp } from '@/lib/teach-write';

const CLOSED = 'This link has closed. Use the newest email from the troop, or sign in to the member page.';

export async function planPageWriteAction(input: { token: string; scoutId: number; op: FamilyOp }): Promise<FamilyWrite> {
  if (typeof input?.token !== 'string' || !Number.isInteger(input.scoutId) || !input.op) return { ok: false, error: 'Malformed request' };
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0].trim() || null;
  const sb = createAdminClient();
  if (await tooManyInviteFailures(sb, ip)) return { ok: false, error: 'Too many tries from here. Wait an hour and try again.' };
  const claim = await claimPlanPage(sb, input.token, input.scoutId);
  if (!claim.ok) return { ok: false, error: await refused(sb, ip, claim, 'That scout isn’t on this link.') };
  const meeting = await loadOpenMeeting(sb, claim.entryId);
  if (!meeting) return { ok: false, error: CLOSED };
  const res = await familyWrite(sb, { meeting, actorPersonId: claim.recipientId, scoutPersonId: input.scoutId, catalog: await loadAdvancementCatalog() }, input.op);
  if (res.ok) {
    console.info(`plan page write: page ${claim.pageId}, person ${claim.recipientId}, scout ${input.scoutId}, meeting ${claim.entryId}, ${input.op.op}`);
    revalidatePath('/i/plan/[token]', 'page');
  }
  return res;
}

/** A refused claim, in words; only an UNKNOWN link counts toward the address's rate limit. */
async function refused(sb: ReturnType<typeof createAdminClient>, ip: string | null, claim: Extract<ClaimResult, { ok: false }>, scope: string): Promise<string> {
  if (claim.state === 'unknown') await recordInviteFailure(sb, ip, 'unknown plan page');
  if (claim.state === 'limit') return 'That’s a lot of changes for one link. Sign in to the member page to keep going.';
  if (claim.state === 'scope') return scope;
  return claim.state === 'error' ? 'That didn’t save. Try again.' : CLOSED;
}

const TEACH_OPS = new Set<TeachOp['op']>(['teach', 'unteach', 'withdraw', 'intent', 'offer', 'clear', 'note']);

/** One teacher write on the link, as its recipient, on its meeting (F5). */
export async function planPageTeachAction(input: { token: string; op: TeachOp }): Promise<TeachActionResult> {
  if (typeof input?.token !== 'string' || !input.op || typeof input.op !== 'object' || !TEACH_OPS.has(input.op.op)) return teachFail('Malformed request');
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0].trim() || null;
  const sb = createAdminClient();
  if (await tooManyInviteFailures(sb, ip)) return teachFail('Too many tries from here. Wait an hour and try again.');
  const claim = await claimPlanPageTeacher(sb, input.token);
  if (!claim.ok) return teachFail(await refused(sb, ip, claim, 'This link is for answering for your scouts. Sign in to the member page to teach.'));
  const op = input.op;
  // An offer from the link is for this Sunday only (F5).
  if (op.op === 'offer' && (!Array.isArray(op.entryIds) || op.entryIds.some((id) => id !== claim.entryId))) {
    return teachFail('From this link you can offer for this Sunday only. Sign in to the member page for other dates.', 'dates');
  }
  const meeting = await loadOpenMeeting(sb, claim.entryId);
  if (!meeting) return teachFail(CLOSED);
  const res = await teachWrite(
    { sb, meeting, catalog: await loadAdvancementCatalog(), personId: claim.recipientId, actorPersonId: claim.recipientId, leader: false, who: 'You' },
    op
  );
  if (res.ok) {
    console.info(`plan page teach write: page ${claim.pageId}, person ${claim.recipientId}, meeting ${claim.entryId}, ${op.op}`);
    revalidatePath('/i/plan/[token]', 'page');
  }
  return res;
}
