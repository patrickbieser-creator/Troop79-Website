'use server';

/**
 * This week's writes (Plans/Meeting-Planner-III.md, P2). Each is gated before the database is touched
 * (lib/meeting-planner-seeder: an upcoming, published, open meeting, one of the next PLANNER_WEEKS):
 *   - the focus and the night's merit badges: the planning team (seed);
 *   - hand placement and teacher slots: editors (edit), the SPL included.
 * Every write returns the board's stamp after it, so the page's poller doesn't refresh over its own change; the page
 * refreshes once the write lands (PlannerProvider's sync.run).
 */
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { loadBoardStamp, loadUpcomingMeetings } from '@/lib/meeting-board';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { loadPlannerLists } from '@/lib/people-lists';
import { seedFocusSet, seedMany, unseedTopic } from '@/lib/meeting-focus-db';
import { teachTopic, unteachTopic } from '@/lib/meeting-board-supply';
import { plannerSeeder } from '@/lib/meeting-planner-seeder';
import { PLANNER_WEEKS } from '@/lib/this-week';
import { isGroupKey } from '@/lib/focus-plan';

export type TwResult = { ok: true; stamp: string } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const gate = (entryId: unknown, right: 'seed' | 'edit') => plannerSeeder(entryId, { within: PLANNER_WEEKS, right });
type Gate = Extract<Awaited<ReturnType<typeof gate>>, { ok: true }>;
const done = async (s: Gate): Promise<TwResult> => ({ ok: true, stamp: await loadBoardStamp(s.sb, s.meeting.entryId) });

const FG_KEY = /^fg:\d{1,18}$/;
const GROUP_KEY = /^fr:(mb:)?[a-z0-9][a-z0-9-]{0,80}$/;
const MB_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
/** A topic a scout can be placed in from requests and offers: a requirement, a badge or a freeform topic. */
const REQUEST_KEY = /^((mb|ff):.{1,100}|[a-z0-9][a-z0-9.-]{0,118}[a-z0-9])$/i;

/** Add a focus set to the night's focus. Adding it again changes nothing. */
export async function twAddFocusSetAction(input: { entryId: number; setId: number }): Promise<TwResult> {
  if (!Number.isInteger(input?.setId)) return fail('Malformed request');
  const s = await gate(input.entryId, 'seed');
  if (!s.ok) return s;
  const res = await seedFocusSet(s.sb, s.meeting.entryId, input.setId, s.actorPersonId);
  return res.ok ? done(s) : res;
}

/** Take a focus set off the night's focus. Its groups go with it unless another set still covers them. */
export async function twRemoveFocusAction(input: { entryId: number; key: string }): Promise<TwResult> {
  if (typeof input?.key !== 'string' || !FG_KEY.test(input.key)) return fail('Malformed request');
  const s = await gate(input.entryId, 'seed');
  if (!s.ok) return s;
  const res = await unseedTopic(s.sb, s.meeting.entryId, input.key);
  return res.ok ? done(s) : res;
}

/** Add a merit badge to the night, or take one off (`on`). A badge in the focus stays while its set does. */
export async function twSetNightBadgeAction(input: { entryId: number; mbId: string; on: boolean }): Promise<TwResult> {
  if (typeof input?.mbId !== 'string' || !MB_ID.test(input.mbId) || typeof input.on !== 'boolean') return fail('Malformed request');
  const s = await gate(input.entryId, 'seed');
  if (!s.ok) return s;
  const q = input.on
    ? s.sb.from('meeting_night_badges').upsert({ calendar_entry_id: s.meeting.entryId, mb_id: input.mbId, added_by_person_id: s.actorPersonId }, { onConflict: 'calendar_entry_id,mb_id', ignoreDuplicates: true })
    : s.sb.from('meeting_night_badges').delete().eq('calendar_entry_id', s.meeting.entryId).eq('mb_id', input.mbId);
  const { error } = await q;
  if (error) return fail(error.code === '23503' ? 'That merit badge isn’t in the catalog.' : 'Couldn’t save that. Try again.');
  return done(s);
}

export type RoleInput = { role: 'teach' } | { role: 'group'; key: string } | { role: 'request'; key: string } | { role: null };

/**
 * A planner's hand choice for one scout: Teach (help teach), a group (a gap fill, or an older scout's badge), a class
 * from requests and offers, or null to let placement decide again (Unassign: the family's "help teach" goes too).
 */
export async function twSetRoleAction(input: { entryId: number; personId: number } & RoleInput): Promise<TwResult> {
  if (!Number.isInteger(input?.personId)) return fail('Malformed request');
  const role = input.role;
  if (role === 'group' && !(typeof input.key === 'string' && GROUP_KEY.test(input.key))) return fail('Malformed request');
  if (role === 'request' && !(typeof input.key === 'string' && REQUEST_KEY.test(input.key) && !isGroupKey(input.key))) return fail('Malformed request');
  if (role !== null && role !== 'teach' && role !== 'group' && role !== 'request') return fail('Malformed request');
  const s = await gate(input.entryId, 'edit');
  if (!s.ok) return s;
  const { data: scout, error: se } = await s.sb.from('scouts').select('id').eq('person_id', input.personId).eq('active', true).maybeSingle();
  if (se) return fail('Couldn’t save that. Try again.');
  if (!scout) return fail('That isn’t an active scout.');
  const where = { calendar_entry_id: s.meeting.entryId, person_id: input.personId };
  const helpers = role === null ? await s.sb.from('meeting_scout_helpers').delete().match(where) : { error: null };
  if (helpers.error) return fail('Couldn’t save that. Try again.');
  const { error } =
    role === null
      ? await s.sb.from('meeting_scout_roles').delete().match(where)
      : await s.sb
          .from('meeting_scout_roles')
          .upsert({ ...where, role, ref_key: role === 'teach' ? null : input.key, set_by_person_id: s.actorPersonId, set_at: new Date().toISOString() }, { onConflict: 'calendar_entry_id,person_id' });
  if (error) return fail('Couldn’t save that. Try again.');
  return done(s);
}

/**
 * A group's or extra class's teachers (any number): `on` adds `personId`, off takes them off; a null `personId` clears
 * every teacher. A group's topic row is made on first use. The teach RPC re-checks who may teach.
 */
export async function twSetTeacherAction(input: { entryId: number; key: string; personId: number | null; on: boolean }): Promise<TwResult> {
  if (
    typeof input?.key !== 'string' ||
    !(GROUP_KEY.test(input.key) || REQUEST_KEY.test(input.key)) ||
    (input.personId !== null && !Number.isInteger(input.personId)) ||
    typeof input.on !== 'boolean'
  ) {
    return fail('Malformed request');
  }
  const s = await gate(input.entryId, 'edit');
  if (!s.ok) return s;
  if (!isGroupKey(input.key)) {
    // Only a class already on this meeting: an edit-only holder must not put a new topic on it (qa-lead B2 #4).
    const { data: onPlan } = await s.sb.from('meeting_topics').select('id').eq('calendar_entry_id', s.meeting.entryId).eq('topic_key', input.key).maybeSingle();
    if (!onPlan) return fail('That isn’t on this meeting’s plan.');
  }
  const { data: rows, error } = await s.sb
    .from('meeting_topic_teachers')
    .select('person_id, meeting_topics!inner(topic_key)')
    .eq('calendar_entry_id', s.meeting.entryId)
    .eq('meeting_topics.topic_key', input.key);
  if (error) return fail('Couldn’t save that. Try again.');
  const current = ((rows ?? []) as { person_id: number }[]).map((r) => r.person_id);
  if (input.personId != null && input.on && !current.includes(input.personId)) {
    const res = await teachTopic(s.sb, { personId: input.personId, actorPersonId: s.actorPersonId, leader: true }, [s.meeting.entryId], { key: input.key }, null);
    if (!res.ok) return res;
  }
  for (const id of current) {
    if (input.personId != null && (id !== input.personId || input.on)) continue;
    const res = await unteachTopic(s.sb, { personId: id, actorPersonId: s.actorPersonId, leader: true }, s.meeting.entryId, input.key);
    if (!res.ok) return res;
  }
  return done(s);
}

/**
 * Live at the meeting (Decision 10): tap a name to mark them here, or not. A draft (meeting_live_presence); attendance
 * is approved after the meeting (B8). The meeting day only; an active scout or an adult on the roster.
 */
export async function twSetPresentAction(input: { entryId: number; personId: number; present: boolean }): Promise<TwResult> {
  if (!Number.isInteger(input?.personId) || typeof input.present !== 'boolean') return fail('Malformed request');
  const s = await gate(input.entryId, 'edit');
  if (!s.ok) return s;
  if (s.meeting.date !== centralToday()) return fail('Check-in opens on the day of the meeting.');
  const [scout, adult] = await Promise.all([
    s.sb.from('scouts').select('id').eq('person_id', input.personId).eq('active', true).limit(1),
    s.sb.from('person_directory').select('person_id').eq('person_id', input.personId).in('tab', ['leader', 'adult']).eq('in_picker', true).limit(1)
  ]);
  if (scout.error || adult.error) return fail('Couldn’t save that. Try again.');
  if (!(scout.data ?? []).length && !(adult.data ?? []).length) return fail('That person isn’t on this meeting’s roster.');
  const { error } = await s.sb.rpc('meeting_live_set_presence', { p_entry: s.meeting.entryId, p_actor: s.actorPersonId, p_person: input.personId, p_present: input.present });
  if (error) return fail('Couldn’t save that. Try again.');
  return done(s);
}

/** The board stamp for the poller: any viewer, any of the meetings the planner offers. */
export async function twStampAction(entryId: number): Promise<{ ok: true; stamp: string } | { ok: false }> {
  if (!plannerAccess(await resolveAdminActor()).canView || !Number.isInteger(entryId)) return { ok: false };
  try {
    const sb = createAdminClient();
    const lists = await loadPlannerLists();
    const meetings = (await loadUpcomingMeetings(sb, PLANNER_WEEKS * 2, undefined, lists.meetingLabels)).filter((m) => !m.closed).slice(0, PLANNER_WEEKS);
    if (!meetings.some((m) => m.entryId === entryId)) return { ok: false };
    return { ok: true, stamp: await loadBoardStamp(sb, entryId) };
  } catch {
    return { ok: false };
  }
}

/** Put one requirement on the night as a class of its own (a planner's extra; Has/Needs' add hook). */
export async function twAddRequirementAction(input: { entryId: number; key: string }): Promise<TwResult> {
  if (typeof input?.key !== 'string' || !REQUEST_KEY.test(input.key) || isGroupKey(input.key) || input.key.startsWith('ff:')) return fail('Malformed request');
  const s = await gate(input.entryId, 'seed');
  if (!s.ok) return s;
  const res = await seedMany(s.sb, s.meeting.entryId, [input.key], s.actorPersonId);
  return res.ok ? done(s) : res;
}

/** Take a planner-added class off the night (the unseed). It stays, as theirs, while scouts picked it or someone is
 *  signed up to teach it. */
export async function twRemoveRequirementAction(input: { entryId: number; key: string }): Promise<TwResult> {
  if (typeof input?.key !== 'string' || !REQUEST_KEY.test(input.key) || isGroupKey(input.key) || input.key.startsWith('fg:')) return fail('Malformed request');
  const s = await gate(input.entryId, 'seed');
  if (!s.ok) return s;
  const res = await unseedTopic(s.sb, s.meeting.entryId, input.key);
  return res.ok ? done(s) : res;
}
