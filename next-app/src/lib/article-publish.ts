/**
 * News editor gaps (BACKLOG 2026-08-22, built 2026-08-24, Patrick: "do both"):
 *
 *   · `published_at` was set once, on first publish, and never editable — a
 *     story written after the fact could not be backdated, and published_at is
 *     the sort key on every feed, so it always landed on top dated today.
 *   · `author_role` was hard-coded 'leader' in the admin path even though the
 *     byline is free text and can name a scout.
 *
 * Both resolutions are pure so they can be tested without a database.
 * published_at is a timestamptz; the editor works in Central calendar days.
 */

import type { AuthorRole } from '@/lib/supabase/types';

const TIME_ZONE = 'America/Chicago';

/** The Central calendar day ('YYYY-MM-DD') of a stored instant — what the
 *  "Published on" picker shows. '' when nothing is stored. */
export function dateOfIso(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // en-CA gives YYYY-MM-DD directly.
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: TIME_ZONE
  }).format(d);
}

/**
 * What to write to published_at from the picker.
 *   · blank picker → null: leave the stored value alone (a draft stays unset
 *     and gets stamped on first publish, as before).
 *   · same Central day as stored → the stored instant, untouched — re-saving a
 *     post must not nudge its time.
 *   · any other day → 18:00Z on that day, which is midday Central in either
 *     DST state. Midnight UTC would read as the previous evening in Milwaukee.
 */
export function publishedAtFromDate(picked: string, existingIso: string | null): string | null {
  const day = picked.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  if (existingIso && dateOfIso(existingIso) === day) return existingIso;
  return `${day}T18:00:00.000Z`;
}

/** The byline's role. Only the two known roles are accepted; anything else
 *  (blank, a forged value) keeps the fallback — the current row's role on
 *  edit, 'leader' on create from the admin editor. */
export function resolveAuthorRole(raw: string | null | undefined, fallback: AuthorRole): AuthorRole {
  return raw === 'scout' || raw === 'leader' ? raw : fallback;
}
