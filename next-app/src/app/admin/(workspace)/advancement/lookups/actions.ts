'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { createAdminClient } from '@/lib/supabase/server';
import type { LedgerKind } from '@/lib/supabase/types';

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
    health_form_date: str('health_form_date'),
    birthdate: str('birthdate')
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
  const demo = { ...readDemoFields(formData), ...readScoutExtras(formData) };
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
  const demo = { ...readDemoFields(formData), ...readScoutExtras(formData) };
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
  const demo = { ...readDemoFields(formData), ...readLeaderExtras(formData) };
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
  const demo = { ...readDemoFields(formData), ...readLeaderExtras(formData) };
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

  const supabase = createAdminClient();
  const { error } = await supabase.from('events').insert({ name, default_kind: defaultKind });
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

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('events')
    .update({ name, default_kind: defaultKind })
    .eq('id', id);
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
