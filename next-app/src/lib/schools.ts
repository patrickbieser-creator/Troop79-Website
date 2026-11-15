/**
 * Schools — the lookup table behind every school field (migration 20270105100000_schools.sql,
 * Plans/Person-Record-One-Save.md "Schools"). A scout points at one with `scouts.school_id`; the old
 * `scouts.school` text column is kept only until a later migration drops it, and nothing reads it.
 *
 * Pure helpers (safe to import from client components) plus the DB reads/writes that take a
 * SupabaseClient, so the server actions, the change-request approval and Vitest share one code path.
 * The database's unique index on lower(btrim(name)) is the last word on duplicates.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const SCHOOL_NAME_MAX = 120;
export const SCHOOL_SHORT_NAME_MAX = 20;

export interface School {
  id: number;
  name: string;
  short_name: string | null;
  /** false = hidden: not offered in the pickers; a scout who has it keeps it. */
  active: boolean;
}

export interface SchoolWithUsage extends School {
  /** Scouts pointing at it (active and inactive). */
  scoutCount: number;
}

export const SCHOOL_COLS = 'id, name, short_name, active';

/** Trimmed, with runs of whitespace collapsed — how a school name is stored. */
export function cleanSchoolName(raw: string): string {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

/** The comparison key: two names are the same school when their keys match (mirrors the unique index). */
export function schoolKey(raw: string): string {
  return cleanSchoolName(raw).toLowerCase();
}

/** The school whose name matches exactly, ignoring case and spacing. */
export function findSchoolByName<T extends Pick<School, 'name'>>(schools: readonly T[], raw: string): T | undefined {
  const k = schoolKey(raw);
  return k ? schools.find((s) => schoolKey(s.name) === k) : undefined;
}

export function sortSchools<T extends Pick<School, 'name'>>(schools: readonly T[]): T[] {
  return [...schools].sort((a, b) => a.name.localeCompare(b.name));
}

/** Every school, hidden ones too, by name. */
export async function listSchoolsWith(sb: SupabaseClient): Promise<School[]> {
  const { data, error } = await sb.from('schools').select(SCHOOL_COLS).order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as School[];
}

/** The names a family may pick from: active schools only. */
export async function listActiveSchoolNamesWith(sb: SupabaseClient): Promise<string[]> {
  return (await listSchoolsWith(sb)).filter((s) => s.active).map((s) => s.name);
}

/** Every school with how many scouts use it — the Lookups › Schools list. */
export async function listSchoolsWithUsage(sb: SupabaseClient): Promise<SchoolWithUsage[]> {
  const [schools, scoutsRes] = await Promise.all([
    listSchoolsWith(sb),
    // ~100 scouts in all; far under the 1000-row cap.
    sb.from('scouts').select('school_id').not('school_id', 'is', null)
  ]);
  if (scoutsRes.error) throw new Error(scoutsRes.error.message);
  const counts = new Map<number, number>();
  for (const r of (scoutsRes.data ?? []) as { school_id: number }[]) counts.set(r.school_id, (counts.get(r.school_id) ?? 0) + 1);
  return schools.map((s) => ({ ...s, scoutCount: counts.get(s.id) ?? 0 }));
}

export type AddSchoolResult =
  | { ok: true; school: School; created: boolean; unhidden: boolean }
  | { ok: false; error: string };

/**
 * The school with this name, made if it doesn't exist. A case-insensitive exact match returns the existing
 * row instead of inserting; a hidden match is unhidden (someone wants it again). Shared by the leader's
 * "+ Add" and the change-request approval, which resolves a family's typed name the same way.
 */
export async function ensureSchoolWith(sb: SupabaseClient, rawName: string): Promise<AddSchoolResult> {
  const name = cleanSchoolName(rawName);
  if (!name) return { ok: false, error: 'Give the school a name.' };
  if (name.length > SCHOOL_NAME_MAX) return { ok: false, error: `A school name can be at most ${SCHOOL_NAME_MAX} characters.` };

  const existing = findSchoolByName(await listSchoolsWith(sb), name);
  if (existing) {
    if (existing.active) return { ok: true, school: existing, created: false, unhidden: false };
    const { error } = await sb.from('schools').update({ active: true }).eq('id', existing.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, school: { ...existing, active: true }, created: false, unhidden: true };
  }

  const { data, error } = await sb.from('schools').insert({ name }).select(SCHOOL_COLS).single();
  if (error) {
    // Lost a race with another insert of the same name: the index refused it, so the row exists now.
    if (error.code === '23505') {
      const raced = findSchoolByName(await listSchoolsWith(sb), name);
      if (raced) return { ok: true, school: raced, created: false, unhidden: false };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, school: data as School, created: true, unhidden: false };
}

/** A school's name by id (audit from→to); null for no school. */
export async function schoolNameById(sb: SupabaseClient, id: number | null): Promise<string | null> {
  if (id == null) return null;
  const { data } = await sb.from('schools').select('name').eq('id', id).maybeSingle();
  return (data as { name: string } | null)?.name ?? null;
}
