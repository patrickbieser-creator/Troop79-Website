'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { recordAuditAs } from '@/lib/audit';
import { recordInviteFailure, respondToInvite, tooManyInviteFailures } from '@/lib/meeting-invites-db';

/**
 * Answers a meeting invite from its link (Plans/Matcher-Tune-Up.md T-5, qa-lead review 2026-10-20). POST only; it
 * answers that one invite and signs nobody in. Rate-limited per address; a failure is logged by IP and reason, never
 * with the token (M4, M5). Always lands back on the invite, which then says how it stands.
 */
export async function answerInviteAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '').trim().toLowerCase();
  const raw = formData.get('answer');
  const back = /^[0-9a-f]{64}$/.test(token) ? `/i/${token}` : '/member/meeting';
  // Only an explicit answer is ever recorded (qa-lead M7): anything else writes nothing.
  if (raw !== 'accept' && raw !== 'decline') redirect(back);
  const answer = raw;
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0].trim() || null;
  const sb = createAdminClient();

  if (await tooManyInviteFailures(sb, ip)) redirect(`${back}?err=busy`);

  const res = await respondToInvite(sb, token, answer);
  // The redirect lands on the same URL; without this the browser's router cache shows the question again after the
  // answer saved (seen in the 2026-10-20 browser check).
  revalidatePath('/i/[token]', 'page');
  if (!res.ok) {
    // Still open = the teaching sign-up itself refused (already teaching 2); nothing went wrong with the link.
    if (res.state === 'open') redirect(`${back}?err=${res.code ?? 'save'}`);
    // Only a link we don't recognise counts toward the address's limit: a re-tap on an answered, expired or voided
    // invite is a real person, and on shared Wi-Fi (church, a household) counting those would lock others out.
    if (res.state === 'unknown') await recordInviteFailure(sb, ip, res.state);
    redirect(back);
  }

  await recordAuditAs(
    sb,
    { personId: res.inviteeId, label: 'invite link' },
    {
      area: 'meeting',
      action: res.response === 'accepted' ? 'invite.accept' : 'invite.decline',
      entityType: 'meeting_invite',
      entityId: res.inviteId,
      summary: res.response === 'accepted' ? 'Said yes to a teaching invite' : 'Said not this week to a teaching invite'
    }
  );
  redirect(back);
}
