/**
 * Job codes — the roster's answer to job-heavy events (Plans/Roster-Status-
 * Tab.md; Patrick, 2026-08-22: "the rummage sale will have 20–30 jobs; we
 * should come up with a plan for how that's displayed on the roster").
 *
 * One narrow roster column per job, headed by a 1–5 character code, with the
 * full label / when / coverage on hover. The code is `signup_slots.code` when
 * the leader set one in the Builder; otherwise it is DERIVED here from the
 * label, so nothing is backfilled and a leader only types a code when the
 * derived one reads badly. Derived or not, codes are unique within an event
 * (a collision gets a digit suffix). Families never see codes.
 *
 * Everything here is pure; the grid, the Builder and the snapshot all go
 * through it so the same job shows the same code everywhere.
 */

import { formatTimeOfDay } from '@/lib/calendar-shared';

export const JOB_CODE_MAX = 5;
const CODE_RE = /^[A-Za-z0-9]{1,5}$/;
const FALLBACK = 'JOB';

export interface JobLike {
  id: number;
  label: string;
  code?: string | null;
  slotDate?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  needed?: number | null;
  filled?: number;
  description?: string | null;
}

/** Trim + uppercase; blank → null. What the Builder writes. */
export function normalizeJobCode(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toUpperCase();
  return v ? v : null;
}

/** 1–5 letters/digits — the same rule as the column CHECK. */
export function isValidJobCode(code: string): boolean {
  return CODE_RE.test(code);
}

/** A single word's consonant skeleton: first letter + following consonants,
 *  up to four ("Cashier" → CSHR, "Trucks" → TRCK, "Bake" → BK). A word that
 *  is all vowels after the first letter keeps its letters instead. */
function skeleton(word: string): string {
  const w = word.toUpperCase();
  const rest = w.slice(1).replace(/[AEIOU]/g, '');
  const s = (w[0] + rest).slice(0, 4);
  return s.length >= 2 ? s : w.slice(0, 4);
}

/** Derive a code from a job label, avoiding `taken`. Multi-word → initials
 *  (first four words, digits kept: "Shift 2" → S2); one word → consonant
 *  skeleton. Collisions get 2, 3, … appended, trimmed to stay ≤ 5 chars. */
export function deriveJobCode(label: string, taken: ReadonlySet<string> = new Set()): string {
  const words = label.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let base: string;
  if (words.length === 0) base = FALLBACK;
  else if (words.length === 1) base = skeleton(words[0]);
  else base = words.slice(0, 4).map((w) => w[0].toUpperCase()).join('');
  base = base.slice(0, JOB_CODE_MAX);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = String(n);
    const candidate = base.slice(0, JOB_CODE_MAX - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

/** slot id → code for every job on an event. Leader codes are reserved first
 *  (whatever their order), then derived codes fill the rest in list order, so
 *  the set is unique and stable across the grid, Builder and snapshot. */
export function resolveJobCodes(jobs: readonly { id: number; label: string; code?: string | null }[]): Map<number, string> {
  const out = new Map<number, string>();
  const taken = new Set<string>();
  for (const j of jobs) {
    const c = normalizeJobCode(j.code);
    if (c && !taken.has(c)) {
      out.set(j.id, c);
      taken.add(c);
    }
  }
  for (const j of jobs) {
    if (out.has(j.id)) continue;
    const c = deriveJobCode(j.label, taken);
    out.set(j.id, c);
    taken.add(c);
  }
  return out;
}

export interface JobBand<T extends JobLike = JobLike> {
  /** ISO date or 'anytime'. */
  key: string;
  /** "Fri 10/9" / "Anytime". */
  label: string;
  jobs: T[];
}

function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.getMonth() + 1}/${d.getDate()}`;
}

/** Group jobs by slot_date (date order, untimed last, builder order within a
 *  day) — the thin day super-header that lets 30 columns read as three blocks. */
export function bandJobsByDay<T extends JobLike>(jobs: readonly T[]): JobBand<T>[] {
  const byKey = new Map<string, T[]>();
  for (const j of jobs) {
    const key = j.slotDate ?? 'anytime';
    byKey.set(key, [...(byKey.get(key) ?? []), j]);
  }
  const keys = [...byKey.keys()].sort((a, b) => {
    if (a === 'anytime') return 1;
    if (b === 'anytime') return -1;
    return a.localeCompare(b);
  });
  return keys.map((key) => ({ key, label: key === 'anytime' ? 'Anytime' : shortDay(key), jobs: byKey.get(key)! }));
}

/** "Wed Sep 2 · 5:00 PM–7:30 PM" — only the parts the job has. */
export function jobWhen(j: { slotDate?: string | null; startsAt?: string | null; endsAt?: string | null }): string {
  const parts: string[] = [];
  if (j.slotDate) {
    const d = new Date(`${j.slotDate}T00:00:00`);
    if (!Number.isNaN(d.getTime())) parts.push(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', ''));
  }
  if (j.startsAt) parts.push(j.endsAt ? `${formatTimeOfDay(j.startsAt)}–${formatTimeOfDay(j.endsAt)}` : formatTimeOfDay(j.startsAt));
  return parts.join(' · ');
}

/** "N of M claimed" / "N claimed" / "" */
export function jobCoverage(j: { needed?: number | null; filled?: number }): string {
  if (j.needed != null) return `${j.filled ?? 0} of ${j.needed} claimed`;
  if (j.filled) return `${j.filled} claimed`;
  return '';
}

/** The code column's hover: full label, when, coverage. */
export function jobHeaderTitle(j: JobLike): string {
  return [j.label, jobWhen(j), jobCoverage(j)].filter(Boolean).join(' · ');
}
