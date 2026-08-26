/**
 * Recent Logins dashboard (Plans/Recent-Logins-Dashboard.md, Patrick
 * 2026-08-17). Admin and family logins are the same underlying flow since
 * the Phase E identity unification — one event stream, not two merged
 * sources. `role_snapshot` captures "leader vs family" AT LOGIN TIME
 * (a person's capabilities can change afterward; the dashboard shows what
 * they were when they actually signed in, not a retroactive re-derivation).
 *
 * Neither existing login mechanism gave a clean unified history on its own:
 * login_tokens has real per-event history for the link/code path, but
 * passkey_credentials.last_used_at is a single field overwritten every
 * login — no history. This module is the new shared event log both paths
 * write to.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type LoginMethod = 'link' | 'code' | 'passkey';

export interface LoginEvent {
  id: number;
  personId: number | null;
  personName: string | null;
  method: LoginMethod;
  success: boolean;
  failureReason: string | null;
  roleSnapshot: 'leader' | 'family' | null;
  deviceLabel: string;
  ip: string | null;
  isFirstLogin: boolean;
  createdAt: string;
  /** The leader's label who sent the link/code this login redeemed, or null
   *  for a self-service sign-in. See leaderAttributionByEventId() below for
   *  how this is derived — login_events carries no direct foreign key to the
   *  login_tokens row it redeemed, so this is a best-effort join, not a hard
   *  reference. */
  sentByLeader: string | null;
}

/** Heuristic User-Agent -> "Device - Browser" label. Deliberately simple
 *  (no new dependency) — this is a display convenience for a leader
 *  skimming a login list, not a security signal. Order matters: browsers
 *  that embed another engine's token in their UA string (Edge/Opera contain
 *  "Chrome/"; Chrome contains "Safari/") must be checked before the more
 *  generic engine they're built on. */
export function parseDeviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown device';

  let device: string;
  if (/iPhone/.test(userAgent)) device = 'iPhone';
  else if (/iPad/.test(userAgent)) device = 'iPad';
  else if (/Android/.test(userAgent)) device = 'Android';
  else if (/Macintosh|Mac OS X/.test(userAgent)) device = 'Mac';
  else if (/Windows/.test(userAgent)) device = 'Windows';
  else if (/Linux/.test(userAgent)) device = 'Linux';
  else return 'Unknown device';

  let browser = '';
  if (/Edg\//.test(userAgent)) browser = 'Edge';
  else if (/OPR\//.test(userAgent) || /Opera/.test(userAgent)) browser = 'Opera';
  else if (/CriOS\//.test(userAgent)) browser = 'Chrome';
  else if (/FxiOS\//.test(userAgent)) browser = 'Firefox';
  else if (/Chrome\//.test(userAgent)) browser = 'Chrome';
  else if (/Firefox\//.test(userAgent)) browser = 'Firefox';
  else if (/Safari\//.test(userAgent) && /Version\//.test(userAgent)) browser = 'Safari';

  return browser ? `${device} - ${browser}` : device;
}

export interface RecordLoginEventInput {
  personId: number | null;
  method: LoginMethod;
  success: boolean;
  failureReason?: string | null;
  userAgent?: string | null;
  ip?: string | null;
}

/** Best-effort — a logging failure must never break a real sign-in.
 *  Errors are swallowed (not thrown) after being surfaced to the console,
 *  same "don't let an audit trail take down the feature it's watching"
 *  principle as the rest of this codebase's non-critical side effects. */
export async function recordLoginEvent(supabase: SupabaseClient, input: RecordLoginEventInput): Promise<void> {
  try {
    let roleSnapshot: 'leader' | 'family' | null = null;
    let isFirstLogin = false;

    if (input.personId) {
      const [{ data: capRows }, { count }] = await Promise.all([
        supabase.from('person_capabilities').select('capability').eq('person_id', input.personId).limit(1),
        supabase
          .from('login_events')
          .select('id', { count: 'exact', head: true })
          .eq('person_id', input.personId)
          .eq('success', true)
      ]);
      roleSnapshot = (capRows ?? []).length > 0 ? 'leader' : 'family';
      isFirstLogin = input.success && (count ?? 0) === 0;
    }

    await supabase.from('login_events').insert({
      person_id: input.personId,
      method: input.method,
      success: input.success,
      failure_reason: input.failureReason ?? null,
      role_snapshot: roleSnapshot,
      user_agent: input.userAgent ?? null,
      device_label: parseDeviceLabel(input.userAgent),
      ip: input.ip ?? null,
      is_first_login: isFirstLogin
    });
  } catch (err) {
    console.error('recordLoginEvent failed (non-fatal):', err);
  }
}

interface RawLoginEventRow {
  id: number;
  person_id: number | null;
  method: LoginMethod;
  success: boolean;
  failure_reason: string | null;
  role_snapshot: 'leader' | 'family' | null;
  device_label: string | null;
  ip: string | null;
  is_first_login: boolean;
  created_at: string;
}

function mapRow(row: RawLoginEventRow, nameById: Map<number, string>, leaderByEventId: Map<number, string>): LoginEvent {
  return {
    id: row.id,
    personId: row.person_id,
    personName: row.person_id ? (nameById.get(row.person_id) ?? null) : null,
    method: row.method,
    success: row.success,
    failureReason: row.failure_reason,
    roleSnapshot: row.role_snapshot,
    deviceLabel: row.device_label ?? 'Unknown device',
    ip: row.ip,
    isFirstLogin: row.is_first_login,
    createdAt: row.created_at,
    sentByLeader: leaderByEventId.get(row.id) ?? null
  };
}

async function namesFor(supabase: SupabaseClient, personIds: number[]): Promise<Map<number, string>> {
  if (personIds.length === 0) return new Map();
  const { data } = await supabase
    .from('people')
    .select('id, display_name')
    .in('id', Array.from(new Set(personIds)));
  return new Map(((data ?? []) as { id: number; display_name: string }[]).map((p) => [p.id, p.display_name]));
}

/**
 * "… via link sent by {leader}" attribution (Plans/Verified-Signup.md
 * Phase A). login_events carries no token_id — it's a separate insert made
 * right after redemption (signin/actions.ts's setIdentityCookie), not a
 * child row of login_tokens — so this is a best-effort join: same person,
 * and the token's consumed_at lands within a few seconds of the login event's
 * created_at (they're written by the same request, milliseconds apart).
 * Restricted to tokens with a non-null created_by_leader — a self-service
 * sign-in has none, so it never matches here.
 */
const ATTRIBUTION_WINDOW_MS = 5000;

async function leaderAttributionByEventId(
  supabase: SupabaseClient,
  rows: RawLoginEventRow[]
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const personIds = Array.from(new Set(rows.map((r) => r.person_id).filter((id): id is number => id != null)));
  if (personIds.length === 0) return result;

  const { data } = await supabase
    .from('login_tokens')
    .select('person_id, created_by_leader, consumed_at')
    .in('person_id', personIds)
    .not('created_by_leader', 'is', null)
    .not('consumed_at', 'is', null);
  const tokens = (data ?? []) as { person_id: number; created_by_leader: string; consumed_at: string }[];
  if (tokens.length === 0) return result;

  for (const row of rows) {
    if (row.person_id == null) continue;
    const eventTime = new Date(row.created_at).getTime();
    const match = tokens.find(
      (t) =>
        t.person_id === row.person_id &&
        Math.abs(new Date(t.consumed_at).getTime() - eventTime) <= ATTRIBUTION_WINDOW_MS
    );
    if (match) result.set(row.id, match.created_by_leader);
  }
  return result;
}

/** The dashboard's own "last 15 logins" section — successful logins only. */
export async function loadRecentLogins(supabase: SupabaseClient, limit = 15): Promise<LoginEvent[]> {
  const { data } = await supabase
    .from('login_events')
    .select('id, person_id, method, success, failure_reason, role_snapshot, device_label, ip, is_first_login, created_at')
    .eq('success', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as RawLoginEventRow[];
  const [nameById, leaderByEventId] = await Promise.all([
    namesFor(
      supabase,
      rows.map((r) => r.person_id).filter((id): id is number => id != null)
    ),
    leaderAttributionByEventId(supabase, rows)
  ]);
  return rows.map((r) => mapRow(r, nameById, leaderByEventId));
}

/** The "view all" page — paginated, successful logins only. */
export async function loadAllLogins(
  supabase: SupabaseClient,
  opts: { limit?: number; offset?: number } = {}
): Promise<{ events: LoginEvent[]; total: number }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const [{ data, count }] = await Promise.all([
    supabase
      .from('login_events')
      .select(
        'id, person_id, method, success, failure_reason, role_snapshot, device_label, ip, is_first_login, created_at',
        { count: 'exact' }
      )
      .eq('success', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
  ]);
  const rows = (data ?? []) as RawLoginEventRow[];
  const [nameById, leaderByEventId] = await Promise.all([
    namesFor(
      supabase,
      rows.map((r) => r.person_id).filter((id): id is number => id != null)
    ),
    leaderAttributionByEventId(supabase, rows)
  ]);
  return { events: rows.map((r) => mapRow(r, nameById, leaderByEventId)), total: count ?? 0 };
}

export interface HouseholdsSignedInStats {
  /** Households with >=1 active scout AND >=1 successful login_events row
   *  from any member (parent or scout). */
  signedIn: number;
  /** Households with >=1 active scout — the denominator. */
  total: number;
}

/**
 * "N of M households have signed in at least once" (Plans/Verified-Signup.md
 * Phase A step 11 — feeds the Bugle reminder list until everyone has). M is
 * households with at least one active scout; N is the subset of those where
 * ANY member — a parent as well as the scout — has a successful login_events
 * row. A parent signing in counts for the household same as the scout would.
 */
export async function loadHouseholdsSignedInStats(supabase: SupabaseClient): Promise<HouseholdsSignedInStats> {
  const { data: scoutRows } = await supabase.from('scouts').select('person_id').eq('active', true);
  const scoutPersonIds = Array.from(
    new Set(
      ((scoutRows ?? []) as { person_id: number | null }[])
        .map((r) => r.person_id)
        .filter((id): id is number => id != null)
    )
  );
  if (scoutPersonIds.length === 0) return { signedIn: 0, total: 0 };

  const { data: scoutMemberRows } = await supabase
    .from('household_members')
    .select('household_id, person_id')
    .in('person_id', scoutPersonIds);
  const activeScoutHouseholdIds = new Set(
    ((scoutMemberRows ?? []) as { household_id: number; person_id: number }[]).map((r) => r.household_id)
  );
  const total = activeScoutHouseholdIds.size;
  if (total === 0) return { signedIn: 0, total: 0 };

  // Every member of one of those households, not just the scout — a parent's
  // login counts toward that household having signed in.
  const { data: allMemberRows } = await supabase
    .from('household_members')
    .select('household_id, person_id')
    .in('household_id', Array.from(activeScoutHouseholdIds));
  const householdByPerson = new Map<number, number>();
  for (const r of (allMemberRows ?? []) as { household_id: number; person_id: number }[]) {
    householdByPerson.set(r.person_id, r.household_id);
  }
  const memberPersonIds = Array.from(householdByPerson.keys());
  if (memberPersonIds.length === 0) return { signedIn: 0, total };

  const { data: loginRows } = await supabase
    .from('login_events')
    .select('person_id')
    .eq('success', true)
    .in('person_id', memberPersonIds);
  const signedInHouseholds = new Set<number>();
  for (const r of (loginRows ?? []) as { person_id: number | null }[]) {
    if (r.person_id == null) continue;
    const hh = householdByPerson.get(r.person_id);
    if (hh != null) signedInHouseholds.add(hh);
  }
  return { signedIn: signedInHouseholds.size, total };
}

/** A distinct signal from the main list, deliberately not mixed in
 *  (Patrick, 2026-08-17): repeated failures on one person is what's
 *  actually security-relevant here, not routine noise next to real logins. */
export async function loadRecentFailedLogins(supabase: SupabaseClient, limit = 15): Promise<LoginEvent[]> {
  const { data } = await supabase
    .from('login_events')
    .select('id, person_id, method, success, failure_reason, role_snapshot, device_label, ip, is_first_login, created_at')
    .eq('success', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as RawLoginEventRow[];
  const nameById = await namesFor(
    supabase,
    rows.map((r) => r.person_id).filter((id): id is number => id != null)
  );
  // A failed attempt never redeemed a token — nothing to attribute.
  return rows.map((r) => mapRow(r, nameById, new Map()));
}
