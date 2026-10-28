'use server';

/**
 * The published plan's family link (/i/plan/<token>; Plans/Meeting-Planner-III.md, Decision 5; qa-lead 2026-10-28):
 * one write for one scout. POST only; it signs nobody in. The claim (lib/plan-pages claimPlanPage) locks the link,
 * refuses anything but an open link, re-checks the recipient and the scope, and counts the write, before
 * lib/family-week writes as the recipient. Rate-limited per address like /i/<token>: only an UNKNOWN link counts.
 * Never logs the token.
 */
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { loadMeetingById } from '@/lib/meeting-board';
import { recordInviteFailure, tooManyInviteFailures } from '@/lib/meeting-invites-db';
import { familyWrite, type FamilyOp, type FamilyWrite } from '@/lib/family-week';
import { claimPlanPage } from '@/lib/plan-pages';

const CLOSED = 'This link has closed. Use the newest email from the troop, or sign in to the member page.';

export async function planPageWriteAction(input: { token: string; scoutId: number; op: FamilyOp }): Promise<FamilyWrite> {
  if (typeof input?.token !== 'string' || !Number.isInteger(input.scoutId) || !input.op) return { ok: false, error: 'Malformed request' };
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0].trim() || null;
  const sb = createAdminClient();
  if (await tooManyInviteFailures(sb, ip)) return { ok: false, error: 'Too many tries from here. Wait an hour and try again.' };
  const claim = await claimPlanPage(sb, input.token, input.scoutId);
  if (!claim.ok) {
    if (claim.state === 'unknown') await recordInviteFailure(sb, ip, 'unknown plan page');
    if (claim.state === 'limit') return { ok: false, error: 'That’s a lot of changes for one link. Sign in to the member page to keep going.' };
    if (claim.state === 'scope') return { ok: false, error: 'That scout isn’t on this link.' };
    return { ok: false, error: claim.state === 'error' ? 'That didn’t save. Try again.' : CLOSED };
  }
  const meeting = await loadMeetingById(sb, claim.entryId);
  if (!meeting) return { ok: false, error: CLOSED };
  const res = await familyWrite(sb, { meeting, actorPersonId: claim.recipientId, scoutPersonId: input.scoutId, catalog: await loadAdvancementCatalog() }, input.op);
  if (res.ok) {
    console.info(`plan page write: page ${claim.pageId}, person ${claim.recipientId}, scout ${input.scoutId}, meeting ${claim.entryId}, ${input.op.op}`);
    revalidatePath('/i/plan/[token]', 'page');
  }
  return res;
}
