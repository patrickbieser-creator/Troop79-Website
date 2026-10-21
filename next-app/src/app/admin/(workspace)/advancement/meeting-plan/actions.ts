'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import type { MeetingPlanPayload } from '@/lib/meeting-plan-types';
import { retargetPlan } from '@/lib/meeting-plan-publish';
import { buildMeetingPlan } from './engine';
import { loadEngineInput } from './load-input';
import { loadBoardScouts, loadBoardStamp, loadMeetingById, loadScoutBoard } from '@/lib/meeting-board';
import { boardName, INTENT_LABEL } from '@/lib/meeting-board-shared';
import { saveRotations, setStations } from '@/lib/meeting-board-stations';
import type { Placement, StationDraft } from '@/lib/meeting-board-rotations';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { recordAudit } from '@/lib/audit';
import { renderMarkdownEmail } from '@/lib/email-markdown';
import { sendEmail } from '@/lib/email';
import { fmtDateFull } from '@/lib/format-date';
import { minutesText, pickableKeys, topicWords } from '@/lib/meeting-board-picklist';
import { DEFAULT_PICK_INVITE, DEFAULT_TEACH_INVITE, PICK_INVITE_KIND, renderPickInvite, renderTeachInvite, TEACH_INVITE_KIND, type InviteTemplate } from '@/lib/meeting-invite-email';
import { INVITE_SENDER_NAME } from '@/lib/meeting-invites';
import { createPickInvites, createTeachInvites, deleteInvites } from '@/lib/meeting-invites-db';
import { siteUrl } from '@/lib/site-url';

interface GenerateResult {
  ok: boolean;
  payload?: MeetingPlanPayload;
  error?: string;
}

/**
 * Compute a meeting plan for the given date — pure read + engine pass, no
 * DB writes. The leader reviews the result and publishes it separately.
 */
export async function generatePlan(formData: FormData): Promise<GenerateResult> {
  try {
    await requireCapability('meeting_plan.use');
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }

  const meetingDate = String(formData.get('meetingDate') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim() || 'Troop Meeting';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) {
    return { ok: false, error: 'Pick a meeting date' };
  }

  const loaded = await loadEngineInput(meetingDate, title);
  if (!loaded.ok) return { ok: false, error: loaded.error };

  return { ok: true, payload: buildMeetingPlan(loaded.input) };
}

interface PublishResult {
  ok: boolean;
  error?: string;
}

/**
 * Publish a generated plan as the snapshot for its meeting date (one snapshot
 * per date — regenerating and republishing replaces it).
 */
export async function publishPlan(formData: FormData): Promise<PublishResult> {
  let session;
  try {
    session = await requireCapability('meeting_plan.use');
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }

  const raw = String(formData.get('payload') ?? '');
  let payload: MeetingPlanPayload;
  try {
    payload = JSON.parse(raw) as MeetingPlanPayload;
  } catch {
    return { ok: false, error: 'Plan payload was malformed' };
  }
  if (!payload || payload.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(payload.meetingDate)) {
    return { ok: false, error: 'Plan payload was malformed' };
  }

  // The date the leader had selected when they hit Publish WINS over the one
  // baked into the payload. A plan is a reusable suggestion, so generating for
  // one date and publishing for another is legitimate; what was not legitimate
  // was publishing under the generated date while the field showed a different
  // one. See lib/meeting-plan-publish.ts.
  const selectedDate = String(formData.get('meetingDate') ?? '').trim();
  if (selectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
    return { ok: false, error: 'Pick a meeting date' };
  }
  payload = retargetPlan(payload, selectedDate);

  const supabase = createAdminClient();
  const { error } = await supabase.from('meeting_plans').upsert(
    {
      meeting_date: payload.meetingDate,
      title: payload.title,
      status: 'published',
      payload,
      generated_at: payload.generatedAt,
      generated_by: session.label ?? null
    },
    { onConflict: 'meeting_date' }
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath('/meeting-plan');
  revalidatePath('/admin/advancement/meeting-plan');
  return { ok: true };
}

/** Remove a published snapshot (e.g., meeting theme changed to an MB night). */
export async function unpublishPlan(formData: FormData): Promise<PublishResult> {
  try {
    await requireCapability('meeting_plan.use');
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const meetingDate = String(formData.get('meetingDate') ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) {
    return { ok: false, error: 'Missing meeting date' };
  }
  const supabase = createAdminClient();
  const { error } = await supabase.from('meeting_plans').delete().eq('meeting_date', meetingDate);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/meeting-plan');
  revalidatePath('/admin/advancement/meeting-plan');
  return { ok: true };
}

export type BoardSettingsResult = { ok: true } | { ok: false; error: string };

/** The RPC's own messages are written for leaders; anything else (a constraint, a dropped connection) is not shown raw. */
const BOARD_KNOWN = /^(That meeting isn’t|That meeting has passed|Only troop meetings|Choose rank|Teaching blocks are|Choose the badge|That badge)/;

/**
 * This Sunday's board settings (Phase 3a): rank with 1-3 teaching blocks, merit badge with its badge (stations are
 * Phase 3b), or closed. One RPC (meeting_set_board) validates and upserts; picks are never touched.
 */
export async function setMeetingBoardAction(input: { entryId: number; mode: string; mbId: string | null; blockCount: number }): Promise<BoardSettingsResult> {
  let actor;
  try {
    actor = await requireCapability('meeting_plan.use');
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  // meeting_plan.use is also in the youth_leader bundle (SPL / PL): the board's mode is an adult leader's call, the
  // same line on-behalf entry draws.
  if (actor.subjectKind === 'scout') return { ok: false, error: 'Only an adult leader can change the board.' };
  if (!input || !Number.isInteger(input.entryId) || typeof input.mode !== 'string') return { ok: false, error: 'Malformed request' };
  const { error } = await createAdminClient().rpc('meeting_set_board', {
    p_entry: input.entryId,
    p_mode: input.mode,
    p_mb_id: input.mode === 'merit_badge' ? (input.mbId ?? null) : null,
    p_block_count: Number.isInteger(input.blockCount) ? input.blockCount : null
  });
  if (error) return { ok: false, error: BOARD_KNOWN.test(error.message) ? error.message : 'Couldn’t save the board. Try again.' };
  revalidatePath('/admin/advancement/meeting-plan');
  revalidatePath('/member/meeting');
  revalidatePath('/member');
  return { ok: true };
}

/** Who may set up a merit badge night or arrange its rotations: an adult holding meeting_plan.use (the board line). */
async function adultLeader(): Promise<{ ok: true; personId: number | null } | { ok: false; error: string }> {
  let actor;
  try {
    actor = await requireCapability('meeting_plan.use');
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  if (actor.subjectKind === 'scout') return { ok: false, error: 'Only an adult leader can change the board.' };
  return { ok: true, personId: actor.personId ?? null };
}

const refreshBoard = () => {
  revalidatePath('/admin/advancement/meeting-plan');
  revalidatePath('/member/meeting');
  revalidatePath('/member');
};

/**
 * A merit badge night's board and stations in one save (Phase 3b): the badge, then 2-6 stations, each a name, an
 * optional place and the badge's top-level requirements it covers. One RPC (meeting_set_stations) validates the lot
 * and writes it in one transaction; a saved station keeps its teachers through a rename or a requirement change.
 */
export async function setMeetingStationsAction(input: { entryId: number; mbId: string; stations: StationDraft[] }): Promise<BoardSettingsResult> {
  const who = await adultLeader();
  if (!who.ok) return who;
  if (!input || !Number.isInteger(input.entryId) || typeof input.mbId !== 'string' || !Array.isArray(input.stations)) return { ok: false, error: 'Malformed request' };
  const stations: StationDraft[] = [];
  for (const s of input.stations) {
    if (!s || typeof s.title !== 'string' || !Array.isArray(s.codes) || s.codes.some((c) => typeof c !== 'string')) return { ok: false, error: 'Malformed request' };
    if (s.topicId != null && !Number.isInteger(s.topicId)) return { ok: false, error: 'Malformed request' };
    stations.push({ topicId: s.topicId ?? null, title: s.title.trim(), location: typeof s.location === 'string' ? s.location.trim() : '', codes: s.codes });
  }
  const res = await setStations(createAdminClient(), input.entryId, input.mbId, stations);
  if (res.ok) refreshBoard();
  return res;
}

/**
 * The leader's rotation arrangement (Phase 3b): everyone shown, pinned where they are, plus badge holders placed as
 * helpers or on other work. An empty list is "Start over from the draft". Saved by meeting_save_rotations, which
 * records a scout the leader placed with no answer as Coming.
 */
export async function saveRotationsAction(input: { entryId: number; placements: { personId: number; placement: Placement }[] }): Promise<BoardSettingsResult> {
  const who = await adultLeader();
  if (!who.ok) return who;
  if (!input || !Number.isInteger(input.entryId) || !Array.isArray(input.placements)) return { ok: false, error: 'Malformed request' };
  for (const p of input.placements) {
    const pl = p?.placement;
    const fine =
      Number.isInteger(p?.personId) &&
      !!pl &&
      ((pl.kind === 'group' && Number.isInteger(pl.group)) || (pl.kind === 'helper' && Number.isInteger(pl.topicId)) || pl.kind === 'other');
    if (!fine) return { ok: false, error: 'Malformed request' };
  }
  const res = await saveRotations(createAdminClient(), input.entryId, who.personId, input.placements);
  if (res.ok) refreshBoard();
  return res;
}

/**
 * This Sunday tab (Phase 1 of Plans/Meeting-Requests-And-Teaching-Offers.md): the board's version stamp, polled every
 * ~10 s; the tab refreshes only when it changes.
 */
export async function boardStampAction(entryId: number): Promise<{ ok: true; stamp: string } | { ok: false; error: string }> {
  try {
    await requireCapability('meeting_plan.use');
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  if (!Number.isInteger(entryId)) return { ok: false, error: 'Malformed request' };
  try {
    return { ok: true, stamp: await loadBoardStamp(createAdminClient(), entryId) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Stamp failed' };
  }
}

export type SendInvitesResult =
  | { ok: true; sent: string[]; skipped: { name: string; reason: string }[] }
  | { ok: false; error: string };

/**
 * Meeting invites, P1 (Plans/Matcher-Tune-Up.md T-5): the Troop 79 Bugler asks the ticked adults to teach one topic
 * at this meeting. Everything about who may be invited is re-decided in createTeachInvites (qa-lead M3); an invite
 * whose email doesn't go out is deleted so the board never counts it.
 */
export async function sendTeachInvitesAction(input: { entryId: number; topicKey: string; personIds: number[] }): Promise<SendInvitesResult> {
  const who = await adultLeader();
  if (!who.ok) return who;
  if (!input || !Number.isInteger(input.entryId) || typeof input.topicKey !== 'string' || !Array.isArray(input.personIds)) {
    return { ok: false, error: 'Malformed request' };
  }
  const catalog = await loadAdvancementCatalog();
  const words = topicWords(input.topicKey, catalog.ranks, catalog.rankRequirements, catalog.meritBadges);
  // Freeform topics carry their title on the board, not in the catalog; P1 invites cover catalog topics only.
  if (!words) return { ok: false, error: 'That topic can’t be invited for yet.' };
  const sb = createAdminClient();
  const made = await createTeachInvites(sb, { entryId: input.entryId, topicKey: input.topicKey, personIds: input.personIds, sentBy: who.personId });
  if (!made.ok) return made;
  const { data: entry } = await sb.from('calendar_entries').select('entry_date').eq('id', input.entryId).single();
  const { data: saved } = await sb
    .from('email_templates')
    .select('subject, body')
    .eq('kind', TEACH_INVITE_KIND)
    .is('retired_at', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const template = (saved as InviteTemplate | null) ?? DEFAULT_TEACH_INVITE;
  const { data: names } = await sb.from('people').select('id, nickname, first_name, display_name').in('id', made.invites.map((i) => i.personId));
  const firstName = new Map(
    ((names ?? []) as { id: number; nickname: string | null; first_name: string | null; display_name: string }[]).map((p) => [p.id, p.nickname || p.first_name || p.display_name])
  );

  const sent: string[] = [];
  const skipped = made.skipped.map(({ name, reason }) => ({ name, reason }));
  const unsent = new Set(made.invites.map((i) => i.inviteId));
  try {
    for (const inv of made.invites) {
      const { subject, md } = renderTeachInvite(template, {
        name: firstName.get(inv.personId) ?? inv.name,
        topic: words.label,
        code: words.codeLabel,
        minutes: minutesText(words.minutes),
        parts: words.parts.map((p) => `${p.code} ${p.label}`),
        day: entry ? fmtDateFull((entry as { entry_date: string }).entry_date) : 'Sunday'
      });
      const { html, text } = renderMarkdownEmail({ md, actionUrl: `${siteUrl()}/i/${inv.token}`, actionLabel: 'Answer the invite' });
      const res = await sendEmail({ to: [inv.sentTo], subject, html, text, confirm: true, fromName: INVITE_SENDER_NAME });
      if (res.status === 'sent') {
        sent.push(inv.name);
        unsent.delete(inv.inviteId);
      } else {
        skipped.push({ name: inv.name, reason: res.status === 'skipped' ? 'email isn’t set up on this server' : 'the email didn’t go out' });
      }
    }
  } catch {
    const told = new Set(skipped.map((s) => s.name));
    for (const inv of made.invites) if (unsent.has(inv.inviteId) && !told.has(inv.name)) skipped.push({ name: inv.name, reason: 'the email didn’t go out' });
  } finally {
    // An invite whose email never went out must not count as invited, or hold a live link nobody has.
    await deleteInvites(sb, [...unsent]);
  }
  if (sent.length) {
    await recordAudit({
      area: 'meeting',
      action: 'invite.teach',
      entityType: 'calendar_entry',
      entityId: input.entryId,
      summary: `Invited ${sent.length} to teach ${words.codeLabel}: ${sent.join(', ')}`
    });
  }
  refreshBoard();
  return { ok: true, sent, skipped };
}

export interface ScoutCandidate {
  personId: number;
  name: string;
  /** 'coming', 'not sure yet', 'no answer'; '· picked it' when it's already on their list. */
  note: string;
  /** Proposed: hasn't picked it yet. The leader decides. */
  ticked: boolean;
}

export type ScoutCandidatesResult = { ok: true; scouts: ScoutCandidate[] } | { ok: false; error: string };

/**
 * Meeting invites, P2: who a requirement could be offered to. Every active scout who can pick it for this meeting
 * (not done, in reach) and hasn't said they can't make it; ticked when it isn't on their list yet. A proposal only:
 * sendPickInvitesAction re-decides everything.
 */
export async function scoutCandidatesAction(input: { entryId: number; topicKey: string }): Promise<ScoutCandidatesResult> {
  const who = await adultLeader();
  if (!who.ok) return who;
  if (!input || !Number.isInteger(input.entryId) || typeof input.topicKey !== 'string') return { ok: false, error: 'Malformed request' };
  const sb = createAdminClient();
  const meeting = await loadMeetingById(sb, input.entryId);
  if (!meeting || meeting.mode !== 'rank') return { ok: false, error: 'This meeting has no picks.' };
  const catalog = await loadAdvancementCatalog();
  const scouts: ScoutCandidate[] = [];
  for (const scout of await loadBoardScouts(sb)) {
    const board = await loadScoutBoard(sb, meeting, scout, catalog, { viewerPersonId: null });
    const intent = board.view.intent;
    if (intent === 'not_coming' || !pickableKeys(board.pickList).has(input.topicKey)) continue;
    const picked = board.picks.some((p) => p.key === input.topicKey);
    scouts.push({ personId: scout.personId, name: boardName(scout.name), note: `${intent ? INTENT_LABEL[intent] : 'no answer'}${picked ? ' · picked it' : ''}`, ticked: !picked });
  }
  return { ok: true, scouts: scouts.sort((a, b) => Number(b.ticked) - Number(a.ticked) || a.name.localeCompare(b.name)) };
}

/**
 * Meeting invites, P2 (Plans/Matcher-Tune-Up.md T-5): the Troop 79 Bugler offers one requirement to the ticked
 * scouts. One email per recipient (a parent with two invited scouts gets one email with a link for each); parents are
 * always copied, the scout too from 13. An email that doesn't go out takes its invites with it.
 */
export async function sendPickInvitesAction(input: { entryId: number; topicKey: string; scoutIds: number[] }): Promise<SendInvitesResult> {
  const who = await adultLeader();
  if (!who.ok) return who;
  if (!input || !Number.isInteger(input.entryId) || typeof input.topicKey !== 'string' || !Array.isArray(input.scoutIds)) {
    return { ok: false, error: 'Malformed request' };
  }
  const catalog = await loadAdvancementCatalog();
  const words = topicWords(input.topicKey, catalog.ranks, catalog.rankRequirements, catalog.meritBadges);
  if (!words) return { ok: false, error: 'That topic can’t be offered yet.' };
  const sb = createAdminClient();
  const made = await createPickInvites(sb, { entryId: input.entryId, topicKey: input.topicKey, scoutIds: input.scoutIds, sentBy: who.personId });
  if (!made.ok) return made;

  const { data: entry } = await sb.from('calendar_entries').select('entry_date').eq('id', input.entryId).single();
  const { data: saved } = await sb
    .from('email_templates')
    .select('subject, body')
    .eq('kind', PICK_INVITE_KIND)
    .is('retired_at', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const template = (saved as InviteTemplate | null) ?? DEFAULT_PICK_INVITE;
  const { data: names } = await sb.from('people').select('id, nickname, first_name, display_name').in('id', made.recipients.map((r) => r.recipientId));
  const firstName = new Map(
    ((names ?? []) as { id: number; nickname: string | null; first_name: string | null; display_name: string }[]).map((p) => [p.id, p.nickname || p.first_name || p.display_name])
  );
  const day = entry ? fmtDateFull((entry as { entry_date: string }).entry_date) : 'Sunday';

  const sentTo: string[] = [];
  const offered = new Set<string>();
  const skipped = made.skipped.map(({ name, reason }) => ({ name, reason }));
  const unsent = new Set(made.recipients.flatMap((r) => r.scouts.map((s) => s.inviteId)));
  try {
    for (const r of made.recipients) {
      const scoutNames = r.scouts.map((s) => boardName(s.scoutName));
      const { subject, md } = renderPickInvite(
        template,
        {
          name: firstName.get(r.recipientId) ?? r.name,
          scouts: r.isScout ? 'you' : scoutNames.join(' and '),
          topic: words.label,
          code: words.codeLabel,
          parts: words.parts.map((p) => `${p.code} ${p.label}`),
          day
        },
        r.scouts.map((s) => ({ scoutName: boardName(s.scoutName), url: `${siteUrl()}/i/${s.token}` })),
        r.isScout
      );
      const { html, text } = renderMarkdownEmail({ md });
      const res = await sendEmail({ to: [r.sentTo], subject, html, text, confirm: true, fromName: INVITE_SENDER_NAME });
      if (res.status === 'sent') {
        sentTo.push(r.name);
        for (const s of r.scouts) {
          unsent.delete(s.inviteId);
          offered.add(boardName(s.scoutName));
        }
      } else {
        skipped.push({ name: r.name, reason: res.status === 'skipped' ? 'email isn’t set up on this server' : 'the email didn’t go out' });
      }
    }
  } catch {
    // Whoever wasn't reached is reported below; their invites go with the finally.
  } finally {
    await deleteInvites(sb, [...unsent]);
  }
  if (sentTo.length) {
    await recordAudit({
      area: 'meeting',
      action: 'invite.pick',
      entityType: 'calendar_entry',
      entityId: input.entryId,
      summary: `Offered ${words.codeLabel} to ${[...offered].join(', ')} (${sentTo.length} emails)`
    });
  }
  refreshBoard();
  return { ok: true, sent: [...offered], skipped };
}
