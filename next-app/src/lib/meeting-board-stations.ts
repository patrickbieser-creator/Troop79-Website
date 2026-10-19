/**
 * Merit badge night loaders and writers (Phase 3b of Plans/Meeting-Requests-And-Teaching-Offers.md). Server-only:
 * every function takes the service-role client. The rules are in lib/meeting-board-rotations (pure); this file only
 * reads and writes.
 *
 * One read path for every surface: This Sunday and its rotations editor, the meeting editor's tray, and
 * /member/meeting all call loadRotationBoard, so a scout, their teacher and the leader see the same groups.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdvancementCatalog } from '@/lib/advancement-catalog';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { loadScoutProgress, type BoardMeeting, type BoardScoutRow, type BoardWriteResult } from '@/lib/meeting-board';
import type { TeachBoard } from '@/lib/meeting-board-supply';
import {
  badgeTops,
  boardIntent,
  draftRotations,
  type Placement,
  type RotationResult,
  type Station,
  type StationDraft
} from '@/lib/meeting-board-rotations';

type StationRow = {
  topic_id: number;
  position: number;
  title: string;
  location: string | null;
  req_codes: string[];
  meeting_topics: { topic_key: string; mb_id: string | null } | { topic_key: string; mb_id: string | null }[] | null;
};
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** A meeting's stations for this badge, in the leader's order. */
export async function loadStations(sb: SupabaseClient, entryId: number, mbId: string | null): Promise<Station[]> {
  if (!mbId) return [];
  const { data, error } = await sb
    .from('meeting_stations')
    .select('topic_id, position, title, location, req_codes, meeting_topics(topic_key, mb_id)')
    .eq('calendar_entry_id', entryId)
    .order('position');
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as StationRow[])
    .filter((r) => one(r.meeting_topics)?.mb_id === mbId)
    .map((r, i) => ({ index: i, topicId: r.topic_id, key: one(r.meeting_topics)!.topic_key, title: r.title, location: r.location, codes: r.req_codes }));
}

/** The leader's saved arrangement for a meeting, by person. */
export async function loadPlacements(sb: SupabaseClient, entryId: number): Promise<Map<number, Placement>> {
  const { data, error } = await sb.from('meeting_rotation_placements').select('person_id, group_index, helper_topic_id, other_work').eq('calendar_entry_id', entryId);
  if (error) throw new Error(error.message);
  const out = new Map<number, Placement>();
  for (const r of (data ?? []) as { person_id: number; group_index: number | null; helper_topic_id: number | null; other_work: boolean }[]) {
    if (r.group_index != null) out.set(r.person_id, { kind: 'group', group: r.group_index });
    else if (r.helper_topic_id != null) out.set(r.person_id, { kind: 'helper', topicId: r.helper_topic_id });
    else if (r.other_work) out.set(r.person_id, { kind: 'other' });
  }
  return out;
}

export interface RotationBoard {
  mbId: string;
  mbName: string;
  stations: Station[];
  result: RotationResult;
  /** Active scouts with no answer (a carried pick isn't one on a merit badge night), and whether they have the badge. */
  noAnswer: { personId: number; awarded: boolean }[];
  notComing: number[];
  /** Every active scout who has this badge, whatever their answer (the member page's wording). */
  badgeHolderIds: number[];
  /** Station index → the people committed to teach it (Can't-make-it teachers left out), sign-up order. */
  teachersAt: Map<number, number[]>;
  patrolOf: Map<number, string | null>;
}

/**
 * A merit badge night's stations and rotations: who is coming (an explicit answer: carried rank picks are held), who has
 * the badge (mb_progress.awarded), each scout's ledger for this badge (finished stations), patrols, and the saved
 * arrangement, through the pure draft. Null when the meeting isn't a merit badge night.
 */
export async function loadRotationBoard(
  sb: SupabaseClient,
  meeting: Pick<BoardMeeting, 'entryId' | 'mode' | 'mbId'>,
  catalog: Pick<AdvancementCatalog, 'meritBadges' | 'meritBadgeRequirements'>,
  rows: readonly BoardScoutRow[],
  teach?: Pick<TeachBoard, 'supply'>
): Promise<RotationBoard | null> {
  if (meeting.mode !== 'merit_badge' || !meeting.mbId) return null;
  const mbId = meeting.mbId;
  const [stations, placements] = await Promise.all([loadStations(sb, meeting.entryId, mbId), loadPlacements(sb, meeting.entryId)]);
  const intentOf = new Map(rows.map((r) => [r.personId, boardIntent('merit_badge', r.intent, r.picks)]));
  const scoutIds = rows.map((r) => r.scoutId);
  const [progress, patrolRows, ledger] = await Promise.all([
    loadScoutProgress(sb, scoutIds),
    fetchAllRows<{ person_id: number; patrol: string | null }>((from, to) => sb.from('scouts').select('person_id, patrol').in('id', scoutIds.length ? scoutIds : ['']).order('id').range(from, to)),
    fetchAllRows<{ scout_id: string; code: string }>((from, to) =>
      sb
        .from('ledger_active')
        .select('scout_id, code')
        .eq('kind', 'merit_badge_requirement')
        .like('code', `${mbId}-%`)
        .in('scout_id', scoutIds.length ? scoutIds : [''])
        .order('id')
        .range(from, to)
    )
  ]);
  const patrolOf = new Map(patrolRows.map((p) => [p.person_id, p.patrol]));
  const codesOf = new Map<string, Set<string>>();
  for (const l of ledger) codesOf.set(l.scout_id, (codesOf.get(l.scout_id) ?? new Set()).add(l.code));
  const awarded = (scoutId: string) => (progress.get(scoutId)?.mbProgress ?? []).some((m) => m.mb_id === mbId && m.awarded);

  const inPlay = rows.filter((r) => {
    const it = intentOf.get(r.personId);
    return it === 'coming' || it === 'undecided';
  });
  const result = draftRotations({
    mbId,
    stations,
    tops: badgeTops(mbId, catalog.meritBadgeRequirements),
    placements,
    scouts: inPlay.map((r) => ({
      personId: r.personId,
      patrol: patrolOf.get(r.personId) ?? null,
      intent: intentOf.get(r.personId) as 'coming' | 'undecided',
      awarded: awarded(r.scoutId),
      mbCodes: codesOf.get(r.scoutId) ?? new Set()
    }))
  });

  const teachersAt = new Map<number, number[]>();
  for (const st of stations) {
    const ids = (teach?.supply.topicTeachers ?? []).filter((t) => t.key === st.key && !teach!.supply.notComing.has(t.personId)).map((t) => t.personId);
    teachersAt.set(st.index, [...new Set(ids)]);
  }
  return {
    mbId,
    mbName: catalog.meritBadges.find((m) => m.id === mbId)?.name ?? mbId,
    stations,
    result,
    noAnswer: rows.filter((r) => intentOf.get(r.personId) == null).map((r) => ({ personId: r.personId, awarded: awarded(r.scoutId) })),
    notComing: rows.filter((r) => intentOf.get(r.personId) === 'not_coming').map((r) => r.personId),
    badgeHolderIds: rows.filter((r) => awarded(r.scoutId)).map((r) => r.personId),
    teachersAt,
    patrolOf
  };
}

/** The RPCs' own messages are written for leaders; anything else (a constraint, a dropped connection) is not shown raw. */
const KNOWN =
  /^(That meeting|Only troop meetings|Choose the badge|That badge|Add at least 2 stations|Six stations|Station \d|A requirement can be|The stations changed|This meeting isn’t|Set the stations|Only scouts go|Each scout goes|That group doesn’t)/;
export const ROTATION_SAVE_FAILED = 'Couldn’t save that. Try again.';
/** meeting_save_rotations names the scout: "Finn Parker said they can't make it. Reload the page to see the latest." */
const CANT_MAKE_IT = /^[^\n]{1,120} said they can’t make it\. Reload the page to see the latest\.$/;
const known = (m: string) => KNOWN.test(m) || CANT_MAKE_IT.test(m);
const done = (error: { message: string } | null): BoardWriteResult => (error ? { ok: false, error: known(error.message) ? error.message : ROTATION_SAVE_FAILED } : { ok: true });

/** Sets the night's badge and replaces its stations (one transaction: meeting_set_stations). */
export async function setStations(sb: SupabaseClient, entryId: number, mbId: string, stations: readonly StationDraft[]): Promise<BoardWriteResult> {
  const { error } = await sb.rpc('meeting_set_stations', {
    p_entry: entryId,
    p_mb_id: mbId,
    p_stations: stations.map((s) => ({ topic_id: s.topicId, title: s.title, location: s.location, codes: s.codes }))
  });
  return done(error);
}

/** Replaces the leader's arrangement; an empty list is "Start over from the draft". */
export async function saveRotations(sb: SupabaseClient, entryId: number, actorPersonId: number | null, placements: readonly { personId: number; placement: Placement }[]): Promise<BoardWriteResult> {
  const { error } = await sb.rpc('meeting_save_rotations', {
    p_entry: entryId,
    p_actor: actorPersonId,
    p_placements: placements.map(({ personId, placement: p }) =>
      p.kind === 'group' ? { person_id: personId, group: p.group } : p.kind === 'helper' ? { person_id: personId, helper_topic_id: p.topicId } : { person_id: personId, other: true }
    )
  });
  return done(error);
}
