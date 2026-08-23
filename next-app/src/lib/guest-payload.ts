/**
 * Guests as People (Plans/Guests-As-People.md) — the PURE, client-safe half
 * of the guest payload: the form's row shape, the household's known-guest
 * shape, the server-side normalizer and the two helpers that turn rows into
 * submit_household_signup entries. No Supabase import here on purpose: the
 * public forms (client components) need these, and lib/event-signup pulls in
 * the server client.
 */
import { GUEST_CLASSES, type GuestClass } from '@/lib/participant-class';

export interface GuestRow {
  /** people.id of one of the household's known guests (a re-pick — "Grandma
   *  Pat again"); null for a newly typed name. The RPC validates a re-pick
   *  belongs to THIS household. */
  personId: number | null;
  name: string;
  cls: GuestClass;
  /** Optional, adult guests only (carpools). Dropped for youth classes. */
  phone: string | null;
}


/** One of a household's known guests (people.guest_host_household_id), for
 *  the family form's "add again" picks and the leader's Add a guest. */
export interface HouseholdGuest {
  personId: number;
  name: string;
  /** Their class the last time they came, as the pick's default. */
  cls: GuestClass;
  phone: string | null;
}

/** Bound on guests per submission — a family bringing a whole den is fine,
 *  an unbounded list from a crafted POST is not. */
export const MAX_GUEST_ROWS = 20;

/**
 * Normalize the form's `guests` JSON (never trusted): parse, trim and cap
 * names, keep only the four guest classes, drop blanks, collapse duplicates
 * (a re-picked personId, else case-insensitive name + class), bound the
 * count. A phone rides along for adult guests only. Pure.
 */
export function normalizeGuestRows(raw: string | null | undefined): GuestRow[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: GuestRow[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const it = item as { name?: unknown; cls?: unknown; personId?: unknown; phone?: unknown; attending?: unknown };
    // A row toggled to "Can't make it" is not sent at all — the RPC's
    // reconcile turns its saved entry to 'no'. Absent means attending
    // (older clients never carried the flag).
    if (it.attending === false) continue;
    const name = String(it.name ?? '').trim().slice(0, 80);
    const cls = String(it.cls ?? '');
    const personId =
      typeof it.personId === 'number' && Number.isInteger(it.personId) && it.personId > 0 ? it.personId : null;
    if (!(GUEST_CLASSES as readonly string[]).includes(cls)) continue;
    if (!name && personId == null) continue;
    const key = personId != null ? `p:${personId}` : `${name.toLowerCase()}|${cls}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const phoneRaw = String(it.phone ?? '').trim().slice(0, 40);
    out.push({
      personId,
      name,
      cls: cls as GuestClass,
      phone: cls === 'adult_guest' && phoneRaw ? phoneRaw : null
    });
    if (out.length >= MAX_GUEST_ROWS) break;
  }
  return out;
}

/**
 * The RPC's guest payload rows (Plans/Guests-As-People.md): one entry per
 * normalized guest, hosted by `hostKey` (the key of the party member they
 * come with). Pure — the submit action appends these to the member entries.
 */
export function guestEntriesFor(guests: readonly GuestRow[], hostKey: string): Record<string, unknown>[] {
  return guests.map((g, i) => ({
    key: `g:${g.personId ?? `new${i}`}`,
    guest: true,
    guest_of_key: hostKey,
    participant_class: g.cls,
    person_id: g.personId,
    guest_name: g.personId == null ? g.name : null,
    guest_phone: g.cls === 'adult_guest' ? g.phone : null,
    status: 'yes',
    participation: 'full'
  }));
}

/**
 * Which member entry hosts the party's guests: the first attending member,
 * an adult when there is one (the old action's rule). null when nobody is
 * attending — then there is nothing to attach a guest to. Pure.
 */
export function guestHostKey(entries: readonly Record<string, unknown>[]): string | null {
  const attending = entries.filter(
    (e) => !e.guest && e.status === 'yes' && (e.participation ?? 'full') === 'full' && typeof e.key === 'string'
  );
  const host = attending.find((e) => e.person_kind === 'adult') ?? attending[0];
  return host ? String(host.key) : null;
}
