'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { createAdminClient } from '@/lib/supabase/server';

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
}

interface ParentInput {
  name: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  same_address_as_scout: boolean;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
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
    health_form_date: str('health_form_date')
  };
}

function readParents(formData: FormData): ParentInput[] {
  const raw = String(formData.get('parents') ?? '[]');
  try {
    const arr = JSON.parse(raw) as ParentInput[];
    if (!Array.isArray(arr)) return [];
    return arr.filter((p) => p && p.name && p.name.trim() !== '');
  } catch {
    return [];
  }
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
  const jar = await cookies();
  const session = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  if (!session) throw new Error('Not authenticated');
  return session;
}

function revalidateAll() {
  revalidatePath('/admin/advancement/lookups');
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
  const currentRank = String(formData.get('current_rank') ?? '').trim() || null;
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
  const demo = readDemoFields(formData);
  const parents = readParents(formData);
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
  await replaceParents(supabase, id, parents);
  revalidateAll();
  return { ok: true };
}

async function replaceParents(
  supabase: ReturnType<typeof createAdminClient>,
  scoutId: string,
  parents: ParentInput[]
): Promise<void> {
  // Replace-on-save: wipe existing parents for this scout, then re-insert.
  await supabase.from('scout_parents').delete().eq('scout_id', scoutId);
  if (parents.length === 0) return;
  const rows = parents.map((p, i) => ({
    scout_id: scoutId,
    name: p.name.trim(),
    relationship: p.relationship,
    phone: p.phone,
    email: p.email,
    same_address_as_scout: p.same_address_as_scout,
    address_line1: p.same_address_as_scout ? null : p.address_line1,
    address_line2: p.same_address_as_scout ? null : p.address_line2,
    city: p.same_address_as_scout ? null : p.city,
    state: p.same_address_as_scout ? null : p.state,
    zip: p.same_address_as_scout ? null : p.zip,
    sort_order: i
  }));
  await supabase.from('scout_parents').insert(rows);
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
  const demo = readDemoFields(formData);
  const parents = readParents(formData);
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
  await replaceParents(supabase, id, parents);
  revalidateAll();
  return { ok: true };
}

// ── Leaders ────────────────────────────────────────────────────────────────

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
  const demo = readDemoFields(formData);
  const { error } = await supabase
    .from('leaders')
    .insert({ code, name, role, ...demo });
  if (error) {
    if (error.message.includes('duplicate key') || error.code === '23505') {
      return { ok: false, error: `Code "${code}" already exists` };
    }
    return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}

export async function updateLeader(formData: FormData): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const role = String(formData.get('role') ?? '').trim() || null;
  if (!code) return { ok: false, error: 'Code is required' };
  if (!name) return { ok: false, error: 'Name is required' };

  const supabase = createAdminClient();
  const demo = readDemoFields(formData);
  const { error } = await supabase
    .from('leaders')
    .update({ name, role, ...demo })
    .eq('code', code);
  if (error) return { ok: false, error: error.message };
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
 * Creates an event name. Idempotent: a duplicate name is treated as success
 * (the event already exists, which is the caller's goal — this lets the Fast
 * Entry "+ New event" flow fire-and-forget without error handling).
 */
export async function createEvent(formData: FormData): Promise<Result> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Event name is required' };

  const supabase = createAdminClient();
  const { error } = await supabase.from('events').insert({ name });
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

  const supabase = createAdminClient();
  const { error } = await supabase.from('events').update({ name }).eq('id', id);
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
