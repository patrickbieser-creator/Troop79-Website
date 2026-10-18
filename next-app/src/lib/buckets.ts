/**
 * Buckets (Plans/Buckets-Lookup.md): the managed lookup every money row and calendar entry points at — an
 * event, a fundraiser, or a standing non-event bucket like Dividends. Pure helpers for the picker; the
 * database owns uniqueness (buckets_name_key on bucket_key(name)).
 */

export interface Bucket {
  id: number;
  name: string;
  /** A calendar entry points at it — derived, there is no type column. */
  isEvent: boolean;
  /** Latest occurred_on of a row in it ('YYYY-MM-DD'), null when empty. */
  lastUsed: string | null;
}

/** A bucket as the Buckets manager lists it: how many transactions it holds and which events point at it. */
export interface BucketUsage extends Bucket {
  rowCount: number;
  events: { id: number; title: string; date: string }[];
}

/** Delete is only for a bucket nothing uses — the database's on-delete-restrict says the same. */
export function canDeleteBucket(b: Pick<BucketUsage, 'rowCount' | 'events'>): boolean {
  return b.rowCount === 0 && b.events.length === 0;
}

/** Same normalisation as public.bucket_key(): case and runs of spaces don't make a new bucket. */
export function bucketKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The words that name a bucket: years ('26, 2026) and tiny words don't. */
function words(name: string): string[] {
  return bucketKey(name)
    .split(/[\s\-–—/,()]+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length >= 3 && !/\d/.test(w));
}

const sameWord = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

/**
 * "Did you mean…" before a new bucket is made (Patrick, 2026-10-17: adding one on the fly takes two
 * confirmations). An exact name comes first, then the buckets sharing the most words; at most five.
 */
export function nearBuckets(buckets: readonly Bucket[], typed: string, limit = 5): Bucket[] {
  const key = bucketKey(typed);
  if (!key) return [];
  const mine = words(typed);
  return buckets
    .map((b) => {
      const exact = bucketKey(b.name) === key;
      const theirs = words(b.name);
      const shared = mine.filter((w) => theirs.some((t) => sameWord(w, t))).length;
      return { b, score: exact ? Number.MAX_SAFE_INTEGER : shared };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || x.b.name.localeCompare(y.b.name))
    .slice(0, limit)
    .map((x) => x.b);
}

/** Picker order: recently used first (this year's buckets float up), then the rest by name. */
export function sortBucketsForPicker(buckets: readonly Bucket[]): Bucket[] {
  return [...buckets].sort((a, b) => {
    if (a.lastUsed && b.lastUsed) return b.lastUsed.localeCompare(a.lastUsed) || a.name.localeCompare(b.name);
    if (a.lastUsed) return -1;
    if (b.lastUsed) return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Which money rows belong to a calendar entry (Plans/Buckets-Lookup.md): every row in the entry's bucket —
 * once, even when several entries share it — plus every row linked to the entry itself, so a sign-up's fee
 * rows always show even if they sit in another bucket. An entry with no bucket yet reads only its own rows.
 * The Money tab, the snapshot and the event nav all read through this, as a PostgREST `or` filter.
 */
export function moneyScopeFor(calendarEntryId: number, entryBucketId: number | null): string {
  return entryBucketId != null ? `bucket_id.eq.${entryBucketId},calendar_entry_id.eq.${calendarEntryId}` : `calendar_entry_id.eq.${calendarEntryId}`;
}

/** A row's bucket name from the `bucket:buckets(name)` embed (Buckets Release 2: no label column). Many-to-one, so
 *  PostgREST returns one object or null; the untyped client calls it an array, so both shapes read. */
export function bucketNameOf(embed: unknown): string | null {
  const b = Array.isArray(embed) ? embed[0] : embed;
  return b && typeof b === 'object' && typeof (b as { name?: unknown }).name === 'string' ? (b as { name: string }).name : null;
}
