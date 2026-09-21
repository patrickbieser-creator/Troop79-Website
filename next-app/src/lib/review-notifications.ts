/**
 * Telling a submitter what became of what they sent in.
 *
 * Patrick, 2026-09-20: "When an update submitted through the website has
 * been approved, send a notice to the person submitting the update to
 * indicate the success of their submission along with a confirmation of what
 * was submitted, because they might not remember." Returned and rejected
 * outcomes are in scope too — a submission sent back for more is the case
 * where silence does the most damage.
 *
 * WHY THIS IS ALLOWED TO SEND. lib/email.ts's rule is "NOTHING sends
 * automatically. Every send is triggered explicitly by a leader." A leader
 * clicking Approve, Return or Reject IS that trigger, and this satisfies the
 * same test the sign-in code documents (identity-challenge.ts): one
 * recipient, an address already on the roster, sent as the direct synchronous
 * consequence of a named human action, useless to anyone who did not ask for
 * it. Nothing here is batched or scheduled. Unlike the signup confirmations
 * it needs no config gate — those are per-event, customisable and
 * multi-recipient, which is what a toggle is for; this is a fixed 1:1
 * transactional notice.
 *
 * WHAT IT MAY SAY. Bullets are built by the caller, and callers are bound by
 * the rule the submit-side emails already follow: a change request names the
 * FIELDS that changed and never their values (Patrick, 2026-09-20), because
 * medical and "things we should know" text lives in those fields. A proof
 * claim may name the requirement and proof type — content today's
 * submit-time email already carries — but not the write-up body.
 *
 * FAILURE IS SILENT BY DESIGN. No deliverable address, or no submitter
 * recorded at all (every claim filed before 20260920210000), means no notice.
 * It never falls back to somebody else's inbox, and it never fails the review
 * itself: the leader's decision is the thing that must land.
 *
 * Plan: Plans/Review-Notifications.md.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { emailForPerson } from './person-emails';
import { renderEmail, sendEmail } from './email';
import { siteUrl } from './site-url';

export type ReviewOutcome = 'approved' | 'returned' | 'rejected';

/** What the submitter sent in, as the notice will describe it back to them. */
export interface ReviewNotice {
  outcome: ReviewOutcome;
  /** Who submitted it. Null (unknown submitter) means no notice is sent. */
  recipientPersonId: number | null;
  /** "your update to Ellie's record", "your proof for First Class 7d". */
  subject: string;
  /** The recap. Already filtered by the caller for what may be said. */
  bullets: string[];
  /** The leader's words when something comes back: feedback_md / rejection_reason. */
  feedback?: string | null;
  /** Where to go look — an absolute path, made absolute here. */
  path?: string;
  actionLabel?: string;
}

const COPY: Record<
  ReviewOutcome,
  { heading: (s: string) => string; intro: (s: string) => string; outro: string }
> = {
  approved: {
    heading: () => 'Your submission was approved',
    intro: (s) => `A leader has approved ${s}. Nothing more is needed — here is what you sent in.`,
    outro: 'Thanks for sending it in.'
  },
  returned: {
    heading: () => 'Your submission needs another look',
    intro: (s) =>
      `A leader has sent ${s} back for a bit more. Here is what you sent in, and what they asked for.`,
    outro: 'You can send it again once it is sorted — the original is still there to build on.'
  },
  rejected: {
    heading: () => 'Your submission was not accepted',
    intro: (s) => `A leader has declined ${s}. Here is what you sent in.`,
    outro: 'If this looks wrong, reply to this email or catch a leader at the next meeting.'
  }
};

/**
 * Render a review notice without sending it. Split out from the send so the
 * copy — and above all what the copy does NOT contain — is assertable:
 * `sendEmail` is deliberately inert under vitest, so a test that only
 * watched the send could never see the body.
 */
export function buildReviewNotice(notice: ReviewNotice): {
  subject: string;
  html: string;
  text: string;
} {
  const copy = COPY[notice.outcome];
  const heading = copy.heading(notice.subject);
  const bullets = [...notice.bullets];
  if (notice.feedback?.trim()) {
    bullets.push(`What the leader said: ${notice.feedback.trim()}`);
  }

  const { html, text } = renderEmail({
    heading,
    intro: copy.intro(notice.subject),
    bullets,
    outro: copy.outro,
    actionUrl: notice.path ? `${siteUrl()}${notice.path}` : undefined,
    actionLabel: notice.actionLabel
  });

  return { subject: `${heading} — Troop 79`, html, text };
}

/**
 * Send one review notice. Returns what happened so a caller can log it;
 * callers must NOT let the result change whether the review succeeded.
 */
export async function notifyReviewOutcome(
  supabase: SupabaseClient,
  notice: ReviewNotice
): Promise<{ sent: boolean; reason?: 'no-submitter' | 'no-address' | 'send-failed' }> {
  if (notice.recipientPersonId == null) return { sent: false, reason: 'no-submitter' };

  const to = await emailForPerson(supabase, notice.recipientPersonId);
  if (!to) return { sent: false, reason: 'no-address' };

  const { subject, html, text } = buildReviewNotice(notice);
  const res = await sendEmail({ to: [to], subject, html, text, confirm: true });

  return res.status === 'sent' || res.status === 'dry-run'
    ? { sent: true }
    : { sent: false, reason: 'send-failed' };
}
