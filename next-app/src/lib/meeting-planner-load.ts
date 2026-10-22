/**
 * Loads the Meeting Planner's This Sunday board for the next meeting (Plans/Meeting-Planner-II.md, P1). Server-only:
 * it reads with the service-role client, so the caller gates (the /planner page checks plannerAccess first).
 *
 * Every read is v1's (lib/meeting-board*.ts, lib/meeting-invites-db.ts); this file only shapes them into
 * buildPlannerBoard's input. Which adults are on the board: every leader, anyone who can teach (skills or a counselor
 * badge), and anyone who answered or signed up for this meeting. Other parents appear once they answer.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { fmtDateFull } from '@/lib/format-date';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { loadBoardStamp, loadBoardState, loadNextMeeting, loadScoutProgress, type BoardMeeting } from '@/lib/meeting-board';
import { loadTeachBoard } from '@/lib/meeting-board-supply';
import { assessTeacher, teacherName, teachersFor } from '@/lib/meeting-board-teach';
import { boardName } from '@/lib/meeting-board-shared';
import { isPickOutOfReach, nextRankOf, rankOfKey, rankTrees, topicWords } from '@/lib/meeting-board-picklist';
import { loadInviteRows } from '@/lib/meeting-invites-db';
import { buildPlannerBoard, type PlannerBoard, type PlannerTopic } from '@/lib/meeting-planner-board';

export interface PlannerPage {
  meeting: Pick<BoardMeeting, 'entryId' | 'title' | 'closed' | 'date'> & { dateLabel: string };
  board: PlannerBoard;
  /** The board's version stamp, for the poller. */
  stamp: string;
}

async function loadLeaderIds(sb: SupabaseClient): Promise<Set<number>> {
  const rows = await fetchAllRows<{ person_id: number }>((from, to) =>
    sb.from('person_directory').select('person_id').eq('tab', 'leader').eq('in_picker', true).order('person_id').range(from, to)
  );
  return new Set(rows.map((r) => r.person_id));
}

/** The next meeting's board, or (P5b, the reminder action re-deciding who hasn't answered) a given meeting's. */
export async function loadPlannerPage(sb: SupabaseClient, forMeeting?: BoardMeeting): Promise<PlannerPage | null> {
  const meeting = forMeeting ?? (await loadNextMeeting(sb));
  if (!meeting) return null;
  const catalog = await loadAdvancementCatalog();
  const [rows, stamp, leaderIds, inviteRows] = await Promise.all([
    loadBoardState(sb, meeting, catalog),
    loadBoardStamp(sb, meeting.entryId),
    loadLeaderIds(sb),
    loadInviteRows(sb, meeting.entryId)
  ]);
  const teach = await loadTeachBoard(sb, meeting, catalog, rows, 'all');
  const rankName = new Map(catalog.ranks.map((r) => [r.id, r.display_name]));
  const skillName = new Map(catalog.skills.map((s) => [s.id, s.name]));

  // Teaching commitments: topics signed up for, plus skill offers (a skill offer is a commitment too, as in v1).
  const commitments = [
    ...teach.supply.topicTeachers.map((t) => ({ key: t.key, personId: t.personId })),
    ...teach.supply.skillOffers.map((o) => ({ key: `skill:${o.skillId}`, personId: o.personId }))
  ];
  const committed = new Set(commitments.map((c) => c.personId));

  // P3: seeded topics are on the board even before anyone picks them or offers to teach them.
  const seededKeys = teach.focus.map((f) => f.key);
  const teachersForKey = new Map([...teach.match.teachers].map(([key, list]) => [key, list.map((t) => t.personId)]));
  for (const key of seededKeys) if (!teachersForKey.has(key)) teachersForKey.set(key, teachersFor(key, teach.supply).map((t) => t.personId));

  // Topic words for every key on the board.
  const keys = new Set([...teach.demand.keys(), ...commitments.map((c) => c.key), ...seededKeys]);
  const topics = new Map<string, PlannerTopic>();
  for (const key of keys) {
    if (key.startsWith('skill:')) {
      const name = skillName.get(key.slice(6)) ?? key.slice(6);
      topics.set(key, { key, codeLabel: 'Skill offer', title: name, kind: 'ff', minutes: null, rankId: null });
      continue;
    }
    const w = topicWords(key, catalog.ranks, catalog.rankRequirements, catalog.meritBadges, teach.freeformTitles, { mbReqs: catalog.meritBadgeRequirements, members: teach.members });
    const rank = w?.kind === 'rank' ? rankOfKey(key, catalog.ranks) : undefined;
    topics.set(key, { key, codeLabel: w?.codeLabel ?? '', title: w?.label ?? key, kind: w?.kind ?? 'ff', minutes: w?.minutes ?? null, rankId: rank?.id ?? null });
  }

  const pool = [...teach.people.values()].filter((p) => p.eligible !== false);
  const qualified = new Map([...new Set([...teach.match.wanted, ...seededKeys])].map((key) => [key, pool.filter((p) => assessTeacher(p, key, teach.ctx).qualified).map((p) => p.personId)]));
  const adults = [...teach.people.values()]
    .filter((p) => p.kind === 'adult')
    .filter((p) => leaderIds.has(p.personId) || p.skills.size > 0 || p.counselorFor.size > 0 || teach.intents.has(p.personId) || committed.has(p.personId))
    .map((p) => ({ personId: p.personId, name: teacherName(p, 'admin'), intent: teach.intents.get(p.personId) ?? null, canTeach: p.skills.size > 0 || p.counselorFor.size > 0 }));

  // Offers nobody picked: who has finished each one or can't take it up yet, so likely fits match the nudge list.
  const finished = new Set<string>();
  if (teach.match.offered.length) {
    const progress = await loadScoutProgress(sb, rows.map((r) => r.scoutId));
    const trees = rankTrees(catalog.rankRequirements);
    for (const r of rows) {
      const p = progress.get(r.scoutId);
      const ctx = { currentRank: r.currentRank, ranks: catalog.ranks, trees, rankCodes: p?.rankCodes ?? new Set<string>(), awardedMbs: new Set((p?.mbProgress ?? []).filter((m) => m.awarded).map((m) => m.mb_id)) };
      for (const key of teach.match.offered) if (isPickOutOfReach(key, ctx)) finished.add(`${key}:${r.personId}`);
    }
  }

  const board = buildPlannerBoard({
    meetingDate: meeting.date,
    scouts: rows.map((r) => {
      const next = nextRankOf(r.currentRank, catalog.ranks);
      return { personId: r.personId, name: boardName(r.name), workingOn: next ? (rankName.get(next) ?? null) : null, workingOnRankId: next, intent: r.intent, picks: r.picks };
    }),
    adults,
    topics,
    commitments,
    teachersFor: teachersForKey,
    qualified,
    requested: new Set(inviteRows.filter((r) => r.kind === 'teach').map((r) => `${r.topic_key}:${r.invitee_person_id}`)),
    finished,
    seeded: new Map(teach.focus.map((f) => [f.key, { by: f.seededBy }]))
  });

  return {
    meeting: { entryId: meeting.entryId, title: meeting.title, closed: meeting.closed, date: meeting.date, dateLabel: fmtDateFull(meeting.date) },
    board,
    stamp
  };
}
