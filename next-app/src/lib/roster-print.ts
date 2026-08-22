/**
 * The home roster — the printable troop directory (Patrick, 2026-08-22: "the
 * print a roster is a mess. Come up with a better, more useful printout of the
 * roster that could be in PDF format that would be available for leaders to
 * keep by their phones at home").
 *
 * WHAT WAS THERE BEFORE. "Print Roster" called window.print() on whichever
 * admin tab happened to be open, so it printed the working table — Edit
 * buttons, tab strip, sort arrows and all — with two font-size overrides.
 *
 * WHAT THIS IS. A document, composed here so its shape is testable without a
 * printer. Everything below is pure; the route loads rows and renders.
 *
 * ORGANIZED BY FAMILY, deliberately. The question a leader asks at 8pm is
 * "who is Ben's mom and what's her cell" — a household lookup. A flat list of
 * scouts, which is what the admin table is, cannot answer it. Siblings appear
 * once under one address instead of repeating it.
 *
 * WHAT IS DELIBERATELY ABSENT:
 *   - Medical, allergy and health-form content. `things_we_should_know` is
 *     food allergies and medical conditions, and the 2026-07-13 decision keeps
 *     medical content out of the system's outputs (Plans/Health-Forms.md is
 *     parked pending a committee decision). This document leaves the building
 *     on paper, so the field is never read here — asserted in tests.
 *   - BSA member IDs. Useful to the advancement chair, useless on a fridge,
 *     and an identifier worth not scattering.
 *   - Birthdates. A month/day list is a nice-to-have a troop can decide to add;
 *     a full DOB on a printed sheet is an identity-theft primitive.
 *   - Inactive scouts. This is who is in the troop now, not an archive.
 */

import { gradeFromGradYear, gradeLabel } from '@/lib/demographics';

// ── Input shapes (what the route loads) ─────────────────────────────────────

export interface RosterPrintHousehold {
  id: number;
  label: string;
}

export interface RosterPrintScout {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  household_id: number | null;
  patrol: string | null;
  current_rank: string | null;
  graduation_year: number | null;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  active: boolean;
}

export interface RosterPrintAdult {
  personId: number;
  householdId: number | null;
  name: string;
  /** The family word — "Mom", "Dad" — from relationships.role_label. */
  relationship: string | null;
  phone: string | null;
  email: string | null;
  leaderCode: string | null;
  /** leaders.role — "Scoutmaster", "Committee Chair", … */
  role: string | null;
  /** A youth leader holds a leaders row too; they are not an adult contact. */
  isYouth: boolean;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface RosterPrintRank {
  id: string;
  display_name: string;
}

export interface RosterPrintInput {
  households: RosterPrintHousehold[];
  scouts: RosterPrintScout[];
  adults: RosterPrintAdult[];
  /** scouts.current_rank stores the rank ID ("second-class"); the sheet needs
   *  the display name. Found in production on 2026-08-22 — the first cut
   *  printed the slug. */
  ranks: RosterPrintRank[];
  /** ISO date the document was generated — printed on it, so a stale copy on
   *  the fridge can be recognized as stale. */
  generatedOn: string;
}

// ── Output shapes (what the page renders) ───────────────────────────────────

export interface PrintedScout {
  id: string;
  name: string;
  patrol: string | null;
  rank: string | null;
  grade: string | null;
  phone: string | null;
  email: string | null;
  /** Only when it differs from the family's — otherwise null, so it is not
   *  repeated under every sibling. */
  address: string | null;
}

export interface PrintedAdult {
  name: string;
  relationship: string | null;
  role: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export interface PrintedFamily {
  key: string;
  label: string;
  address: string | null;
  scouts: PrintedScout[];
  adults: PrintedAdult[];
}

export interface PrintedPatrol {
  name: string;
  scouts: { id: string; name: string; rank: string | null }[];
}

export interface PrintedLeader {
  name: string;
  role: string;
  phone: string | null;
  email: string | null;
}

// ── Formatting ──────────────────────────────────────────────────────────────

/**
 * A US ten-digit number, rendered the way it is read aloud. Anything else —
 * an extension, "call the house", an international number — passes through
 * untouched: on paper a leader's own note is more useful than a mangled one.
 */
export function formatPhone(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const value = raw.trim();
  const digits = value.replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return value;
  // Reject anything carrying characters a plain phone number wouldn't (an
  // extension, a note) even when the digit count happens to land on ten.
  if (/[a-z]/i.test(value)) return value;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/**
 * "second-class" -> "Second Class". Falls back to title-casing the id so a
 * rank added to `scouts` before it exists in `ranks` still prints something
 * readable instead of a slug.
 */
export function rankLabel(rankId: string | null, ranks: RosterPrintRank[]): string | null {
  if (!rankId) return null;
  const match = ranks.find((r) => r.id === rankId);
  if (match) return match.display_name;
  return rankId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

export interface AddressParts {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

/** "123 N Astor St, Apt 3, Milwaukee, WI 53202" — missing parts drop out
 *  rather than leaving stray commas. Null when nothing is known. */
export function formatAddress(parts: AddressParts): string | null {
  const street = [parts.address_line1, parts.address_line2].map((s) => s?.trim()).filter(Boolean);
  const city = parts.city?.trim();
  const state = parts.state?.trim();
  const zip = parts.zip?.trim();
  const region = [state, zip].filter(Boolean).join(' ');
  const tail = [city, region].filter(Boolean).join(', ');
  const all = [...street, tail].filter(Boolean);
  return all.length ? all.join(', ') : null;
}

/** Same place, allowing for how two people typed it. */
export function sameAddress(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm(a) === norm(b);
}

/**
 * Sort a household label by surname. "Barry / Kingston" files under B, and a
 * lowercase particle ("de la Cruz") files under D rather than sorting below
 * every capital letter the way a raw comparison would.
 */
export function familySortKey(label: string): string {
  return label
    .replace(/[^\p{L}\s/-]/gu, '')
    .split(/[/]/)[0]
    .trim()
    .toLocaleUpperCase();
}

// ── Composition ─────────────────────────────────────────────────────────────

function scoutAddress(s: RosterPrintScout): string | null {
  return formatAddress(s);
}

function adultAddress(a: RosterPrintAdult): string | null {
  return formatAddress(a);
}

/**
 * Families, alphabetical by surname. A family appears when it has at least one
 * ACTIVE scout or at least one adult — the household of a scout who has aged
 * out but whose parent still runs the trailer is a real family in this troop.
 */
export function buildFamilyRoster(input: RosterPrintInput): PrintedFamily[] {
  const activeScouts = input.scouts.filter((s) => s.active);
  const families: PrintedFamily[] = [];

  for (const h of input.households) {
    const scouts = activeScouts
      .filter((s) => s.household_id === h.id)
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
    const adults = input.adults
      .filter((a) => a.householdId === h.id && !a.isYouth)
      .sort((a, b) => a.name.localeCompare(b.name));

    /*
     * A family prints when it has an ACTIVE SCOUT, or an adult who holds a
     * troop role. Production's first run showed 41 "families" against 28
     * scouts: households left behind by aged-out scouts, and adults carrying
     * no scout at all, each printed as a family and buried the real ones. A
     * committee member whose scout has aged out is still someone you call, so
     * a role keeps them; nothing else does.
     */
    const hasRoleHolder = adults.some((a) => !!a.role?.trim());
    if (scouts.length === 0 && !hasRoleHolder) continue;

    // The family address is whatever its scouts agree on; the first known one
    // wins when they disagree, and the disagreeing scout keeps their own.
    const familyAddress = scouts.map(scoutAddress).find((a) => a !== null) ?? null;

    families.push({
      key: `h${h.id}`,
      label: h.label,
      address: familyAddress,
      scouts: scouts.map((s) => {
        const own = scoutAddress(s);
        return {
          id: s.id,
          name: s.display_name,
          patrol: s.patrol,
          rank: rankLabel(s.current_rank, input.ranks),
          grade: gradeLabel(gradeFromGradYear(s.graduation_year)) || null,
          phone: formatPhone(s.phone),
          email: s.email?.trim() || null,
          address: own && !sameAddress(own, familyAddress) ? own : null
        };
      }),
      adults: adults.map((a) => {
        const own = adultAddress(a);
        return {
          name: a.name,
          relationship: a.relationship,
          role: a.role,
          phone: formatPhone(a.phone),
          email: a.email?.trim() || null,
          address: own && !sameAddress(own, familyAddress) ? own : null
        };
      })
    });
  }

  return families.sort((a, b) => familySortKey(a.label).localeCompare(familySortKey(b.label)));
}

const UNASSIGNED_PATROL = 'Not yet assigned';

/** Who is in my patrol — the page a PL takes to a meeting. */
export function buildPatrolRoster(input: RosterPrintInput): PrintedPatrol[] {
  const byPatrol = new Map<string, PrintedPatrol['scouts']>();
  for (const s of input.scouts) {
    if (!s.active) continue;
    const name = s.patrol?.trim() || UNASSIGNED_PATROL;
    const list = byPatrol.get(name) ?? [];
    list.push({ id: s.id, name: s.display_name, rank: rankLabel(s.current_rank, input.ranks) });
    byPatrol.set(name, list);
  }
  return [...byPatrol.entries()]
    .map(([name, scouts]) => ({
      name,
      scouts: scouts.sort((a, b) => a.name.localeCompare(b.name))
    }))
    .sort((a, b) => {
      // "Not yet assigned" is a bucket, not a patrol — it sorts last whatever
      // letter it starts with.
      if (a.name === UNASSIGNED_PATROL) return 1;
      if (b.name === UNASSIGNED_PATROL) return -1;
      return a.name.localeCompare(b.name);
    });
}

/**
 * The two roles a parent reaches for first, then everyone else alphabetically.
 * Youth leaders are excluded: this is the "who do I call" page, and a Senior
 * Patrol Leader is a scout.
 */
const ROLE_PRIORITY = ['scoutmaster', 'committee chair'];

export function buildLeaderDirectory(input: RosterPrintInput): PrintedLeader[] {
  return input.adults
    .filter((a) => !a.isYouth && !!a.role?.trim())
    .map((a) => ({
      name: a.name,
      role: a.role!.trim(),
      phone: formatPhone(a.phone),
      email: a.email?.trim() || null
    }))
    .sort((a, b) => {
      const ai = ROLE_PRIORITY.indexOf(a.role.toLowerCase());
      const bi = ROLE_PRIORITY.indexOf(b.role.toLowerCase());
      const ar = ai === -1 ? ROLE_PRIORITY.length : ai;
      const br = bi === -1 ? ROLE_PRIORITY.length : bi;
      if (ar !== br) return ar - br;
      return a.name.localeCompare(b.name);
    });
}

/** Counts for the cover line — "31 scouts · 24 families · 12 registered adults". */
export function rosterCounts(input: RosterPrintInput): {
  scouts: number;
  families: number;
  adults: number;
} {
  const families = buildFamilyRoster(input);
  return {
    scouts: input.scouts.filter((s) => s.active).length,
    families: families.length,
    // Only the adults who actually appear — counting every adult on record
    // reported 60 against 28 scouts, which is a database fact, not a roster.
    adults: families.reduce((n, f) => n + f.adults.length, 0)
  };
}
