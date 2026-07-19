import { Resend } from 'resend';

/**
 * Outbound email for Event Signup (Resend).
 *
 * DESIGN RULES, deliberate:
 *
 * 1. NOTHING sends automatically. Every send is triggered explicitly by a
 *    leader from the roster. A signup form that quietly emails 25 families
 *    the first time it's tested is not recoverable — you cannot un-send.
 *
 * 2. Unconfigured is a no-op, not a crash. With RESEND_API_KEY unset (local
 *    dev, previews) send() reports `skipped` so the surrounding flow behaves
 *    identically without anyone receiving mail.
 *
 * 3. DRY RUN by default at the call site: callers pass `confirm: true` to
 *    actually dispatch. Without it they get the resolved recipient list back
 *    and nothing leaves the building — so a leader can see exactly who would
 *    be written to before committing.
 *
 * 4. Addresses that bounced or unsubscribed are filtered out at the source
 *    (lib/email-recipients.ts), because the mail provider will penalise a
 *    sender that keeps mailing dead addresses.
 */

export interface SendResult {
  status: 'sent' | 'skipped' | 'dry-run' | 'error';
  to: string[];
  detail?: string;
}

function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

/**
 * Sends the message individually to each recipient (see the loop below for
 * why a shared To: is not acceptable). `confirm` must be true or this only
 * reports what it *would* do.
 */
export async function sendEmail(opts: {
  to: string[];
  subject: string;
  html: string;
  text: string;
  confirm: boolean;
}): Promise<SendResult> {
  const to = [...new Set(opts.to.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (to.length === 0) return { status: 'skipped', to: [], detail: 'No deliverable addresses.' };

  if (!opts.confirm) return { status: 'dry-run', to };

  const resend = client();
  const from = process.env.EMAIL_FROM;
  if (!resend || !from) {
    return {
      status: 'skipped',
      to,
      detail: 'Email is not configured on this server (RESEND_API_KEY / EMAIL_FROM unset).'
    };
  }

  // ONE MESSAGE PER RECIPIENT — never a shared To:.
  //
  // Passing the whole list to `to` puts every parent's address in the header
  // of everyone else's copy, which discloses the troop's family contact list
  // to all of it. At ~25 families the extra API calls cost nothing, and a
  // per-recipient send is also what lets these be personalised later.
  const failures: string[] = [];
  for (const recipient of to) {
    try {
      const { error } = await resend.emails.send({
        from,
        to: [recipient],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        replyTo: process.env.EMAIL_REPLY_TO || undefined
      });
      if (error) failures.push(`${recipient}: ${error.message}`);
    } catch (err) {
      failures.push(`${recipient}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failures.length === to.length) {
    return { status: 'error', to, detail: failures[0] };
  }
  if (failures.length > 0) {
    return {
      status: 'sent',
      to,
      detail: `${to.length - failures.length} sent, ${failures.length} failed: ${failures.join('; ')}`
    };
  }
  return { status: 'sent', to };
}

/** Minimal, readable HTML — troop mail lands in Gmail and phone clients, and
 *  a plain layout survives both far better than a designed template. */
export function renderEmail(opts: {
  heading: string;
  intro: string;
  bullets?: string[];
  outro?: string;
  actionUrl?: string;
  actionLabel?: string;
}): { html: string; text: string } {
  const { heading, intro, bullets = [], outro, actionUrl, actionLabel } = opts;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.55;color:#363636;max-width:560px">
  <h1 style="font-size:19px;color:#1e3a4a;margin:0 0 12px">${esc(heading)}</h1>
  <p style="margin:0 0 12px">${esc(intro)}</p>
  ${bullets.length ? `<ul style="margin:0 0 12px;padding-left:20px">${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
  ${actionUrl ? `<p style="margin:0 0 16px"><a href="${esc(actionUrl)}" style="background:#1e3a4a;color:#fff;text-decoration:none;padding:9px 18px;border-radius:3px;display:inline-block">${esc(actionLabel ?? 'Open')}</a></p>` : ''}
  ${outro ? `<p style="margin:0 0 12px">${esc(outro)}</p>` : ''}
  <p style="margin:18px 0 0;font-size:12px;color:#787060">Scout Troop 79 · Milwaukee, WI</p>
</div>`;

  const text = [
    heading,
    '',
    intro,
    ...(bullets.length ? ['', ...bullets.map((b) => `  - ${b}`)] : []),
    ...(actionUrl ? ['', `${actionLabel ?? 'Open'}: ${actionUrl}`] : []),
    ...(outro ? ['', outro] : []),
    '',
    'Scout Troop 79 - Milwaukee, WI'
  ].join('\n');

  return { html, text };
}
