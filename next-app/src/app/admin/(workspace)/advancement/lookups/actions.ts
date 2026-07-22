'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/require-role';
import { createAdminClient } from '@/lib/supabase/server';
import type { LedgerKind } from '@/lib/supabase/types';
import { slugify } from '@/lib/slugify';
import { cascadeLibraryReqRename } from '@/lib/library-data';

/** The event-tab kinds an event can be classified as — Day Outing/Fundraiser
 *  have no natural quantity of their own, Camping/Hiking are implied by
 *  Nights/Miles but still get a stored default so the Type never needs
 *  re-picking for a recurring event. */
const VALID_EVENT_KINDS: ReadonlySet<LedgerKind> = new Set<LedgerKind>([
  'camping_nights',
  'hiking_miles',
  'day_outing',
  'fundraiser'
]);

/**
 * Lookups & Admin write paths. Same pattern as the ledger actions: leader
 * session cookie gates the route, mutations use the service-role client. RLS
 * tightening (Phase 4) will move enforcement to the DB.
 */

interface Result {
  ok: boolean;
  error?: string;
}

interface ScoutDemoFields {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  health_form_date: string | null;
  birthdate: string | null;
  /** Freeform: allergies/medical/special needs. Shared by scouts and leaders,
   *  same as every other field readDemoFields returns (D-014 supersede). */
  things_we_should_know: string | null;
}

interface CounselorInput {
  leader_code: string;
}

function readDemoFields(formData: FormData): ScoutDemoFields {
  const str = (k: string) => {
    const v = String(formData.get(k) ?? '').trim();
    return v === '' ? null : v;
  };
  return {
    address_line1: str('address_line1'),
    address_line2: str('address_line2'),
    city: str('city'),
    state: str('state'),
    zip: str('zip'),
    phone: str('phone'),
    email: str('email'),
    health_form_date: str('health_form_date'),
    birthdate: str('birthdate'),
    things_we_should_know: str('things_we_should_know')
  };
}

/** Scout-only demographics (Scoutbook parity, 2026-07-13). */
function readScoutExtras(formData: FormData) {
  const str = (k: string) => {
    const v = String(formData.get(k) ?? '').trim();
    return v === '' ? null : v;
  };
  const gradYearRaw = str('graduation_year');
  return {
    gender: str('gender'),
    school: str('school'),
    graduation_year: gradYearRaw ? Number(gradYearRaw) : null,
    swim_class: str('swim_class')
  };
}

/** Leader-only demographics. */
function readLeaderExtras(formData: FormData) {
  const str = (k: string) => {
    const v = String(formData.get(k) ?? '').trim();
    return v === '' ? null : v;
  };
  return {
    bsa_member_id: str('bsa_member_id_leader'),
    ypt_completed: str('ypt_completed')
  };
}

function readCounselors(formData: FormData): CounselorInput[] {
  const raw = String(formData.get('counselors') ?? '[]');
  try {
    const arr = JSON.parse(raw) as CounselorInput[];
    if (!Array.isArray(arr)) return [];
    return arr.filter((c) => c && typeof c.leader_code === 'string' && c.leader_code.trim() !== '');
  } catch {
    return [];
  }
}

interface ReqInput {
  id?: number;
  originalCode?: string;
  code: string;
  label: string;
  complete_rule: 'all' | 'any' | 'n-of';
  complete_n: number | null;
  children: ReqInput[];
}

function readReqTree(formData: FormData): ReqInput[] | null {
  const raw = formData.get('reqTree');
  if (raw === null) return null; // tree not submitted — don't touch
  try {
    const arr = JSON.parse(String(raw)) as ReqInput[];
    if (!Array.isArray(arr)) return null;
    return arr;
  } catch {
    return null;
  }
}

async function ensureLeader() {
  return requireRole(['leader']);
}

function revalidateAll() {
  revalidatePath('/admin/advancement/lookups');
  // Scout/adult management moved to the Roster in v1.12 — without this, an
  // edit made there redirects back to a cached, stale table.
  revalidatePath('/admin/advancement/roster');
  revalidatePath('/admin/advancement/dashboard');
  revalidatePath('/admin/advancement/ledger');
  revalidatePath('/admin/advancement/fast-entry');
  revalidatePath('/advancement');
}

// ── Scouts ────────────────────────────────────────────────────────────────

export async function createScout(formData: FormData): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const id = String(formData.get('id') ?? '').trim();
  const firstName = String(formData.get('first_name') ?? '').trim();
  const lastName = String(formData.get('last_name') ?? '').trim();
  const patrol = String(formData.get('patrol') ?? '').trim() || null;
  // current_rank is intentionally not read from the form — it's computed
  // from rank_award ledger entries via trigger (see the insert below).
  const bsaMemberId = String(formData.get('bsa_member_id') ?? '').trim() || null;
  const active = formData.get('active') === 'on' || formData.get('active') === 'true';
  const inactiveReasonRaw = String(formData.get('inactive_reason') ?? '').trim();
  const VALID_REASONS = new Set(['dropped_out', 'transferred', 'moved_away', 'aged_out', 'other']);
  const inactiveReason = active ? null : (inactiveReasonRaw || null);
  if (!active && !inactiveReason) {
    return { ok: false, error: 'A reason is required when marking the scout inactive.' };
  }
  if (inactiveReason && !VALID_REASONS.has(inactiveReason)) {
    return { ok: false, error: `Invalid inactive reason: ${inactiveReason}` };
  }

  if (!id) return { ok: false, error: 'Scout ID is required' };
  if (!firstName || !lastName) {
    return { ok: false, error: 'First name and last name are required' };
  }

  const supabase = createAdminClient();
  const demo = { ...readDemoFields(formData), ...readScoutExtras(formData) };
  const { error } = await supabase.from('scouts').insert({
    id,
    first_name: firstName,
    last_name: lastName,
    display_name: `${firstName} ${lastName}`,
    patrol,
    current_rank: null, // computed from rank_award ledger entries via trigger
    bsa_member_id: bsaMemberId,
    active,
    inactive_reason: inactiveReason,
    joined_date: null,
    last_activity: null,
    ...demo
  });
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function updateScout(formData: FormData): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { ok: false, error: 'Scout ID is required' };
  const firstName = String(formData.get('first_name') ?? '').trim();
  const lastName = String(formData.get('last_name') ?? '').trim();
  const patrol = String(formData.get('patrol') ?? '').trim() || null;
  const bsaMemberId = String(formData.get('bsa_member_id') ?? '').trim() || null;
  const active = formData.get('active') === 'on' || formData.get('active') === 'true';
  const inactiveReasonRaw = String(formData.get('inactive_reason') ?? '').trim();
  const VALID_REASONS = new Set(['dropped_out', 'transferred', 'moved_away', 'aged_out', 'other']);
  const inactiveReason = active ? null : (inactiveReasonRaw || null);
  if (!active && !inactiveReason) {
    return { ok: false, error: 'A reason is required when marking the scout inactive.' };
  }
  if (inactiveReason && !VALID_REASONS.has(inactiveReason)) {
    return { ok: false, error: `Invalid inactive reason: ${inactiveReason}` };
  }

  if (!firstName || !lastName) {
    return { ok: false, error: 'First name and last name are required' };
  }

  const supabase = createAdminClient();
  const demo = { ...readDemoFields(formData), ...readScoutExtras(formData) };
  const { error } = await supabase
    .from('scouts')
    .update({
      first_name: firstName,
      last_name: lastName,
      display_name: `${firstName} ${lastName}`,
      patrol,
      // current_rank intentionally NOT updated here — the rank trigger keeps
      // it in sync with rank_award ledger rows.
      bsa_member_id: bsaMemberId,
      active,
      inactive_reason: inactiveReason,
      ...demo
    })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// ── Leaders ────────────────────────────────────────────────────────────────

function readLeaderTypeFields(formData: FormData) {
  const isPerson = String(formData.get('is_person') ?? 'true') !== 'false';
  const scoutId = String(formData.get('scout_id') ?? '').trim() || null;
  // Source rows (Camp, Clinic, ...) and adults never carry a scout link —
  // only Youth does. Guards against a stale scout_id surviving a Type switch.
  return { is_person: isPerson, scout_id: isPerson && scoutId ? scoutId : null };
}

function readLeaderLoginFields(formData: FormData) {
  const canLogin = String(formData.get('can_login') ?? 'true') !== 'false';
  const loginName = String(formData.get('login_name') ?? '').trim() || null;
  return { can_login: canLogin, login_name: loginName };
}

export async function createLeader(formData: FormData): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const role = String(formData.get('role') ?? '').trim() || null;
  if (!code) return { ok: false, error: 'Code (initials) is required' };
  if (!name) return { ok: false, error: 'Name is required' };

  const supabase = createAdminClient();
  const demo = { ...readDemoFields(formData), ...readLeaderExtras(formData) };
  const typeFields = readLeaderTypeFields(formData);
  const loginFields = readLeaderLoginFields(formData);
  const { error } = await supabase
    .from('leaders')
    .insert({ code, name, role, ...typeFields, ...loginFields, ...demo });
  if (error) {
    if (error.message.includes('duplicate key') || error.code === '23505') {
      return { ok: false, error: `Code "${code}" already exists` };
    }
    return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}

/** Tables with a `leader_code` FK to leaders.code (no ON UPDATE CASCADE). */
const LEADER_CODE_REFERRERS = [
  'merit_badge_counselors',
  'leader_skills',
  'meeting_attendance_leaders'
] as const;

export async function updateLeader(formData: FormData): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const originalCode = String(formData.get('original_code') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const role = String(formData.get('role') ?? '').trim() || null;
  if (!originalCode) return { ok: false, error: 'Missing original code' };
  if (!code) return { ok: false, error: 'Code is required' };
  if (!name) return { ok: false, error: 'Name is required' };

  const supabase = createAdminClient();
  const demo = { ...readDemoFields(formData), ...readLeaderExtras(formData) };
  const typeFields = readLeaderTypeFields(formData);
  const loginFields = readLeaderLoginFields(formData);

  if (code === originalCode) {
    const { error } = await supabase
      .from('leaders')
      .update({ name, role, ...typeFields, ...loginFields, ...demo })
      .eq('code', code);
    if (error) return { ok: false, error: error.message };
    revalidateAll();
    return { ok: true };
  }

  // Renaming the initials (the primary key). merit_badge_counselors,
  // leader_skills, and meeting_attendance_leaders all FK to leaders.code
  // without ON UPDATE CASCADE, so a direct rename would violate those
  // constraints. Instead: insert the row under the new code, repoint every
  // referencing table (including ledger_entries.by, which isn't an FK but
  // is matched by convention), then delete the old row — each step is valid
  // for the DB state at that moment.
  const { data: clash } = await supabase
    .from('leaders')
    .select('code')
    .eq('code', code)
    .maybeSingle();
  if (clash) return { ok: false, error: `Code "${code}" already exists` };

  const { data: original, error: fetchErr } = await supabase
    .from('leaders')
    .select('*')
    .eq('code', originalCode)
    .single();
  if (fetchErr || !original) {
    return { ok: false, error: fetchErr?.message ?? `Leader "${originalCode}" not found` };
  }

  const { error: insErr } = await supabase.from('leaders').insert({
    ...original,
    code,
    name,
    role,
    ...typeFields,
    ...loginFields,
    ...demo
  });
  if (insErr) return { ok: false, error: insErr.message };

  for (const table of LEADER_CODE_REFERRERS) {
    const { error: reassignErr } = await supabase
      .from(table)
      .update({ leader_code: code })
      .eq('leader_code', originalCode);
    if (reassignErr) {
      return { ok: false, error: `Reassigning ${table}: ${reassignErr.message}` };
    }
  }
  const { error: byErr } = await supabase
    .from('ledger_entries')
    .update({ by: code })
    .eq('by', originalCode);
  if (byErr) return { ok: false, error: `Reassigning ledger sign-offs: ${byErr.message}` };

  const { error: delErr } = await supabase.from('leaders').delete().eq('code', originalCode);
  if (delErr) return { ok: false, error: delErr.message };

  revalidateAll();
  return { ok: true };
}

export async function deleteLeader(formData: FormData): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const code = String(formData.get('code') ?? '').trim();
  if (!code) return { ok: false, error: 'Code is required' };

  const supabase = createAdminClient();
  // Refuse to delete if any ledger rows still reference this signer.
  const { count, error: countErr } = await supabase
    .from('ledger_entries')
    .select('id', { count: 'exact', head: true })
    .eq('by', code);
  if (countErr) return { ok: false, error: countErr.message };
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `Cannot delete: ${count} ledger entr${(count ?? 0) === 1 ? 'y' : 'ies'} still reference "${code}". Reassign or archive those first.`
    };
  }

  const { error } = await supabase.from('leaders').delete().eq('code', code);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// ── Merit Badges ───────────────────────────────────────────────────────────

export async function updateMeritBadge(formData: FormData): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const id = String(formData.get('id') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const eagle = formData.get('eagle') === 'on' || formData.get('eagle') === 'true';
  const scoutbookId = String(formData.get('scoutbook_id') ?? '').trim() || null;
  const bsaPageUrl = String(formData.get('bsa_page_url') ?? '').trim() || null;
  const workbookUrl = String(formData.get('workbook_url') ?? '').trim() || null;

  if (!id) return { ok: false, error: 'Merit Badge ID is required' };
  if (!name) return { ok: false, error: 'Name is required' };

  const supabase = createAdminClient();
  const counselors = readCounselors(formData);
  const reqTree = readReqTree(formData);

  // Code-rename safety: if any leaf code in the new tree differs from its
  // originalCode (existing id present), check whether the original code is
  // still referenced by an active ledger row. If so, refuse the save.
  if (reqTree) {
    const renames = collectRenames(reqTree);
    for (const { from, to } of renames) {
      const { count } = await supabase
        .from('ledger_active')
        .select('id', { count: 'exact', head: true })
        .eq('code', `${id}-${from}`);
      if ((count ?? 0) > 0) {
        return {
          ok: false,
          error: `Can't rename "${from}" → "${to}" — ${count} active ledger row${count === 1 ? '' : 's'} reference "${id}-${from}". Archive those entries first.`
        };
      }
    }
  }

  const { error } = await supabase
    .from('merit_badges')
    .update({
      name,
      eagle,
      scoutbook_id: scoutbookId,
      bsa_page_url: bsaPageUrl,
      workbook_url: workbookUrl
    })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  // Replace-on-save: wipe existing counselors for this MB, then re-insert in
  // the requested order.
  await supabase.from('merit_badge_counselors').delete().eq('mb_id', id);
  if (counselors.length > 0) {
    const rows = counselors.map((c, i) => ({
      mb_id: id,
      leader_code: c.leader_code,
      sort_order: i
    }));
    await supabase.from('merit_badge_counselors').insert(rows);
  }

  // Replace-on-save for the requirement tree. Walk depth-first inserting
  // parents before children so parent_id linkage is honored.
  if (reqTree) {
    await supabase.from('merit_badge_requirements').delete().eq('mb_id', id);
    await insertReqTree(supabase, id, reqTree, null);
  }

  revalidateAll();
  return { ok: true };
}

function collectRenames(
  tree: ReqInput[],
  acc: { from: string; to: string }[] = []
): { from: string; to: string }[] {
  for (const node of tree) {
    if (node.id && node.originalCode && node.originalCode !== node.code) {
      acc.push({ from: node.originalCode, to: node.code });
    }
    if (node.children?.length) collectRenames(node.children, acc);
  }
  return acc;
}

// ── Events (lookup for the Fast Entry Events tab) ───────────────────────────

/**
 * Creates an event, classified with a default_kind (Campout, Hike, Day
 * Outing, Fundraiser, ...) so Fast Entry can resolve the ledger kind
 * automatically every time this named event is picked again. Idempotent: a
 * duplicate name is treated as success (the event already exists, which is
 * the caller's goal — this lets the Fast Entry "+ New event" flow
 * fire-and-forget without error handling).
 */
export async function createEvent(formData: FormData): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Event name is required' };
  const defaultKindRaw = String(formData.get('default_kind') ?? '').trim();
  if (defaultKindRaw && !VALID_EVENT_KINDS.has(defaultKindRaw as LedgerKind)) {
    return { ok: false, error: 'Invalid event type' };
  }
  const defaultKind = defaultKindRaw || null;
  const startDate = String(formData.get('start_date') ?? '').trim() || null;

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('events')
    .insert({ name, default_kind: defaultKind, start_date: startDate });
  if (error) {
    if (error.code === '23505' || error.message.includes('duplicate key')) {
      return { ok: true }; // already exists — fine
    }
    return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}

export async function updateEvent(formData: FormData): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const id = Number(formData.get('id'));
  const name = String(formData.get('name') ?? '').trim();
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'Invalid event id' };
  if (!name) return { ok: false, error: 'Event name is required' };
  const defaultKindRaw = String(formData.get('default_kind') ?? '').trim();
  if (defaultKindRaw && !VALID_EVENT_KINDS.has(defaultKindRaw as LedgerKind)) {
    return { ok: false, error: 'Invalid event type' };
  }
  const defaultKind = defaultKindRaw || null;
  // start_date is only touched when the caller sends it — picker.tsx's
  // auto-heal-classification call only sends id/name/default_kind, and
  // must not silently wipe an event's date out from under it.
  const update: { name: string; default_kind: string | null; start_date?: string | null } = {
    name,
    default_kind: defaultKind
  };
  if (formData.has('start_date')) {
    update.start_date = String(formData.get('start_date') ?? '').trim() || null;
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from('events').update(update).eq('id', id);
  if (error) {
    if (error.code === '23505' || error.message.includes('duplicate key')) {
      return { ok: false, error: `An event named "${name}" already exists.` };
    }
    return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}

/**
 * Removes an event from the lookup. Safe: events aren't a foreign key for the
 * ledger, so existing entries keep their recorded label — this only drops the
 * name from the Fast Entry pull-down.
 */
export async function deleteEvent(formData: FormData): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const id = Number(formData.get('id'));
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'Invalid event id' };

  const supabase = createAdminClient();
  const { error } = await supabase.from('events').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// ── Service projects + Leadership positions (name-only lookups) ─────────────
//
// Same idempotent create / rename / delete shape as events, shared across both
// tables via helpers. Neither is a foreign key for the ledger.

async function insertNamedLookup(
  table: 'service_projects' | 'leadership_positions',
  formData: FormData
): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Name is required' };
  const supabase = createAdminClient();
  const { error } = await supabase.from(table).insert({ name });
  if (error) {
    if (error.code === '23505' || error.message.includes('duplicate key')) {
      return { ok: true }; // already exists — fine
    }
    return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}

async function updateNamedLookup(
  table: 'service_projects' | 'leadership_positions',
  formData: FormData
): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const id = Number(formData.get('id'));
  const name = String(formData.get('name') ?? '').trim();
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'Invalid id' };
  if (!name) return { ok: false, error: 'Name is required' };
  const supabase = createAdminClient();
  const { error } = await supabase.from(table).update({ name }).eq('id', id);
  if (error) {
    if (error.code === '23505' || error.message.includes('duplicate key')) {
      return { ok: false, error: `"${name}" already exists.` };
    }
    return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}

async function deleteNamedLookup(
  table: 'service_projects' | 'leadership_positions',
  formData: FormData
): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const id = Number(formData.get('id'));
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'Invalid id' };
  const supabase = createAdminClient();
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function createServiceProject(formData: FormData): Promise<Result> {
  return insertNamedLookup('service_projects', formData);
}
export async function updateServiceProject(formData: FormData): Promise<Result> {
  return updateNamedLookup('service_projects', formData);
}
export async function deleteServiceProject(formData: FormData): Promise<Result> {
  return deleteNamedLookup('service_projects', formData);
}

export async function createLeadershipPosition(formData: FormData): Promise<Result> {
  return insertNamedLookup('leadership_positions', formData);
}
export async function updateLeadershipPosition(formData: FormData): Promise<Result> {
  return updateNamedLookup('leadership_positions', formData);
}
export async function deleteLeadershipPosition(formData: FormData): Promise<Result> {
  return deleteNamedLookup('leadership_positions', formData);
}

async function insertReqTree(
  supabase: ReturnType<typeof createAdminClient>,
  mbId: string,
  nodes: ReqInput[],
  parentDbId: number | null
): Promise<void> {
  let sortOrder = 0;
  for (const node of nodes) {
    if (!node.code.trim() || !node.label.trim()) continue;
    const { data, error } = await supabase
      .from('merit_badge_requirements')
      .insert({
        mb_id: mbId,
        parent_id: parentDbId,
        code: node.code.trim(),
        label: node.label.trim(),
        complete_rule: node.complete_rule,
        complete_n: node.complete_rule === 'n-of' ? node.complete_n : null,
        sort_order: sortOrder
      })
      .select('id')
      .single();
    if (error) throw new Error(`req ${node.code}: ${error.message}`);
    sortOrder++;
    if (node.children?.length) {
      await insertReqTree(supabase, mbId, node.children, data.id);
    }
  }
}

// ── Skills & teaching (Meeting Plan) ──────────────────────────────────────

function slugifySkillId(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function createSkill(formData: FormData): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Skill name is required' };
  const id = slugifySkillId(name);
  if (!id) return { ok: false, error: 'Skill name must contain letters' };
  const youthTeachable = String(formData.get('youth_teachable') ?? '') === 'true';

  const supabase = createAdminClient();
  const { data: maxRow } = await supabase
    .from('skills')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1);
  const sortOrder = ((maxRow?.[0]?.sort_order as number | undefined) ?? 0) + 10;
  const { error } = await supabase
    .from('skills')
    .insert({ id, name, youth_teachable: youthTeachable, sort_order: sortOrder });
  if (error) {
    if (error.code === '23505' || error.message.includes('duplicate key')) {
      return { ok: false, error: 'That skill already exists' };
    }
    return { ok: false, error: error.message };
  }
  revalidateAll();
  revalidatePath('/admin/advancement/meeting-plan');
  return { ok: true };
}

export async function updateSkill(formData: FormData): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const id = String(formData.get('id') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  if (!id || !name) return { ok: false, error: 'Skill id and name are required' };
  const youthTeachable = String(formData.get('youth_teachable') ?? '') === 'true';

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('skills')
    .update({ name, youth_teachable: youthTeachable })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  revalidatePath('/admin/advancement/meeting-plan');
  return { ok: true };
}

export async function deleteSkill(formData: FormData): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { ok: false, error: 'Missing skill id' };

  const supabase = createAdminClient();
  // rank_requirements.skill_id has no ON DELETE rule, so clear references
  // first (leader_skills / scout_instructors cascade on their own).
  const { error: reqErr } = await supabase
    .from('rank_requirements')
    .update({ skill_id: null })
    .eq('skill_id', id);
  if (reqErr) return { ok: false, error: reqErr.message };
  const { error } = await supabase.from('skills').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  revalidatePath('/admin/advancement/meeting-plan');
  return { ok: true };
}

function readSkillIds(formData: FormData): string[] | null {
  try {
    const arr = JSON.parse(String(formData.get('skill_ids') ?? '[]')) as unknown;
    if (!Array.isArray(arr)) return null;
    return arr.filter((s): s is string => typeof s === 'string' && s.trim() !== '');
  } catch {
    return null;
  }
}

/** Replace a leader's full skill set (delete + insert). */
export async function setLeaderSkills(formData: FormData): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const leaderCode = String(formData.get('leader_code') ?? '').trim();
  const skillIds = readSkillIds(formData);
  if (!leaderCode || skillIds === null) return { ok: false, error: 'Malformed payload' };

  const supabase = createAdminClient();
  const { error: delErr } = await supabase
    .from('leader_skills')
    .delete()
    .eq('leader_code', leaderCode);
  if (delErr) return { ok: false, error: delErr.message };
  if (skillIds.length > 0) {
    const { error } = await supabase
      .from('leader_skills')
      .insert(skillIds.map((skill_id) => ({ leader_code: leaderCode, skill_id })));
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath('/admin/advancement/lookups');
  revalidatePath('/admin/advancement/meeting-plan');
  return { ok: true };
}

/** Replace a scout instructor's authorized skill set (delete + insert). */
export async function setScoutInstructorSkills(formData: FormData): Promise<Result> {
  const session = await (async () => {
    try {
      return await ensureLeader();
    } catch {
      return null;
    }
  })();
  if (!session) return { ok: false, error: 'Not authenticated' };

  const scoutId = String(formData.get('scout_id') ?? '').trim();
  const skillIds = readSkillIds(formData);
  if (!scoutId || skillIds === null) return { ok: false, error: 'Malformed payload' };

  const supabase = createAdminClient();

  // Guard: only youth-teachable skills can be authorized.
  if (skillIds.length > 0) {
    const { data: skillRows, error: skillErr } = await supabase
      .from('skills')
      .select('id, youth_teachable')
      .in('id', skillIds);
    if (skillErr) return { ok: false, error: skillErr.message };
    const bad = skillIds.filter(
      (id) => !(skillRows ?? []).some((s) => s.id === id && s.youth_teachable)
    );
    if (bad.length > 0) {
      return { ok: false, error: `Not youth-teachable: ${bad.join(', ')}` };
    }
  }

  const { error: delErr } = await supabase
    .from('scout_instructors')
    .delete()
    .eq('scout_id', scoutId);
  if (delErr) return { ok: false, error: delErr.message };
  if (skillIds.length > 0) {
    const { error } = await supabase.from('scout_instructors').insert(
      skillIds.map((skill_id) => ({
        scout_id: scoutId,
        skill_id,
        authorized_by: session.leader ?? null
      }))
    );
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath('/admin/advancement/lookups');
  revalidatePath('/admin/advancement/meeting-plan');
  return { ok: true };
}

/**
 * Promotes a scout who has turned 18 to adult status (Patrick, 2026-07-12).
 *
 * One source of truth, no age flag: a youth leader is a `leaders` row whose
 * scout_id points at an ACTIVE scout. Promotion therefore just (1) marks the
 * scout inactive with reason 'aged_out' (ledger history and clipboard are
 * preserved), and (2) ensures a linked leaders row exists so their initials
 * keep working for sign-offs — which now count as an ADULT everywhere (Leader
 * Skills picker, Meeting Plan teacher pool, leader Roll Call).
 *
 * Caveat surfaced in the UI: Fast Entry lists active scouts only, so record
 * any outstanding requirement sign-offs (e.g. an Eagle Board of Review still
 * inside the six-month window) BEFORE promoting, or temporarily re-activate.
 */
export async function promoteScoutToAdult(formData: FormData): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const scoutId = String(formData.get('scout_id') ?? '').trim();
  if (!scoutId) return { ok: false, error: 'Missing scout id.' };

  const supabase = createAdminClient();
  const { data: scout, error: scoutErr } = await supabase
    .from('scouts')
    .select('id, display_name, first_name, last_name, active')
    .eq('id', scoutId)
    .maybeSingle();
  if (scoutErr) return { ok: false, error: scoutErr.message };
  if (!scout) return { ok: false, error: 'Scout not found.' };

  // 1. Age the scout out (idempotent).
  const { error: updErr } = await supabase
    .from('scouts')
    .update({ active: false, inactive_reason: 'aged_out' })
    .eq('id', scoutId);
  if (updErr) return { ok: false, error: updErr.message };

  // 2. Ensure a linked leaders row so their initials exist as an adult.
  const { data: linked } = await supabase
    .from('leaders')
    .select('code')
    .eq('scout_id', scoutId)
    .maybeSingle();
  let leaderCode = linked?.code as string | undefined;

  if (!leaderCode) {
    const base = (
      (scout.first_name?.[0] ?? '') + (scout.last_name?.[0] ?? '')
    ).toUpperCase() || scoutId.toUpperCase();
    const { data: existing } = await supabase.from('leaders').select('code');
    const taken = new Set((existing ?? []).map((r) => r.code as string));
    let candidate = base;
    for (let n = 2; taken.has(candidate); n++) candidate = `${base}${n}`;
    leaderCode = candidate;
    const { error: insErr } = await supabase.from('leaders').insert({
      code: candidate,
      name: scout.display_name,
      is_person: true,
      scout_id: scoutId
    });
    if (insErr) return { ok: false, error: insErr.message };
  }

  revalidateAll();
  return { ok: true };
}

// ── Tags ──────────────────────────────────────────────────────────────────
// Moved into Lookups & Admin (was its own /admin/news/tags page) — one place
// for the troop's editable taxonomy instead of two.

export async function createTag(formData: FormData): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Tag name is required.' };

  const supabase = createAdminClient();
  const { error } = await supabase.from('tags').insert({ name, slug: slugify(name) });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/advancement/lookups');
  return { ok: true };
}

/** Deletes a tag. Cascades to remove it from any article that had it (article_tags FK). */
export async function deleteTag(id: number): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const supabase = createAdminClient();
  const { error } = await supabase.from('tags').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/advancement/lookups');
  return { ok: true };
}

// ── Internal Requirement Codes (top-level rows) ─────────────────────────────

/**
 * Edits a top-level rank/MB requirement's code + label. ledger_entries.code
 * stores `<parentId>-<code>` for these (Fast Entry's picker and the award-
 * gating check in fast-entry/actions.ts both match on that composite), so a
 * code rename cascades to every ledger row already recorded under the old
 * composite — otherwise already-completed requirements would silently stop
 * counting toward the rank/MB.
 */
export async function updateReqCode(formData: FormData): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const id = Number(formData.get('id'));
  const source = String(formData.get('source') ?? '');
  const parentId = String(formData.get('parent_id') ?? '').trim();
  const originalCode = String(formData.get('original_code') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim();
  const label = String(formData.get('label') ?? '').trim();
  const officialText = String(formData.get('official_text') ?? '').trim();
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'Invalid row id' };
  if (source !== 'rank' && source !== 'mb') return { ok: false, error: 'Invalid source' };
  if (!code) return { ok: false, error: 'Code is required' };
  if (!label) return { ok: false, error: 'Label is required' };

  const table = source === 'rank' ? 'rank_requirements' : 'merit_badge_requirements';
  const parentField = source === 'rank' ? 'rank_id' : 'mb_id';
  const kind: LedgerKind = source === 'rank' ? 'rank_requirement' : 'merit_badge_requirement';

  const supabase = createAdminClient();

  if (code !== originalCode) {
    const { data: clash } = await supabase
      .from(table)
      .select('id')
      .eq(parentField, parentId)
      .eq('code', code)
      .neq('id', id)
      .maybeSingle();
    if (clash) {
      return { ok: false, error: `Code "${code}" is already used elsewhere in this ${source === 'rank' ? 'rank' : 'merit badge'}` };
    }
  }

  const { error } = await supabase.from(table).update({ code, label }).eq('id', id);
  if (error) return { ok: false, error: error.message };

  if (code !== originalCode) {
    const { error: cascadeErr } = await supabase
      .from('ledger_entries')
      .update({ code: `${parentId}-${code}` })
      .eq('kind', kind)
      .eq('code', `${parentId}-${originalCode}`);
    if (cascadeErr) {
      return {
        ok: false,
        error: `Catalog renamed, but couldn't update matching ledger entries: ${cascadeErr.message}`
      };
    }

    // Resource Library rides the same composite codes (Plans/Resource-Library.md)
    // — placements, narratives, and proof submissions keyed to the old code
    // follow the rename, or requirement pages would silently orphan their
    // content (the exact bug class D-019 exists to prevent). NOTE: if
    // sub-requirement renaming ever ships (top-level only today), it must
    // carry this same cascade.
    const libErr = await cascadeLibraryReqRename(supabase, source, parentId, originalCode, code);
    if (libErr) {
      return {
        ok: false,
        error: `Catalog and ledger renamed, but couldn't update Resource Library rows: ${libErr}`
      };
    }

    // Official text rides the same composite key — follow the rename so a
    // pasted-in requirement doesn't silently orphan under the old code.
    await supabase
      .from('requirement_official_text')
      .update({ code })
      .eq('source', source)
      .eq('parent_id', parentId)
      .eq('code', originalCode);
  }

  if (officialText) {
    const { error: textErr } = await supabase
      .from('requirement_official_text')
      .upsert(
        { source, parent_id: parentId, code, official_text: officialText },
        { onConflict: 'source,parent_id,code' }
      );
    if (textErr) {
      return { ok: false, error: `Catalog saved, but official text failed to save: ${textErr.message}` };
    }
  } else {
    await supabase
      .from('requirement_official_text')
      .delete()
      .eq('source', source)
      .eq('parent_id', parentId)
      .eq('code', code);
  }

  revalidateAll();
  return { ok: true };
}
