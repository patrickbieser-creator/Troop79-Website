import { renderEmail, troopEmail } from '@/lib/email';

/**
 * "Make a Suggestion" — the Leader Dashboard's website feedback form
 * (Patrick, 2026-08-28). Pure half: who receives it, what is accepted, and
 * the message itself. The server action (dashboard/suggestion-actions.ts)
 * adds the session and the send.
 *
 * Two fixed troop-owned recipients — the troop inbox and the site owner —
 * never family-facing mail, so the "nothing sends automatically" rule in
 * lib/email.ts does not apply (same reasoning as the profile-update notice).
 */

export const SUGGESTION_MAX = 4000;

export function suggestionRecipients(): string[] {
  const owner = process.env.SUGGESTION_OWNER_EMAIL || 'patrickbieser@gmail.com';
  return [troopEmail(), owner];
}

export type SuggestionValidation = { ok: true; text: string } | { ok: false; error: string };

export function validateSuggestion(raw: string): SuggestionValidation {
  const text = (raw ?? '').trim();
  if (!text) return { ok: false, error: 'Please write your suggestion first.' };
  if (text.length > SUGGESTION_MAX)
    return { ok: false, error: `Please keep it under ${SUGGESTION_MAX.toLocaleString()} characters.` };
  return { ok: true, text };
}

export function buildSuggestionEmail(opts: { name: string; email: string | null; text: string }): {
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
} {
  const from = opts.email ? `${opts.name} (${opts.email})` : `${opts.name} (no email on file)`;
  const { html, text } = renderEmail({
    heading: `Website suggestion from ${opts.name}`,
    intro: `${from} sent this from the Leader Dashboard:`,
    // renderEmail escapes every string; one bullet per paragraph keeps the
    // leader's line breaks readable in both the HTML and text twins.
    bullets: opts.text.split(/\n+/).map((l) => l.trim()).filter(Boolean),
    outro: 'Reply to this email to follow up with them directly.'
  });
  return {
    subject: `Website suggestion from ${opts.name}`,
    html,
    text,
    replyTo: opts.email ?? undefined
  };
}
