'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import type { MeetingSection, SessionRequirementRef } from '@/lib/supabase/types';

type ActionResult = { ok: boolean; error?: string };
type CreateResult = { ok: boolean; error?: string; id?: number };

/*
 * Calendar unification: a meeting is the agenda layer of a calendar entry, so
 * its public home is /events/[entryId]. The old /meetings/[date] permalink is
 * deleted — with several meetings allowed on one date it could not address them
 * anyway — and nothing here revalidates a date-keyed path any more.
 */
function revalidateMeetings(meetingId?: number, entryId?: number) {
  revalidatePath('/admin/advancement/meetings');
  revalidatePath('/admin/calendar');
  if (meetingId) revalidatePath(`/admin/advancement/meetings/${meetingId}`);
  if (entryId) {
    revalidatePath(`/admin/calendar/${entryId}`);
    revalidatePath(`/events/${entryId}`);
  }
  revalidatePath('/events');
}

/** The calendar entry a meeting is the agenda layer of. */
async function entryIdOf(meetingId: number): Promise<number | undefined> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('meetings')
    .select('calendar_entry_id')
    .eq('id', meetingId)
    .maybeSingle();
  return (data?.calendar_entry_id as number) ?? undefined;
}

// ── meetings ────────────────────────────────────────────────────────────────

/**
 * Adds the agenda layer to a calendar entry, with the troop's standing
 * defaults; the editor refines. Keyed by ENTRY, not by date — the entry already
 * exists (it is what the leader is looking at) and it owns the date.
 *
 * `meeting_date` is still written because the column is NOT NULL until it is
 * dropped, but it is copied from the entry rather than supplied by the caller,
 * so the two can no longer disagree. Nothing reads it.
 */
export async function createMeeting(fd: FormData): Promise<CreateResult> {
  const session = await requireCapability('advancement.write');
  const entryId = Number(fd.get('calendar_entry_id'));
  if (!Number.isInteger(entryId) || entryId <= 0) {
    return { ok: false, error: 'Missing calendar entry.' };
  }

  const supabase = createAdminClient();
  const { data: entry } = await supabase
    .from('calendar_entries')
    .select('entry_date, title, location')
    .eq('id', entryId)
    .maybeSingle();
  if (!entry) return { ok: false, error: 'That calendar entry no longer exists.' };

  const { data, error } = await supabase
    .from('meetings')
    .insert({
      calendar_entry_id: entryId,
      meeting_date: entry.entry_date,
      title: String(fd.get('title') ?? '').trim() || entry.title || 'Troop Meeting',
      time_range: '4:00 – 5:30 PM',
      location: entry.location ?? 'Northwoods',
      location_address: '1572 E Capitol Drive, Milwaukee, WI',
      updated_by: session.label
    })
    .select('id')
    .single();
  if (error) {
    // 23505 is now the one-agenda-per-entry index, not the old
    // one-meeting-per-date rule — several meetings on one date are fine.
    if (error.code === '23505') return { ok: false, error: 'This entry already has an agenda.' };
    return { ok: false, error: error.message };
  }
  revalidateMeetings(undefined, entryId);
  return { ok: true, id: data.id as number };
}

/** Logistics only. The DATE is not editable here any more — it belongs to the
 *  calendar entry, and letting the layer edit it is exactly how the two used to
 *  drift apart. */
export async function updateMeeting(fd: FormData): Promise<ActionResult> {
  const session = await requireCapability('advancement.write');
  const id = Number(fd.get('id'));
  if (!id) return { ok: false, error: 'Missing meeting id.' };

  const str = (name: string) => String(fd.get(name) ?? '').trim() || null;
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('meetings')
    .update({
      title: String(fd.get('title') ?? '').trim() || 'Troop Meeting',
      time_range: str('time_range'),
      uniform: str('uniform'),
      location: str('location'),
      location_address: str('location_address'),
      snack: str('snack'),
      flag_ceremony: str('flag_ceremony'),
      cleanup: str('cleanup'),
      duty_roster_url: str('duty_roster_url'),
      updated_by: session.label,
      updated_at: new Date().toISOString()
    })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateMeetings(id, await entryIdOf(id));
  return { ok: true };
}

export async function setMeetingStatus(id: number, status: 'draft' | 'published'): Promise<ActionResult> {
  const session = await requireCapability('advancement.write');
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('meetings')
    .update({ status, updated_by: session.label, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateMeetings(id, await entryIdOf(id));
  return { ok: true };
}

/** Hard delete of the AGENDA LAYER only (sessions cascade) — the calendar entry
 *  it hung off survives. The UI confirms first. */
export async function deleteMeeting(id: number): Promise<ActionResult> {
  await requireCapability('advancement.write');
  const entryId = await entryIdOf(id);
  const supabase = createAdminClient();
  const { error } = await supabase.from('meetings').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateMeetings(undefined, entryId);
  return { ok: true };
}

// ── sessions ────────────────────────────────────────────────────────────────

/** "Anjali S., Finn P." → ["Anjali S.", "Finn P."] (also accepts newlines). */
function parseScouts(raw: string): string[] | null {
  const names = raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return names.length ? names : null;
}

function sessionFieldsFromForm(fd: FormData) {
  const section = String(fd.get('section') ?? 'agenda') as MeetingSection;
  return {
    section: section === 'pre_meeting' ? 'pre_meeting' : 'agenda',
    time_label: String(fd.get('time_label') ?? '').trim() || null,
    title: String(fd.get('title') ?? '').trim(),
    description: String(fd.get('description') ?? '').trim() || null,
    track: String(fd.get('track') ?? '').trim() || null,
    leader_name: String(fd.get('leader_name') ?? '').trim() || null,
    contact_name: String(fd.get('contact_name') ?? '').trim() || null,
    contact_phone: String(fd.get('contact_phone') ?? '').trim() || null,
    scouts: parseScouts(String(fd.get('scouts') ?? ''))
  };
}

async function nextSortOrder(meetingId: number, section: string): Promise<number> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('meeting_sessions')
    .select('sort_order')
    .eq('meeting_id', meetingId)
    .eq('section', section)
    .order('sort_order', { ascending: false })
    .limit(1);
  return (data?.[0]?.sort_order ?? 0) + 10;
}

export async function createSession(fd: FormData): Promise<ActionResult> {
  await requireCapability('advancement.write');
  const meetingId = Number(fd.get('meeting_id'));
  const fields = sessionFieldsFromForm(fd);
  if (!meetingId) return { ok: false, error: 'Missing meeting id.' };
  if (!fields.title) return { ok: false, error: 'Title is required.' };

  const supabase = createAdminClient();
  const { error } = await supabase.from('meeting_sessions').insert({
    meeting_id: meetingId,
    sort_order: await nextSortOrder(meetingId, fields.section),
    ...fields
  });
  if (error) return { ok: false, error: error.message };
  revalidateMeetings(meetingId, await entryIdOf(meetingId));
  return { ok: true };
}

export async function updateSession(fd: FormData): Promise<ActionResult> {
  await requireCapability('advancement.write');
  const id = Number(fd.get('id'));
  const meetingId = Number(fd.get('meeting_id'));
  const fields = sessionFieldsFromForm(fd);
  if (!id || !meetingId) return { ok: false, error: 'Missing ids.' };
  if (!fields.title) return { ok: false, error: 'Title is required.' };

  const supabase = createAdminClient();
  const { error } = await supabase.from('meeting_sessions').update(fields).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateMeetings(meetingId, await entryIdOf(meetingId));
  return { ok: true };
}

export async function deleteSession(id: number, meetingId: number): Promise<ActionResult> {
  await requireCapability('advancement.write');
  const supabase = createAdminClient();
  const { error } = await supabase.from('meeting_sessions').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateMeetings(meetingId, await entryIdOf(meetingId));
  return { ok: true };
}

/** Swaps sort_order with the neighbor above/below within the same section. */
export async function moveSession(id: number, meetingId: number, direction: 'up' | 'down'): Promise<ActionResult> {
  await requireCapability('advancement.write');
  const supabase = createAdminClient();

  const { data: row } = await supabase
    .from('meeting_sessions')
    .select('id, section, sort_order')
    .eq('id', id)
    .maybeSingle();
  if (!row) return { ok: false, error: 'Session not found.' };

  const neighborQuery = supabase
    .from('meeting_sessions')
    .select('id, sort_order')
    .eq('meeting_id', meetingId)
    .eq('section', row.section)
    .limit(1);
  const { data: neighbors } =
    direction === 'up'
      ? await neighborQuery.lt('sort_order', row.sort_order).order('sort_order', { ascending: false })
      : await neighborQuery.gt('sort_order', row.sort_order).order('sort_order', { ascending: true });
  const neighbor = neighbors?.[0];
  if (!neighbor) return { ok: true }; // already at the edge

  const [a, b] = await Promise.all([
    supabase.from('meeting_sessions').update({ sort_order: neighbor.sort_order }).eq('id', row.id),
    supabase.from('meeting_sessions').update({ sort_order: row.sort_order }).eq('id', neighbor.id)
  ]);
  const error = a.error ?? b.error;
  if (error) return { ok: false, error: error.message };
  revalidateMeetings(meetingId, await entryIdOf(meetingId));
  return { ok: true };
}

// ── plan-candidate promotion ────────────────────────────────────────────────

export interface PromotePayload {
  meetingId: number;
  title: string;
  description: string | null;
  track: string | null;
  leaderName: string | null;
  skillId: string | null;
  requirements: SessionRequirementRef[] | null;
  scouts: string[] | null;
}

/**
 * Copies one Meeting Plan suggestion into the agenda as an editable session.
 * One-way: the plan snapshot and engine data are never touched.
 */
export async function promotePlanSession(payload: PromotePayload): Promise<ActionResult> {
  await requireCapability('advancement.write');
  const { meetingId, title } = payload;
  if (!meetingId || !title.trim()) return { ok: false, error: 'Malformed candidate.' };

  const supabase = createAdminClient();
  const { error } = await supabase.from('meeting_sessions').insert({
    meeting_id: meetingId,
    section: 'agenda',
    sort_order: await nextSortOrder(meetingId, 'agenda'),
    title: title.trim(),
    description: payload.description,
    track: payload.track,
    leader_name: payload.leaderName,
    skill_id: payload.skillId,
    requirements: payload.requirements,
    scouts: payload.scouts
  });
  if (error) return { ok: false, error: error.message };
  revalidateMeetings(meetingId, await entryIdOf(meetingId));
  return { ok: true };
}
