/**
 * Adults added on the fly — the "Add another parent or guardian" rows on the
 * event signup form and the profile's household-member form. Both hand the
 * values to `add_parent_to_household`, and both used to hand them over
 * unchecked.
 *
 * The check lives here, in front of the RPC, because the database's answer to
 * a bad address is unusable by a family: `person_emails_email_shape` fires
 * from inside the `people.primary_email` trigger and the whole signup bounces
 * with the raw constraint name (2026-09-06, Eagle Court of Honor). The RPC
 * runs in one transaction, so nothing was half-written — but nothing was
 * explained either.
 *
 * Same regexp as the confirmation mailer's `isEmail`; duplicated on purpose so
 * this stays importable without pulling the mailer's module graph.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface NewAdult {
  name: string;
  email: string | null;
  relationship: string | null;
}

export type ParsedNewAdults = { ok: true; adults: NewAdult[] } | { ok: false; error: string };

/**
 * Null when the email is blank or well-formed; otherwise the sentence the
 * family should see. Names the adult AND the value, because the row they
 * typed it in may already be scrolled off screen when the page comes back.
 */
export function newAdultEmailError(name: string, email: string | null | undefined): string | null {
  const e = (email ?? '').trim();
  if (!e) return null;
  if (EMAIL_RE.test(e)) return null;
  return `"${e}" doesn't look like an email address for ${name.trim()}. Fix it, or leave the email blank and add it later from your profile.`;
}

/**
 * The hidden `newAdults` field is JSON the form builds from its own state.
 * Unparseable or wrong-shaped input means "no new adults" — it was never a
 * family typing, so there is nobody to correct. Nameless rows are dropped
 * (the form filters them too; belt and braces). The first malformed email
 * stops the whole submit before any write, so a family never ends up with
 * one adult saved and the next one rejected.
 */
export function parseNewAdults(raw: unknown): ParsedNewAdults {
  let list: unknown;
  try {
    list = JSON.parse(String(raw ?? '[]') || '[]');
  } catch {
    return { ok: true, adults: [] };
  }
  if (!Array.isArray(list)) return { ok: true, adults: [] };

  const adults: NewAdult[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { name?: unknown; email?: unknown; relationship?: unknown };
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name) continue;
    const email = typeof row.email === 'string' ? row.email.trim() : '';
    const relationship = typeof row.relationship === 'string' ? row.relationship.trim() : '';
    const problem = newAdultEmailError(name, email);
    if (problem) return { ok: false, error: problem };
    adults.push({ name, email: email || null, relationship: relationship || null });
  }
  return { ok: true, adults };
}
