/**
 * The "authorized adult" pool for login is the same adult-leader set the
 * Meeting Plan engine already computes (see meeting-plan/load-input.ts):
 * real people (is_person) who aren't currently an active scout's youth-leader
 * initials. Reusing `leaders` instead of a second table means there's one
 * place to add/remove a person, not two lists that can drift apart.
 *
 * `can_login` further restricts that pool to people actually allowed to sign
 * in to /admin — being a real adult (e.g. a merit badge counselor who's never
 * touched the admin app) doesn't imply login access. `login_name` optionally
 * overrides the auto-derived "First L." label.
 */

import type { createAdminClient } from '@/lib/supabase/server';

export interface LeaderLite {
  code: string;
  name: string;
  is_person: boolean;
  scout_id: string | null;
  can_login: boolean;
  login_name: string | null;
}

export interface AuthorizedAdult {
  code: string;
  name: string;
  /** login_name override, or an auto-derived "First L." disambiguated
   *  against other adults who share a first name (e.g. two "Mike B."s
   *  become "Mike Ba." / "Mike Bl."). */
  label: string;
  canLogin: boolean;
}

/** Real people who aren't a currently-active scout's youth-leader initials. */
export function isAdultPerson(l: Pick<LeaderLite, 'is_person' | 'scout_id'>, activeScoutIds: Set<string>): boolean {
  return l.is_person && !(l.scout_id && activeScoutIds.has(l.scout_id));
}

/** Pure — no DB access. Computes the adult pool + labels from data already in memory. */
export function computeAdultPool(
  leaders: LeaderLite[],
  activeScoutIds: Set<string>
): AuthorizedAdult[] {
  const adults = leaders.filter((l) => isAdultPerson(l, activeScoutIds));
  const autoLabels = autoLoginLabels(adults);
  return adults
    .map((a) => ({
      code: a.code,
      name: a.name,
      label: a.login_name?.trim() || autoLabels.get(a.code)!,
      canLogin: a.can_login
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** "First L." per person, extended with more letters of the last name only
 *  when needed to stay unique within a shared first name. Ignores any
 *  login_name override — this is what a blank override would resolve to. */
export function autoLoginLabels(adults: { code: string; name: string }[]): Map<string, string> {
  const groups = new Map<string, { code: string; last: string }[]>();
  for (const a of adults) {
    const parts = a.name.trim().split(/\s+/);
    const first = parts[0] ?? a.name;
    const last = parts.slice(1).join(' ');
    const list = groups.get(first) ?? [];
    list.push({ code: a.code, last });
    groups.set(first, list);
  }

  const labels = new Map<string, string>();
  for (const [first, members] of groups) {
    let prefixLen = 1;
    const maxLen = Math.max(1, ...members.map((m) => m.last.length));
    while (prefixLen < maxLen) {
      const prefixes = members.map((m) => m.last.slice(0, prefixLen).toUpperCase());
      if (new Set(prefixes).size === prefixes.length) break;
      prefixLen++;
    }
    for (const m of members) {
      const lastPart = m.last.slice(0, prefixLen);
      labels.set(m.code, lastPart ? `${first} ${lastPart}.` : first);
    }
  }
  return labels;
}

export async function loadAdultLeaders(
  supabase: ReturnType<typeof createAdminClient>
): Promise<AuthorizedAdult[]> {
  const [leadersRes, scoutsRes] = await Promise.all([
    supabase.from('leaders').select('code, name, is_person, scout_id, can_login, login_name'),
    supabase.from('scouts').select('id').eq('active', true)
  ]);
  const leaders = (leadersRes.data ?? []) as LeaderLite[];
  const activeScoutIds = new Set(((scoutsRes.data ?? []) as { id: string }[]).map((s) => s.id));
  return computeAdultPool(leaders, activeScoutIds);
}

/** The actual login pool — adults with can_login = true. */
export async function loadAuthorizedAdults(
  supabase: ReturnType<typeof createAdminClient>
): Promise<AuthorizedAdult[]> {
  const all = await loadAdultLeaders(supabase);
  return all.filter((a) => a.canLogin);
}

/** Case-insensitive match against label, code, or full name — accepts whatever the datalist offered or an old-habit typed name/code. */
export function matchAuthorizedAdult(
  adults: AuthorizedAdult[],
  input: string
): AuthorizedAdult | null {
  const needle = input.trim().toLowerCase();
  if (!needle) return null;
  return (
    adults.find(
      (a) =>
        a.label.toLowerCase() === needle ||
        a.code.toLowerCase() === needle ||
        a.name.toLowerCase() === needle
    ) ?? null
  );
}
