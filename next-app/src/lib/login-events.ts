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

function mapRow(row: RawLoginEventRow, nameById: Map<number, string>): LoginEvent {
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
    createdAt: row.created_at
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

/** The dashboard's own "last 15 logins" section — successful logins only. */
export async function loadRecentLogins(supabase: SupabaseClient, limit = 15): Promise<LoginEvent[]> {
  const { data } = await supabase
    .from('login_events')
    .select('id, person_id, method, success, failure_reason, role_snapshot, device_label, ip, is_first_login, created_at')
    .eq('success', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as RawLoginEventRow[];
  const nameById = await namesFor(
    supabase,
    rows.map((r) => r.person_id).filter((id): id is number => id != null)
  );
  return rows.map((r) => mapRow(r, nameById));
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
  const nameById = await namesFor(
    supabase,
    rows.map((r) => r.person_id).filter((id): id is number => id != null)
  );
  return { events: rows.map((r) => mapRow(r, nameById)), total: count ?? 0 };
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
  return rows.map((r) => mapRow(r, nameById));
}
