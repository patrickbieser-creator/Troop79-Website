'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { recordAuditAs } from '@/lib/audit';
import { inviteAnswerAudit } from '@/lib/meeting-invite-audit';
import { recordInviteFailure, tooManyInviteFailures } from '@/lib/meeting-invites-db';
import { answerTeachPage, type TeachAnswer } from '@/lib/meeting-teach-pages';

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

  const res = await answerTeachPage(sb, token, answers);
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
