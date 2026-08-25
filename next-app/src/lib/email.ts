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
 *
 * 5. EMAIL_REDIRECT_TO is the dev relay. Rules 1-3 protect production by
 *    keeping mail manual; they do NOT protect a developer running a real
 *    Resend key against a database full of real family addresses, which is
 *    exactly what testing the sign-in flow requires (a login code is the one
 *    message that MUST auto-send, so no amount of dry-run discipline covers
 *    it). With EMAIL_REDIRECT_TO set, every recipient is rewritten to that
 *    one address and the intended recipient is preserved in the subject, so
 *    a test send is fully exercised end to end and still cannot reach a
 *    family. Left set in production it would misroute mail loudly to a
 *    single inbox rather than silently to the wrong people — the safer of
 *    the two failure modes, and the reason it is opt-IN by presence.
 */

export interface SendResult {
  status: 'sent' | 'skipped' | 'dry-run' | 'error';
  to: string[];
  detail?: string;
  /** Set when the dev relay rewrote the recipients (see rule 5). */
  redirectedFrom?: string[];
}

function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

/**
 * Where leader-facing notifications go (submissions, profile updates).
 *
 * Was hardcoded in three separate action files. It reads from the
 * environment now so a dev box can point it somewhere harmless, and so the
 * troop can change its own address without a code change — the literal
 * default keeps production behaving exactly as before.
 */
export function troopEmail(): string {
  return process.env.TROOP_NOTIFICATION_EMAIL || 'bsatroop79bg@gmail.com';
}

/**
 * Applies the dev relay. Pure, and exported for tests: this is the guard that
 * stands between a developer with a live API key and 25 real families.
 *
 * `redirectTo` is a REQUIRED parameter rather than defaulting to
 * `process.env.EMAIL_REDIRECT_TO`. A default would be read on every call where
 * the argument is `undefined` — including a test passing `undefined` to mean
 * "no relay configured", which then silently picked up the developer's own
 * .env value and asserted nothing. Reading the environment is the caller's
 * job; this function only decides.
 */
export function applyRedirect(
  to: string[],
  subject: string,
  redirectTo: string | undefined
): { to: string[]; subject: string; redirectedFrom?: string[] } {
  const target = (redirectTo ?? '').trim().toLowerCase();
  if (!target) return { to, subject };
  // The intended recipients ride along in the subject — without it, a run
  // that fans out to a dozen people lands as a dozen identical messages in
  // one inbox with no way to tell which was which.
  return {
    to: [target],
    subject: `[test→${to.join(', ')}] ${subject}`,
    redirectedFrom: to
  };
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
  /** Per-message Reply-To (the signup confirmation uses the first leader
   *  address); falls back to EMAIL_REPLY_TO, then none. */
  replyTo?: string;
}): Promise<SendResult> {
  const intended = [...new Set(opts.to.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (intended.length === 0)
    return { status: 'skipped', to: [], detail: 'No deliverable addresses.' };

  // Redirect BEFORE the dry-run return, so a dry run reports the addresses
  // that would actually be written to rather than the ones it would have
  // without the relay — otherwise the preview lies about where mail goes.
  const { to, subject, redirectedFrom } = applyRedirect(
    intended,
    opts.subject,
    process.env.EMAIL_REDIRECT_TO
  );

  if (!opts.confirm) return { status: 'dry-run', to, redirectedFrom };

  const resend = client();
  const from = process.env.EMAIL_FROM;
  if (!resend || !from) {
    return {
      status: 'skipped',
      to,
      redirectedFrom,
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
        subject,
        html: opts.html,
        text: opts.text,
        replyTo: opts.replyTo || process.env.EMAIL_REPLY_TO || undefined
      });
      if (error) failures.push(`${recipient}: ${error.message}`);
    } catch (err) {
      failures.push(`${recipient}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failures.length === to.length) {
    return { status: 'error', to, redirectedFrom, detail: failures[0] };
  }
  if (failures.length > 0) {
    return {
      status: 'sent',
      to,
      redirectedFrom,
      detail: `${to.length - failures.length} sent, ${failures.length} failed: ${failures.join('; ')}`
    };
  }
  return { status: 'sent', to, redirectedFrom };
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
