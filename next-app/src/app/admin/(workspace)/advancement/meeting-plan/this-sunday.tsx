/**
 * Meeting Plan › This Sunday (Plans/Meeting-Requests-And-Teaching-Offers.md; prototype
 * prototypes/meeting-board/admin-plan.html): the live board for the next meeting.
 *
 *   - Phase 1, demand: who's coming (Coming / Not sure yet / Can't make it / no answer; a pick counts as Coming), what
 *     scouts asked for and who asked, by name.
 *   - Phase 2, supply: who is teaching each topic (a commitment, or a skill offer that covers it), "Wanted, no teacher"
 *     with who on file could teach it, "Offered, no takers", skill offers, and the adults' answers (a commitment counts
 *     as Coming; "Not sure yet" adults list what wanted topics fit their skills). Adults show as first name + last
 *     initial ("Dan V").
 *
 * A leader enters for someone who phoned or texted through the member page itself (?for=), scout or adult, so the
 * edit is the same component the family uses and saves as entered by the leader. Polls a version stamp (BoardPoller).
 *   - Phase 3a: the board settings (rank / merit badge / closed, 1-3 teaching blocks, the badge), and the live match
 *     (lib/meeting-board-match), a column per block, recomputed on every load and poll. The matcher owns the
 *     unmatched lists on a rank board. Read-only: sessions become agenda items in the meeting editor's tray.
 *   - Phase 3b, merit badge night: the board's stations (set in Board settings), who teaches each (with the counselor
 *     flag), and the rotations editor (groups × rotations × stations from lib/meeting-board-rotations, the leader moves
 *     anyone and places badge holders). Coming means an explicit answer: carried rank picks are held this week.
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { fmtDateFull } from '@/lib/format-date';
import { loadBoardStamp, loadBoardState, loadNextMeeting, type BoardMeeting } from '@/lib/meeting-board';
import { topicWords } from '@/lib/meeting-board-picklist';
import { boardName, effectiveIntent, summarizeBoard, type BoardCounts, type BoardMode, type Intent } from '@/lib/meeting-board-shared';
import { HALF_LABEL, seatsFor, sessionWords } from '@/lib/meeting-board-match';
import { assessTeacher, commitmentCounts, flagText, teacherIntent, teacherName, topicSkill, weeksAsked } from '@/lib/meeting-board-teach';
import { loadLiveMatch, loadTeachBoard } from '@/lib/meeting-board-supply';
import { loadRotationBoard } from '@/lib/meeting-board-stations';
import type { StationDraft } from '@/lib/meeting-board-rotations';
import type { CatalogMeritBadgeRequirement } from '@/lib/advancement-catalog';
import { RotationsEditor, type RotationEditorData } from './rotations-editor';
import { Notice } from '../../_components/notice';
import { Button } from '../../../_components/button';
import { BoardPoller } from './board-poller';
import { BoardSettings } from './board-settings';
import styles from './meeting-plan.module.css';

export interface BoardPerson {
  personId: number;
  name: string;
}

export interface SupplyTeacher extends BoardPerson {
  /** "from a First Aid offer", "sign-off needs a counselor", "not in their skills". */
  notes: string[];
}

/** One live matched session, as the leader sees it (Phase 3a). */
export interface MatchCard {
  id: string;
  title: string;
  codeLabel: string;
  /** 'A' / 'B' when an oversubscribed topic split. */
  group: string | null;
  teacher: SupplyTeacher;
  coTeachers: BoardPerson[];
  /** "#2" (their own ranking), "placed" (a Not sure yet scout), or ''. */
  scouts: (BoardPerson & { why: string })[];
}

export interface ThisSundayMatch {
  /** All MAX_BLOCKS teaching blocks; `half` is a filled one's rough half (null = not filled). */
  blocks: { label: string; half: 0 | 1 | null; sessions: MatchCard[] }[];
  sessions: number;
  /** The meeting editor's Agenda tab, whose tray promotes these. */
  agendaHref: string;
}

/** A merit badge night on This Sunday (Phase 3b). */
export interface MbNight {
  mbName: string;
  kpis: { inRotations: number; haveBadge: number; notComing: number; noAnswer: number; stations: number; withTeacher: number };
  stations: { index: number; title: string; location: string | null; codes: string; teachers: SupplyTeacher[] }[];
  editor: RotationEditorData;
  notComing: BoardPerson[];
  /** Rank picks held this week (they come back at the next rank board). */
  held: number;
}

export interface ThisSundayData {
  meeting: Pick<BoardMeeting, 'entryId' | 'title' | 'mode'> & { dateLabel: string };
  /** Board settings (Phase 3a): the saved mode, badge and block count, the badges an MB night can use; Phase 3b: the
   *  night's stations and those badges' top-level requirements (what a station is built from). */
  board?: {
    mode: BoardMode;
    mbId: string;
    blockCount: number;
    badges: { id: string; name: string }[];
    stations: StationDraft[];
    /** Teacher sign-ups on those stations (Can't-make-it teachers too: removing the stations removes theirs). */
    stationTeachers: number;
    arranged: boolean;
    badgeReqs: Pick<CatalogMeritBadgeRequirement, 'id' | 'mb_id' | 'parent_id' | 'code' | 'label' | 'complete_rule' | 'complete_n' | 'sort_order' | 'venue'>[];
  };
  /** A merit badge night's stations and rotations (Phase 3b). */
  mb?: MbNight | null;
  /** The live match (Phase 3a, rank boards only). */
  match?: ThisSundayMatch | null;
  stamp: string;
  counts: BoardCounts;
  /** Adults and Junior Leaders who answered or signed up to teach (a commitment counts as Coming). */
  adults: { coming: number; undecided: number; notComing: number; teaching: number };
  topics: { key: string; label: string; codeLabel: string; names: string[]; teachers: SupplyTeacher[] }[];
  /** The recruiting list: asked for, nobody teaching. `blocked`: committed teachers with no room for another session. */
  wanted: { key: string; label: string; codeLabel: string; names: string[]; weeks: number; canTeach: CanTeach[]; blocked?: string[] }[];
  /** Put on the board by a teacher, asked for by nobody. */
  offered: { key: string; label: string; codeLabel: string; teachers: SupplyTeacher[] }[];
  skillOffers: (BoardPerson & { skill: string; note: string | null; scouts: number })[];
  undecidedAdults: (BoardPerson & { fits: string[] })[];
  notComingAdults: BoardPerson[];
  /** `placed`: where the matcher put them (Phase 3a). */
  undecided: (BoardPerson & { placed?: string | null })[];
  notComing: (BoardPerson & { held: number })[];
  /** Coming with nothing assigned; `suggestion`: the engine's next thing for them (Phase 3a). */
  comingNothing: (BoardPerson & { suggestion?: string | null })[];
  noAnswer: BoardPerson[];
  scouts: BoardPerson[];
  /** Adults (leaders and parents), for "Enter for someone"; Junior Leaders are under the scouts. */
  adultPeople: BoardPerson[];
}

/** Who to ask first: `ask` answered coming or not sure; `listed` has the topic's skill (or badge) on file but no answer;
 *  `other` merely qualifies (a topic anyone may teach), shown only as a count. */
export type CanTeach = BoardPerson & { note: string; tier: 'ask' | 'listed' | 'other' };

const INTENT_WORD: Record<Intent, string> = { coming: 'coming', undecided: 'not sure yet', not_coming: 'can’t make it' };

export async function loadThisSunday(): Promise<ThisSundayData | null> {
  const sb = createAdminClient();
  const meeting = await loadNextMeeting(sb);
  if (!meeting) return null;
  const catalog = await loadAdvancementCatalog();
  const [rows, stamp] = await Promise.all([loadBoardState(sb, meeting, catalog), loadBoardStamp(sb, meeting.entryId)]);
  const teach = await loadTeachBoard(sb, meeting, catalog, rows, 'all');
  const { counts, demand } = summarizeBoard(rows);
  const nameOf = new Map(rows.map((r) => [r.personId, boardName(r.name)]));
  const person = (r: { personId: number }) => ({ personId: r.personId, name: nameOf.get(r.personId) ?? '' });
  const intentOf = new Map(rows.map((r) => [r.personId, effectiveIntent(r.intent, r.picks)]));
  const words = (key: string) => topicWords(key, catalog.ranks, catalog.rankRequirements, catalog.meritBadges, teach.freeformTitles) ?? { label: key, codeLabel: '' };
  const teacherPerson = (id: number) => {
    const p = teach.people.get(id);
    return { personId: id, name: p ? teacherName(p, 'admin') : `Person ${id}` };
  };
  const skillName = new Map(catalog.skills.map((s) => [s.id, s.name]));
  const supplyTeachers = (key: string): SupplyTeacher[] =>
    (teach.match.teachers.get(key) ?? []).map((t) => {
      const p = teach.people.get(t.personId);
      const notes = p ? flagText(assessTeacher(p, key, teach.ctx).flags, 'admin') : [];
      if (t.via === 'offer') notes.unshift(`from a ${skillName.get(topicSkill(key, catalog.ranks, catalog.rankRequirements) ?? '') ?? ''} offer`);
      return { ...teacherPerson(t.personId), notes };
    });

  const topics = [...demand]
    .map(([key, ids]) => ({ key, ...words(key), names: ids.map((id) => nameOf.get(id) ?? '').sort(), teachers: supplyTeachers(key) }))
    .sort((a, b) => b.names.length - a.names.length || a.codeLabel.localeCompare(b.codeLabel));

  const firstAsked = new Map<string, string[]>();
  for (const r of rows) for (const p of r.picks) firstAsked.set(p.key, [...(firstAsked.get(p.key) ?? []), p.firstAskedOn]);
  const commits = commitmentCounts(teach.supply);
  const adultIntent = (id: number) => teacherIntent(teach.intents.get(id) ?? null, commits.get(id) ?? 0);
  // People who no longer qualify are in teach.people only so their rows show; they are never offered as teachers.
  const pool = [...teach.people.values()].filter((p) => p.eligible !== false);
  const canTeachNote = (id: number, key: string): CanTeach => {
    const it = adultIntent(id);
    const n = commits.get(id) ?? 0;
    const p = teach.people.get(id);
    const listed = key.startsWith('mb:') ? !!p?.counselorFor.has(key.slice(3)) : topicSkill(key, catalog.ranks, catalog.rankRequirements) != null;
    return { ...teacherPerson(id), note: `${it ? INTENT_WORD[it] : 'no answer'}${n ? `, teaching ${n}` : ''}`, tier: it ? 'ask' : listed ? 'listed' : 'other' };
  };
  // Coming before not sure, then by name.
  const askOrder = (a: CanTeach, b: CanTeach) =>
    Number(adultIntent(a.personId) !== 'coming') - Number(adultIntent(b.personId) !== 'coming') || a.name.localeCompare(b.name);

  // Phase 3a: the live match (rank boards). It owns the unmatched lists; a merit badge night keeps Phase 2's.
  const match = meeting.mode === 'rank' ? await loadLiveMatch(sb, meeting, rows, teach) : null;
  const skillNames = new Map(catalog.skills.map((s) => [s.id, s.name]));
  const keyLabel = (key: string) => words(key).codeLabel || words(key).label;
  const wanted = match
    ? match.wanted.map((w) => {
        const t = topics.find((x) => x.key === w.key);
        return {
          key: w.key,
          label: t?.label ?? words(w.key).label,
          codeLabel: t?.codeLabel ?? words(w.key).codeLabel,
          names: w.scoutIds.map((id) => nameOf.get(id) ?? '').filter(Boolean).sort(),
          weeks: w.weeks,
          canTeach: w.canTeach
            .filter((id) => adultIntent(id) !== 'not_coming')
            .map((id) => canTeachNote(id, w.key))
            .sort(askOrder),
          blocked: w.blockedTeacherIds.map((id) => teacherPerson(id).name)
        };
      })
    : teach.match.wanted
        .map((key) => {
          const t = topics.find((x) => x.key === key)!;
          const canTeach = pool
            .filter((p) => assessTeacher(p, key, teach.ctx).qualified && adultIntent(p.personId) !== 'not_coming')
            .map((p) => canTeachNote(p.personId, key))
            .sort(askOrder);
          return { key, label: t.label, codeLabel: t.codeLabel, names: t.names, weeks: weeksAsked(firstAsked.get(key) ?? [], meeting.date), canTeach };
        })
        .sort((a, b) => b.names.length - a.names.length || b.weeks - a.weeks);
  const matchView: ThisSundayMatch | null = match
    ? {
        sessions: match.sessions.length,
        agendaHref: `/admin/calendar/${meeting.entryId}?tab=agenda`,
        blocks: Array.from({ length: match.blockCount }, (_, b) => ({
          label: `Block ${b + 1}`,
          half: match.sessions.find((s) => s.block === b)?.half ?? null,
          sessions: match.sessions
            .filter((s) => s.block === b)
            .map((s) => {
              const w = sessionWords(s.keys, catalog, skillNames, teach.freeformTitles);
              const notes = flagText(s.flags, 'admin');
              if (s.via === 'offer') notes.unshift(`from a ${skillNames.get(w.skillId ?? '') ?? ''} offer`);
              return {
                id: s.id,
                title: w.title,
                codeLabel: w.codeLabel,
                group: s.group,
                teacher: { ...teacherPerson(s.teacherId), notes },
                coTeachers: s.coTeacherIds.map(teacherPerson),
                scouts: s.scouts
                  .map((x) => ({ personId: x.personId, name: nameOf.get(x.personId) ?? '', why: x.via === 'placed' ? 'placed' : x.pickNo ? `#${x.pickNo}` : '' }))
                  .sort((a, b) => a.name.localeCompare(b.name))
              };
            })
        }))
      }
    : null;
  const placedIn = (personId: number) => {
    if (!match) return undefined;
    const seat = seatsFor(match, personId)[0];
    const s = seat ? match.sessions.find((x) => x.id === seat.sessionId) : undefined;
    return s ? sessionWords(s.keys, catalog, skillNames, teach.freeformTitles).title : null;
  };
  const offered = teach.match.offered.map((key) => ({ key, ...words(key), teachers: supplyTeachers(key) }));
  const skillOffers = teach.supply.skillOffers
    .filter((o) => !teach.supply.notComing.has(o.personId))
    .map((o) => {
      const covered = [...demand.keys()].filter((k) => (teach.match.teachers.get(k) ?? []).some((t) => t.personId === o.personId && t.via === 'offer') && topicSkill(k, catalog.ranks, catalog.rankRequirements) === o.skillId);
      return { ...teacherPerson(o.personId), skill: skillName.get(o.skillId) ?? o.skillId, note: o.note, scouts: new Set(covered.flatMap((k) => demand.get(k) ?? [])).size };
    });

  // Adults' answers: everyone who said something or signed up (a commitment means Coming). Junior Leaders answer as
  // scouts, so they are counted with the scouts, not here.
  const adultIds = pool.filter((p) => p.kind === 'adult').map((p) => p.personId).filter((id) => adultIntent(id) != null);
  const adults = {
    coming: adultIds.filter((id) => adultIntent(id) === 'coming').length,
    undecided: adultIds.filter((id) => adultIntent(id) === 'undecided').length,
    notComing: adultIds.filter((id) => adultIntent(id) === 'not_coming').length,
    teaching: [...commits.keys()].filter((id) => !teach.supply.notComing.has(id)).length
  };
  const fitsFromMatch = new Map((match?.undecidedAdults ?? []).map((a) => [a.personId, a.fits]));
  const undecidedAdults = adultIds
    .filter((id) => adultIntent(id) === 'undecided')
    .map((id) => ({
      ...teacherPerson(id),
      fits: (match ? (fitsFromMatch.get(id) ?? []) : teach.match.wanted.filter((k) => assessTeacher(teach.people.get(id)!, k, teach.ctx).qualified)).map(keyLabel)
    }));

  const byName = (a: BoardPerson, b: BoardPerson) => a.name.localeCompare(b.name);
  const badgesWithReqs = new Set(catalog.meritBadgeRequirements.map((r) => r.mb_id));

  // Phase 3b: a merit badge night's stations and rotations.
  const rot = meeting.mode === 'merit_badge' ? await loadRotationBoard(sb, meeting, catalog, rows, teach) : null;
  let mb: MbNight | null = null;
  if (rot) {
    const nameFor = (id: number) => nameOf.get(id) ?? `Scout ${id}`;
    const who = (id: number) => ({ personId: id, name: nameFor(id), patrol: rot.patrolOf.get(id) ?? null });
    const topicOf = new Map(rot.stations.map((s) => [s.index, s.topicId!]));
    const stationTeachers = (index: number): SupplyTeacher[] =>
      (rot.teachersAt.get(index) ?? []).map((id) => {
        const p = teach.people.get(id);
        const flags = p ? assessTeacher(p, `mb:${rot.mbId}`, teach.ctx).flags : [];
        return { ...teacherPerson(id), notes: flags.length ? flagText(flags, 'admin') : ['counselor'] };
      });
    const byPersonName = <T extends { name: string }>(list: T[]) => [...list].sort((a, b) => a.name.localeCompare(b.name));
    mb = {
      mbName: rot.mbName,
      kpis: {
        inRotations: rot.result.groups.reduce((n, g) => n + g.members.length, 0),
        haveBadge: rot.result.badgeHolders.length,
        notComing: rot.notComing.length,
        noAnswer: rot.noAnswer.length,
        stations: rot.stations.length,
        withTeacher: rot.stations.filter((s) => (rot.teachersAt.get(s.index) ?? []).length > 0).length
      },
      stations: rot.stations.map((s) => ({ index: s.index, title: s.title, location: s.location, codes: `${rot.mbName} ${s.codes.join(', ')}`, teachers: stationTeachers(s.index) })),
      editor: {
        entryId: meeting.entryId,
        stations: rot.stations.map((s) => ({ index: s.index, topicId: s.topicId!, title: s.title, location: s.location })),
        schedules: rot.result.groups.map((g) => g.schedule),
        groups: rot.result.groups.map((g) => byPersonName(g.members.map((m) => ({ ...who(m.personId), skips: m.skips, isNew: m.isNew, undecided: m.undecided })))),
        holders: byPersonName(
          rot.result.badgeHolders.map((h) => ({
            ...who(h.personId),
            undecided: h.undecided,
            placement: h.placement?.kind === 'helper' ? { kind: 'helper' as const, topicId: topicOf.get(h.placement.station)! } : h.placement
          }))
        ),
        noAnswer: byPersonName(rot.noAnswer.map((n) => ({ ...who(n.personId), awarded: n.awarded, skips: [] }))),
        arranged: rot.result.arranged
      },
      notComing: rot.notComing.map((id) => person({ personId: id })).sort(byName),
      held: rows.reduce((n, r) => n + r.picks.length, 0)
    };
  }
  return {
    meeting: { entryId: meeting.entryId, title: meeting.title, mode: meeting.mode, dateLabel: fmtDateFull(meeting.date) },
    board: {
      mode: meeting.mode,
      mbId: meeting.mbId ?? '',
      blockCount: meeting.blockCount,
      badges: catalog.meritBadges
        .filter((m) => badgesWithReqs.has(m.id))
        .map((m) => ({ id: m.id, name: m.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      stations: (rot?.stations ?? []).map((s) => ({ topicId: s.topicId, title: s.title, location: s.location ?? '', codes: s.codes })),
      stationTeachers: teach.supply.topicTeachers.filter((t) => (rot?.stations ?? []).some((s) => s.key === t.key)).length,
      arranged: rot?.result.arranged ?? false,
      badgeReqs: catalog.meritBadgeRequirements.filter((r) => r.parent_id == null)
    },
    mb,
    match: matchView,
    stamp,
    counts,
    adults,
    topics,
    wanted,
    offered,
    skillOffers,
    undecidedAdults: undecidedAdults.sort(byName),
    notComingAdults: adultIds.filter((id) => adultIntent(id) === 'not_coming').map(teacherPerson).sort(byName),
    undecided: rows.filter((r) => intentOf.get(r.personId) === 'undecided').map((r) => ({ ...person(r), placed: placedIn(r.personId) })),
    notComing: rows.filter((r) => intentOf.get(r.personId) === 'not_coming').map((r) => ({ ...person(r), held: r.picks.length })),
    comingNothing: match
      ? match.comingNothing.map((c) => ({ ...person(c), suggestion: c.suggestion ? `${words(c.suggestion).codeLabel}, ${words(c.suggestion).label}` : null })).sort(byName)
      : rows.filter((r) => intentOf.get(r.personId) === 'coming' && !r.picks.some((p) => !p.later)).map(person),
    noAnswer: rows.filter((r) => intentOf.get(r.personId) == null).map(person),
    scouts: rows.map(person).sort(byName),
    adultPeople: pool.filter((p) => p.kind === 'adult').map((p) => teacherPerson(p.personId)).sort(byName)
  };
}

const entryFor = (personId: number) => `/member/meeting?for=${personId}`;

function People({ list, empty, extra }: { list: BoardPerson[]; empty: string; extra?: (p: BoardPerson) => string }) {
  if (!list.length) return <p className={styles.boardEmpty}>{empty}</p>;
  return (
    <div className={styles.chips}>
      {list.map((p) => (
        <Link key={p.personId} className={styles.chip} href={entryFor(p.personId)} title={`Enter for ${p.name}`}>
          {p.name}
          {extra ? <span className={styles.chipRank}> {extra(p)}</span> : null}
        </Link>
      ))}
    </div>
  );
}

function TeacherLinks({ list }: { list: SupplyTeacher[] }) {
  return (
    <>
      {list.map((t, i) => (
        <span key={t.personId}>
          {i > 0 ? ', ' : ''}
          <Link href={entryFor(t.personId)} title={`Enter for ${t.name}`}>
            {t.name}
          </Link>
          {t.notes.length > 0 && <span className={styles.teachMeta}> ({t.notes.join('; ')})</span>}
        </span>
      ))}
    </>
  );
}

/** Who to ask about a wanted topic: answered first, then who listed the skill; everyone else who merely qualifies
 *  (for a topic any adult may teach, the whole roster) folds into a count. */
function CanTeachCell({ list }: { list: CanTeach[] }) {
  const link = (c: CanTeach) => (
    <Link href={entryFor(c.personId)} title={`Enter for ${c.name}`}>
      {c.name}
    </Link>
  );
  const names = (tier: CanTeach['tier'], note: boolean) =>
    list
      .filter((c) => c.tier === tier)
      .map((c, i) => (
        <span key={c.personId}>
          {i > 0 ? ', ' : ''}
          {link(c)}
          {note && <span className={styles.teachMeta}> ({c.note})</span>}
        </span>
      ));
  const count = (tier: CanTeach['tier']) => list.filter((c) => c.tier === tier).length;
  const others = count('other');
  return (
    <>
      {count('ask') > 0 && <div>Ask: {names('ask', true)}</div>}
      {count('listed') > 0 && <div>Listed the skill: {names('listed', false)}</div>}
      {others > 0 && (
        <details className={styles.moreQualified}>
          <summary>
            + {others} other {others === 1 ? 'adult' : 'adults'}
          </summary>
          {names('other', false)}
        </details>
      )}
    </>
  );
}

/**
 * The live match, one card per teaching block, grouped by rough half (Phase 3a; blocks are sessions since 2026-10-20). Read-only: the meeting editor's tray is the one place a session
 * becomes an agenda item. Shared by This Sunday and the Group Sessions tab.
 */
export function MatchBlocks({ match, linkPeople = true }: { match: ThisSundayMatch; linkPeople?: boolean }) {
  const who = (p: BoardPerson, extra?: string) =>
    linkPeople ? (
      <Link key={p.personId} className={`${styles.chip} ${styles.scoutTint}`} href={entryFor(p.personId)} title={`Enter for ${p.name}`}>
        {p.name}
        {extra ? <span className={styles.chipRank}> {extra}</span> : null}
      </Link>
    ) : (
      <span key={p.personId} className={`${styles.chip} ${styles.scoutTint}`}>
        {p.name}
        {extra ? <span className={styles.chipRank}> {extra}</span> : null}
      </span>
    );
  // Filled blocks under their rough half (a guide, not a clock); then every unused block, folded to "Not filled".
  const block = (b: ThisSundayMatch['blocks'][number]) =>
    b.sessions.length ? (
      <section key={b.label} aria-label={b.label} className={styles.blockFilled}>
        <h3 className={styles.blockHead}>{b.label}</h3>
        {b.sessions.map((s) => (
          <article key={s.id} className={styles.sessionCard}>
            <span className={styles.reqCode}>
              {s.codeLabel}
              {s.group ? ` · Group ${s.group}` : ''}
            </span>
            <h3>{s.title}</h3>
            <div className={styles.chips}>{s.scouts.map((x) => who(x, x.why))}</div>
            <div className={`${styles.teachSlot} ${styles.adultTint}`}>
              <span className={styles.teachLabel}>Teacher</span>
              <TeacherLinks list={[s.teacher]} />
              {s.coTeachers.length > 0 && <span className={styles.teachMeta}> with {s.coTeachers.map((c) => c.name).join(', ')}</span>}
            </div>
          </article>
        ))}
      </section>
    ) : (
      <section key={b.label} aria-label={b.label} className={styles.blockEmpty}>
        <h3 className={styles.blockHead}>{b.label}</h3>
        <span className={styles.teachMeta}>Not filled</span>
      </section>
    );
  const filled = (half: 0 | 1) => match.blocks.filter((b) => b.sessions.length > 0 && b.half === half);
  return (
    <>
      {([0, 1] as const)
        .filter((h) => filled(h).length > 0)
        .map((h) => (
          <section key={h} aria-label={HALF_LABEL[h]}>
            <h3 className={styles.blockHalf}>{HALF_LABEL[h]}</h3>
            <div className={styles.blockCols}>{filled(h).map(block)}</div>
          </section>
        ))}
      <div className={styles.blockCols}>{match.blocks.filter((b) => !b.sessions.length).map(block)}</div>
    </>
  );
}

export function ThisSundayView({ data }: { data: ThisSundayData | null }) {
  if (!data) return <div className={styles.empty}>There&rsquo;s no troop meeting on the calendar yet.</div>;
  const { meeting, counts } = data;
  const head = (
    <>
      <div className={styles.boardHead}>
        <span className={styles.boardWhen}>
          {meeting.dateLabel} · {meeting.title}
        </span>
        {meeting.mode !== 'closed' && <BoardPoller entryId={meeting.entryId} stamp={data.stamp} />}
      </div>
      {data.board && (
        <BoardSettings
          key={JSON.stringify([data.board.mode, data.board.mbId, data.board.blockCount, data.board.stations])}
          entryId={meeting.entryId}
          initial={{ mode: data.board.mode, mbId: data.board.mbId, blockCount: data.board.blockCount, stations: data.board.stations }}
          badges={data.board.badges}
          badgeReqs={data.board.badgeReqs}
          picks={counts.picks}
          stationTeachers={data.board.stationTeachers}
          arranged={data.board.arranged}
        />
      )}
    </>
  );
  if (meeting.mode === 'closed') {
    return (
      <>
        {head}
        <Notice variant="info">Closed: no board this week. Scouts and families see &ldquo;No sign-ups this week.&rdquo;</Notice>
      </>
    );
  }
  const stat = (n: number, label: string, who?: 'scout' | 'adult') => (
    <div className={who ? `${styles.stat} ${who === 'scout' ? styles.scoutTint : styles.adultTint}` : styles.stat}>
      <div className={styles.statNum}>{n}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
  if (meeting.mode === 'merit_badge') {
    return (
      <>
        {head}
        <MbNightView data={data} stat={stat} />
      </>
    );
  }
  return (
    <>
      {head}
      <div className={`${styles.statsStrip} ${styles.statsLine}`}>
        {stat(counts.coming, 'Scouts coming', 'scout')}
        {stat(counts.undecided, 'Not sure yet', 'scout')}
        {stat(counts.notComing, 'Can’t make it', 'scout')}
        {stat(counts.noAnswer, 'No answer', 'scout')}
        {stat(counts.picks, 'Picks', 'scout')}
        {stat(data.adults.coming, 'Adults coming', 'adult')}
        {stat(data.adults.undecided, 'Adults not sure yet', 'adult')}
        {stat(data.adults.notComing, 'Adults can’t make it', 'adult')}
        {stat(data.adults.teaching, 'Teaching', 'adult')}
        {stat(data.wanted.length, 'Wanted, no teacher')}
      </div>

      <div className={styles.boardCols}>
        <div>
          <h2 className={styles.sectionTitle}>What scouts asked for</h2>
          {data.topics.length ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Topic</th>
                  <th className={styles.alignRight}>Wanted</th>
                  <th>Teacher</th>
                  <th>Who picked</th>
                </tr>
              </thead>
              <tbody>
                {data.topics.map((t) => (
                  <tr key={t.key}>
                    <td>
                      <span className={styles.scoutName}>{t.label}</span>
                      <div className={styles.patrol}>{t.codeLabel}</div>
                    </td>
                    <td className={styles.alignRight}>{t.names.length}</td>
                    <td>{t.teachers.length ? <TeacherLinks list={t.teachers} /> : <span className={styles.noTeacher}>No teacher yet</span>}</td>
                    <td className={styles.needsOuting}>{t.names.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={styles.empty}>No picks yet. Picks from scouts and parents show up here as they come in.</div>
          )}
          {counts.held > 0 && (
            <p className={styles.boardEmpty}>
              {counts.held} {counts.held === 1 ? 'pick is' : 'picks are'} held for a later meeting and not counted here.
            </p>
          )}

          <h2 className={styles.sectionTitle}>Wanted, no teacher</h2>
          {data.wanted.length ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Topic</th>
                  <th className={styles.alignRight}>Wanted</th>
                  <th>Can teach it</th>
                </tr>
              </thead>
              <tbody>
                {data.wanted.map((w) => (
                  <tr key={w.key}>
                    <td>
                      <span className={styles.scoutName}>{w.label}</span>
                      <div className={styles.patrol}>
                        {w.codeLabel} · asked {w.weeks} {w.weeks === 1 ? 'week' : 'weeks'}
                      </div>
                      <div className={styles.patrol}>{w.names.join(', ')}</div>
                      {w.blocked && w.blocked.length > 0 && (
                        <div className={styles.teachMeta}>
                          {w.blocked.join(', ')} signed up, with no room for another session
                        </div>
                      )}
                    </td>
                    <td className={styles.alignRight}>{w.names.length}</td>
                    <td>
                      {w.canTeach.length ? <CanTeachCell list={w.canTeach} /> : <span className={styles.noTeacher}>Nobody on file</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className={styles.boardEmpty}>{data.topics.length ? 'Every request has a teacher.' : 'Nothing asked for yet.'}</p>
          )}

          <h2 className={styles.sectionTitle}>Offered, no takers</h2>
          {data.offered.length ? (
            <table className={styles.table}>
              <tbody>
                {data.offered.map((o) => (
                  <tr key={o.key}>
                    <td>
                      <span className={styles.scoutName}>{o.label}</span>
                      <div className={styles.patrol}>{o.codeLabel}</div>
                    </td>
                    <td>
                      <TeacherLinks list={o.teachers} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className={styles.boardEmpty}>None.</p>
          )}

          <h2 className={styles.sectionTitle}>Skill offers</h2>
          {data.skillOffers.length ? (
            <table className={styles.table}>
              <tbody>
                {data.skillOffers.map((o) => (
                  <tr key={`${o.personId}:${o.skill}`}>
                    <td>
                      <span className={styles.scoutName}>{o.skill}</span>
                      <div className={styles.patrol}>any requirement{o.note ? ` · ${o.note}` : ''}</div>
                    </td>
                    <td>
                      <Link href={entryFor(o.personId)} title={`Enter for ${o.name}`}>
                        {o.name}
                      </Link>
                    </td>
                    <td className={styles.alignRight}>{o.scouts ? `${o.scouts} ${o.scouts === 1 ? 'scout' : 'scouts'}` : 'no takers yet'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className={styles.boardEmpty}>None.</p>
          )}
        </div>
        <div>
          <h2 className={styles.sectionTitle}>Not sure yet</h2>
          <People
            list={data.undecided}
            empty="Nobody."
            extra={(p) => {
              const placed = data.undecided.find((x) => x.personId === p.personId)?.placed;
              return placed === undefined ? '' : placed ? `· placed in ${placed}` : '· nothing live fits yet';
            }}
          />
          <h2 className={styles.sectionTitle}>Can&rsquo;t make it</h2>
          <People
            list={data.notComing}
            empty="Nobody."
            extra={(p) => {
              const held = data.notComing.find((x) => x.personId === p.personId)?.held ?? 0;
              return held ? `· ${held} saved` : '';
            }}
          />
          {data.match ? (
            <>
              <h2 className={styles.sectionTitle}>Coming with nothing assigned</h2>
              {data.comingNothing.length ? (
                <ul className={styles.supplyList}>
                  {data.comingNothing.map((c) => (
                    <li key={c.personId}>
                      <Link href={entryFor(c.personId)} title={`Enter for ${c.name}`}>
                        {c.name}
                      </Link>
                      <div className={styles.patrol}>{c.suggestion ? `Engine: ${c.suggestion}` : 'Engine: merit badge work, or help teach'}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.boardEmpty}>Everyone coming has something.</p>
              )}
            </>
          ) : (
            <>
              <h2 className={styles.sectionTitle}>Coming with nothing picked</h2>
              <People list={data.comingNothing} empty="Everyone coming has picked something." />
            </>
          )}
          <h2 className={styles.sectionTitle}>No answer yet</h2>
          <People list={data.noAnswer} empty="Everyone has answered." />

          <h2 className={styles.sectionTitle}>Adults not sure yet</h2>
          {data.undecidedAdults.length ? (
            <ul className={styles.supplyList}>
              {data.undecidedAdults.map((a) => (
                <li key={a.personId}>
                  <Link href={entryFor(a.personId)} title={`Enter for ${a.name}`}>
                    {a.name}
                  </Link>
                  <div className={styles.patrol}>{a.fits.length ? `Could take: ${a.fits.join(', ')}` : 'Nothing wanted is in their skills'}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.boardEmpty}>Nobody.</p>
          )}
          <h2 className={styles.sectionTitle}>Adults who can&rsquo;t make it</h2>
          <People list={data.notComingAdults} empty="Nobody." />

          <EnterForSomeone data={data} />
        </div>
      </div>
    </>
  );
}

function EnterForSomeone({ data }: { data: ThisSundayData }) {
  return (
    <>
          <h2 className={styles.sectionTitle}>Enter for someone</h2>
          <form method="get" action="/member/meeting" className={styles.obForm}>
            <select name="for" aria-label="Person" className={styles.obSelect} defaultValue="" required>
              <option value="" disabled>
                Choose someone…
              </option>
              <optgroup label="Scouts">
                {data.scouts.map((s) => (
                  <option key={s.personId} value={s.personId}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Adults">
                {data.adultPeople.map((t) => (
                    <option key={t.personId} value={t.personId}>
                      {t.name}
                  </option>
                ))}
              </optgroup>
            </select>
            <Button type="submit" variant="secondary" size="sm">
              Open
            </Button>
          </form>
          <p className={styles.boardEmpty}>Took a pick or a teaching sign-up by phone or text? Open their page; it saves as entered by you.</p>
    </>
  );
}

/** A merit badge night (Phase 3b): stations and who teaches them, then the rotations editor. */
function MbNightView({ data, stat }: { data: ThisSundayData; stat: (n: number, label: string) => ReactNode }) {
  const mb = data.mb;
  if (!mb) return <Notice variant="info">Merit badge night: choose the badge above, then set its stations.</Notice>;
  const k = mb.kpis;
  return (
    <>
      <div className={styles.statsStrip}>
        {stat(k.inRotations, 'In rotations')}
        {stat(k.haveBadge, 'Have the badge')}
        {stat(k.notComing, 'Can’t make it')}
        {stat(k.noAnswer, 'No answer')}
        {stat(k.withTeacher, `of ${k.stations} stations have a teacher`)}
      </div>
      <h2 className={styles.sectionTitle}>{mb.mbName} stations</h2>
      {mb.stations.length ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Station</th>
              <th>Where</th>
              <th>Teacher</th>
            </tr>
          </thead>
          <tbody>
            {mb.stations.map((s) => (
              <tr key={s.index}>
                <td>{s.index + 1}</td>
                <td>
                  <span className={styles.scoutName}>{s.title}</span>
                  <div className={styles.patrol}>{s.codes}</div>
                </td>
                <td>{s.location ?? ''}</td>
                <td>{s.teachers.length ? <TeacherLinks list={s.teachers} /> : <span className={styles.noTeacher}>No teacher yet</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={styles.boardEmpty}>No stations yet. Set them in Board above.</p>
      )}
      <RotationsEditor
        key={JSON.stringify([mb.editor.groups, mb.editor.holders, mb.editor.noAnswer, mb.editor.stations, mb.editor.arranged])}
        data={mb.editor}
        readOnly={!data.board}
      />
      <div className={styles.boardCols}>
        <div>
          <h2 className={styles.sectionTitle}>Can&rsquo;t make it</h2>
          <People list={mb.notComing} empty="Nobody." />
          {mb.held > 0 && (
            <p className={styles.boardEmpty}>
              {mb.held} rank {mb.held === 1 ? 'pick is' : 'picks are'} held tonight and {mb.held === 1 ? 'comes' : 'come'} back at the next regular meeting.
            </p>
          )}
        </div>
        <div>
          <h2 className={styles.sectionTitle}>Adults not sure yet</h2>
          <People list={data.undecidedAdults} empty="Nobody." />
          <h2 className={styles.sectionTitle}>Adults who can&rsquo;t make it</h2>
          <People list={data.notComingAdults} empty="Nobody." />
          <EnterForSomeone data={data} />
        </div>
      </div>
    </>
  );
}
