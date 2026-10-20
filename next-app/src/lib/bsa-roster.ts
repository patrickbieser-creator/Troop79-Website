/**
 * BSA Roster check — the my.scouts.org "Roster Report" CSV against people.
 *
 * Patrick, 2026-10-20: compare the official roster with our database, and
 * keep each member's registration expiry so the troop can see who is due.
 * BSA is the source of truth for registration only (expiry, status,
 * positions, auto-renew opt-out); everything else it disagrees with us on is
 * a REPORTED difference a leader decides on, never an overwrite — names are
 * nicknames here, some adults keep a second address, and BSA's ranks lag ours.
 *
 * Pure functions, no I/O: the CSV is parsed in a Server Action and never
 * stored.
 */
import { splitCsvLine } from './csv-line';

export class RosterCsvError extends Error {}

export interface RosterMember {
  memberId: string;
  firstName: string;
  lastName: string;
  gender: 'M' | 'F' | null;
  /** Every position this member holds in the unit — one CSV row each. */
  positions: string[];
  youth: boolean;
  /** YPT completion, YYYY-MM-DD; null when "Never Taken". */
  yptCompleted: string | null;
  email: string | null;
  phone: string | null;
  /** Registration expiry, YYYY-MM-DD. */
  expires: string | null;
  /** New | Re-Registered | Transfer | Multiple, as BSA words it. */
  status: string | null;
  /** null when BSA leaves the flag blank (New members). */
  autoRenewOptedOut: boolean | null;
}

export interface ParsedRoster {
  /** "Date Report Generated", YYYY-MM-DD. */
  generatedOn: string | null;
  members: RosterMember[];
}

/** What the report needs to know about one of our people. Guests and merged
 *  people are left out by the loader. */
export interface RosterPerson {
  id: number;
  firstName: string;
  lastName: string;
  displayName: string;
  gender: string | null;
  phone: string | null;
  emails: string[];
  bsaMemberId: string | null;
  yptCompleted: string | null;
  active: boolean;
  inactiveReason: string | null;
  scout: { active: boolean; inactiveReason: string | null } | null;
  leaderRoles: string[];
}

export type DifferenceField = 'bsa_member_id' | 'ypt_completed' | 'email' | 'phone' | 'gender';

export interface RosterDifference {
  personId: number;
  name: string;
  field: DifferenceField;
  roster: string;
  ours: string | null;
}

export interface RegistrationUpdate {
  personId: number;
  expires: string | null;
  status: string | null;
  positions: string[];
  autoRenewOptedOut: boolean | null;
  asOf: string | null;
}

export interface RosterReport {
  asOf: string | null;
  matched: { memberId: string; personId: number; via: 'bsa' | 'name' }[];
  unmatched: RosterMember[];
  differences: RosterDifference[];
  /** On BSA's roster, but inactive here — their registration still runs. */
  inactiveButRegistered: {
    personId: number;
    name: string;
    reason: string | null;
    expires: string | null;
    autoRenewOptedOut: boolean | null;
  }[];
  /** Active here — a scout, or an adult with a role — but not on BSA's roster. */
  notOnRoster: { personId: number; name: string; kind: 'scout' | 'adult'; detail: string | null }[];
  registrations: RegistrationUpdate[];
}

const REQUIRED = ['memberid', 'firstname', 'lastname', 'positionname', 'expirydtstr'] as const;

/** MM/DD/YYYY → YYYY-MM-DD, or null. */
function usDate(value: string | undefined): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((value ?? '').trim());
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function yesNo(value: string | undefined): boolean | null {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'yes') return true;
  if (v === 'no') return false;
  return null;
}

const blank = (v: string | undefined) => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/** Parse a my.scouts.org Roster Report export. Throws RosterCsvError when the
 *  file isn't that report — a wrong file is an error to show, never a report. */
export function parseBsaRosterCsv(text: string): ParsedRoster {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const dateLine = lines.find((l) => l.startsWith('Date Report Generated:'));
  const generatedOn = usDate(dateLine?.split(':')[1]);

  // The header row is prefixed with ".." in the export.
  const headerAt = lines.findIndex((l) => l.replace(/^\.\./, '').startsWith('memberid,'));
  if (headerAt < 0) throw new RosterCsvError('This is not a my.scouts.org Roster Report — its member header row is missing.');
  const header = splitCsvLine(lines[headerAt].replace(/^\.\./, '')).map((h) => h.trim().toLowerCase());
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) throw new RosterCsvError(`The roster is missing columns: ${missing.join(', ')}.`);

  const byId = new Map<string, RosterMember>();
  for (const line of lines.slice(headerAt + 1)) {
    if (line.trim() === '') continue;
    const f = splitCsvLine(line);
    const col = (name: string) => f[header.indexOf(name)];
    const memberId = blank(col('memberid'));
    if (!memberId) continue;
    const position = blank(col('positionname'));
    const existing = byId.get(memberId);
    if (existing) {
      if (position && !existing.positions.includes(position)) existing.positions.push(position);
      if (position === 'Youth Member') existing.youth = true;
      // Each position row carries its own registration; the member is registered through the latest.
      const expires = usDate(col('expirydtstr'));
      if (expires && (!existing.expires || expires > existing.expires)) {
        existing.expires = expires;
        existing.status = blank(col('registrationstatus'));
        existing.autoRenewOptedOut = yesNo(col('cisautorenewaloptedout'));
      }
      continue;
    }
    const gender = blank(col('gender'));
    byId.set(memberId, {
      memberId,
      firstName: blank(col('firstname')) ?? '',
      lastName: blank(col('lastname')) ?? '',
      gender: gender === 'M' || gender === 'F' ? gender : null,
      positions: position ? [position] : [],
      youth: position === 'Youth Member',
      yptCompleted: usDate(col('stryptcompletiondate')),
      email: blank(col('primaryemail')),
      phone: blank(col('primaryphone')),
      expires: usDate(col('expirydtstr')),
      status: blank(col('registrationstatus')),
      autoRenewOptedOut: yesNo(col('cisautorenewaloptedout'))
    });
  }
  if (byId.size === 0) throw new RosterCsvError('The roster has no members in it.');
  return { generatedOn, members: [...byId.values()] };
}

/** Days from `today` to an expiry, both YYYY-MM-DD calendar days. */
function daysUntil(expires: string, today: string): number {
  const ms = Date.UTC(+expires.slice(0, 4), +expires.slice(5, 7) - 1, +expires.slice(8, 10)) -
    Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  return Math.round(ms / 86_400_000);
}

/** How close a registration is to running out: past, within 60 days, or fine. */
export function dueState(expires: string | null, today: string): 'expired' | 'soon' | 'ok' | null {
  if (!expires) return null;
  const days = daysUntil(expires, today);
  if (days < 0) return 'expired';
  if (days <= 60) return 'soon';
  return 'ok';
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const phoneDigits = (p: string | null | undefined) => (p ?? '').replace(/\D/g, '').slice(-10);

export function buildRosterReport(roster: ParsedRoster, people: RosterPerson[]): RosterReport {
  const byBsa = new Map<string, RosterPerson>();
  const byName = new Map<string, RosterPerson[]>();
  for (const p of people) {
    if (p.bsaMemberId) byBsa.set(p.bsaMemberId.trim(), p);
    const key = `${norm(p.firstName)}|${norm(p.lastName)}`;
    byName.set(key, [...(byName.get(key) ?? []), p]);
  }

  // A name match is only trusted when exactly one roster member and exactly
  // one person with no BSA ID share that name — two Anna Scouts are a question, not a match.
  const rosterNameCount = new Map<string, number>();
  for (const m of roster.members) {
    const key = `${norm(m.firstName)}|${norm(m.lastName)}`;
    rosterNameCount.set(key, (rosterNameCount.get(key) ?? 0) + 1);
  }

  const report: RosterReport = {
    asOf: roster.generatedOn,
    matched: [],
    unmatched: [],
    differences: [],
    inactiveButRegistered: [],
    notOnRoster: [],
    registrations: []
  };
  const claimed = new Set<number>();

  for (const m of roster.members) {
    let p = byBsa.get(m.memberId);
    let via: 'bsa' | 'name' = 'bsa';
    if (!p) {
      const key = `${norm(m.firstName)}|${norm(m.lastName)}`;
      // Someone who already has a different BSA ID is a different person with the same name.
      const candidates = (byName.get(key) ?? []).filter((c) => !claimed.has(c.id) && !c.bsaMemberId);
      if (candidates.length === 1 && rosterNameCount.get(key) === 1) {
        p = candidates[0];
        via = 'name';
      }
    }
    if (!p || claimed.has(p.id)) {
      report.unmatched.push(m);
      continue;
    }
    claimed.add(p.id);
    report.matched.push({ memberId: m.memberId, personId: p.id, via });

    const diff = (field: DifferenceField, rosterValue: string, ours: string | null) =>
      report.differences.push({ personId: p.id, name: p.displayName, field, roster: rosterValue, ours });

    if (via === 'name') diff('bsa_member_id', m.memberId, p.bsaMemberId);
    if (m.yptCompleted && m.yptCompleted !== p.yptCompleted) diff('ypt_completed', m.yptCompleted, p.yptCompleted);
    if (m.email && !p.emails.some((e) => norm(e) === norm(m.email))) diff('email', m.email, p.emails[0] ?? null);
    if (m.phone && phoneDigits(m.phone) !== phoneDigits(p.phone)) diff('phone', m.phone, p.phone);
    if (m.gender && (p.gender ?? '').slice(0, 1).toUpperCase() !== m.gender) diff('gender', m.gender, p.gender);

    const inactive = m.youth ? (p.scout ? !p.scout.active : !p.active) : !p.active;
    if (inactive) {
      report.inactiveButRegistered.push({
        personId: p.id,
        name: p.displayName,
        reason: (m.youth ? p.scout?.inactiveReason : null) ?? p.inactiveReason,
        expires: m.expires,
        autoRenewOptedOut: m.autoRenewOptedOut
      });
    }

    report.registrations.push({
      personId: p.id,
      expires: m.expires,
      status: m.status,
      positions: m.positions,
      autoRenewOptedOut: m.autoRenewOptedOut,
      asOf: roster.generatedOn
    });
  }

  for (const p of people) {
    if (claimed.has(p.id) || !p.active) continue;
    if (p.scout) {
      if (p.scout.active) report.notOnRoster.push({ personId: p.id, name: p.displayName, kind: 'scout', detail: null });
    } else if (p.leaderRoles.length) {
      report.notOnRoster.push({ personId: p.id, name: p.displayName, kind: 'adult', detail: p.leaderRoles.join(', ') });
    }
  }
  return report;
}
