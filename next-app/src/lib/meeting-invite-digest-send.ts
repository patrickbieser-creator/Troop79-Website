/**
 * Build a Plan B3 (Plans/Build-A-Plan.md Decision 2): sending invites as ONE digest email per recipient. Server-only.
 * The CALLER decides who may send (an adult holding meeting_planner.edit) and which teachers qualify; who may be
 * invited at all is re-decided in createInviteDigest.
 *
 * Each recipient's email lists every invite for them (teach asks, then each scout's offers), each with its own /i/<token>
 * link answering exactly one invite (the P1/P2 capability, unchanged). Send safety follows the reminder sender (P5b,
 * qa-lead 2026-10-22): emails go out REMINDER_BATCH at a time, each with a REMINDER_EMAIL_TIMEOUT_MS timeout; a
 * recipient's rows are deleted the moment their email fails, throws or times out; no new batch starts after
 * REMINDER_TIME_BUDGET_MS (the rest are deleted and reported); and a final sweep deletes anything still unsent.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdvancementCatalog } from '@/lib/advancement-catalog';
import { recordAudit } from '@/lib/audit';
import { renderMarkdownEmail } from '@/lib/email-markdown';
import { fmtDateFull } from '@/lib/format-date';
import { minutesText } from '@/lib/meeting-board-picklist';
import { DEFAULT_INVITE_DIGEST, INVITE_DIGEST_KIND, renderInviteDigest, type InviteTemplate } from '@/lib/meeting-invite-email';
import { INVITE_SENDER_NAME } from '@/lib/meeting-invites';
import { deleteInvites } from '@/lib/meeting-invites-db';
import { EMAIL_TIMED_OUT, inviteWords, REMINDER_BATCH, REMINDER_EMAIL_TIMEOUT_MS, REMINDER_TIME_BUDGET_MS, sendEmailWithin } from '@/lib/meeting-invites-send';
import { createInviteDigest, type DigestInput, type DigestRecipient } from '@/lib/meeting-invite-digest-db';
import { digestPeople } from '@/lib/meeting-invite-digest';
import { siteUrl } from '@/lib/site-url';

export type SendDigestResult = { ok: true; sent: string[]; emails: number; skipped: { name: string; reason: string }[] } | { ok: false; error: string };

export async function sendInviteDigests(
  sb: SupabaseClient,
  input: DigestInput,
  deps: { clock?: () => number; now?: Date; loadCatalog?: () => Promise<AdvancementCatalog> } = {}
): Promise<SendDigestResult> {
  if (!input || !Number.isInteger(input.entryId) || !Array.isArray(input.teach) || !Array.isArray(input.pick)) return { ok: false, error: 'Malformed request' };
  const ok = (x: { key: unknown }) => typeof x?.key === 'string';
  if (!input.teach.every((t) => ok(t) && Array.isArray(t.personIds)) || !input.pick.every((p) => ok(p) && Array.isArray(p.scoutIds))) return { ok: false, error: 'Malformed request' };
  const clock = deps.clock ?? Date.now;
  const started = clock();

  // The words first: an offering that can't be named isn't minted at all.
  const keys = [...new Set([...input.teach, ...input.pick].map((x) => x.key))];
  const words = new Map(await Promise.all(keys.map(async (k) => [k, await inviteWords(sb, input.entryId, k)] as const)));
  const unnamed = keys.filter((k) => !words.get(k));
  if (unnamed.length === keys.length) return { ok: false, error: 'Those can’t be invited for yet.' };
  const named = (k: string) => !unnamed.includes(k);
  const made = await createInviteDigest(sb, { ...input, teach: input.teach.filter((t) => named(t.key)), pick: input.pick.filter((p) => named(p.key)) }, deps);
  if (!made.ok) return made;

  const code = (k: string) => words.get(k)?.codeLabel ?? k;
  const skipped = made.skipped.map((s) => ({ name: s.name, reason: `${s.reason} (${code(s.key)})` }));
  for (const k of unnamed) skipped.push({ name: k, reason: 'can’t be invited for yet' });
  const sent = new Set<string>();
  const unsent = new Set(made.recipients.flatMap((r) => r.invites.map((i) => i.inviteId)));
  let emails = 0;

  try {
    const { data: entry } = await sb.from('calendar_entries').select('entry_date').eq('id', input.entryId).single();
    const { data: saved } = await sb.from('email_templates').select('subject, body').eq('kind', INVITE_DIGEST_KIND).is('retired_at', null).order('updated_at', { ascending: false }).limit(1).maybeSingle();
    const template = (saved as InviteTemplate | null) ?? DEFAULT_INVITE_DIGEST;
    const { data: names } = await sb.from('people').select('id, nickname, first_name, display_name').in('id', made.recipients.map((r) => r.recipientId));
    const firstName = new Map(
      ((names ?? []) as { id: number; nickname: string | null; first_name: string | null; display_name: string }[]).map((p) => [p.id, p.nickname || p.first_name || p.display_name])
    );
    const day = entry ? fmtDateFull((entry as { entry_date: string }).entry_date) : 'Sunday';

    /** One recipient: sent, or their rows are gone (or back in the final sweep) before this returns. Never throws. */
    const sendOne = async (r: DigestRecipient): Promise<void> => {
      let reason = 'the email didn’t go out';
      try {
        // Who it's about: the scouts it offers to, and the recipient themself when it asks them to teach.
        const about = [
          ...r.invites.filter((i) => i.kind === 'pick').map((i) => ({ personId: i.inviteeId, name: i.inviteeName })),
          ...(r.invites.some((i) => i.kind === 'teach') ? [{ personId: r.recipientId, name: '' }] : [])
        ];
        const items = r.invites.map((i) => {
          const w = words.get(i.key)!;
          return {
            kind: i.kind,
            inviteeName: i.inviteeName,
            aboutRecipient: i.kind === 'teach' || r.isScout,
            code: w.codeLabel,
            topic: w.label,
            minutes: i.kind === 'teach' ? minutesText(w.minutes) : '',
            url: `${siteUrl()}/i/${i.token}`
          };
        });
        const { subject, md } = renderInviteDigest(template, { name: firstName.get(r.recipientId) ?? r.name, people: digestPeople(r.recipientId, r.isScout, about), day }, items);
        const { html, text } = renderMarkdownEmail({ md });
        const res = await sendEmailWithin(REMINDER_EMAIL_TIMEOUT_MS, { to: [r.sentTo], subject, html, text, confirm: true, fromName: INVITE_SENDER_NAME });
        if (res !== EMAIL_TIMED_OUT && res.status === 'sent') {
          emails++;
          for (const i of r.invites) {
            unsent.delete(i.inviteId);
            sent.add(i.inviteeName);
          }
          return;
        }
        if (res !== EMAIL_TIMED_OUT && res.status === 'skipped') reason = 'email isn’t set up on this server';
      } catch {
        // Reported and deleted below, like any email that didn't go out.
      }
      skipped.push({ name: r.name, reason });
      const gone = r.invites.map((i) => i.inviteId);
      for (const id of gone) unsent.delete(id);
      if (!(await deleteInvites(sb, gone).catch(() => false))) for (const id of gone) unsent.add(id); // the final sweep tries again
    };

    for (let i = 0; i < made.recipients.length; i += REMINDER_BATCH) {
      if (clock() - started > REMINDER_TIME_BUDGET_MS) {
        for (const r of made.recipients.slice(i)) skipped.push({ name: r.name, reason: 'out of time on this send; send again' });
        break;
      }
      await Promise.all(made.recipients.slice(i, i + REMINDER_BATCH).map(sendOne));
    }
  } finally {
    // Whoever wasn't reached keeps no invite row (and no live link nobody has).
    await deleteInvites(sb, [...unsent]);
  }
  if (emails) {
    await recordAudit({
      area: 'meeting',
      action: 'invite.digest',
      entityType: 'calendar_entry',
      entityId: input.entryId,
      summary: `Invited ${[...sent].join(', ')} (${emails} emails)`
    });
  }
  return { ok: true, sent: [...sent], emails, skipped };
}
