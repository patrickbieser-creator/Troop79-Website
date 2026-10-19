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
 */
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { fmtDateFull } from '@/lib/format-date';
import { loadBoardStamp, loadBoardState, loadNextMeeting, type BoardMeeting } from '@/lib/meeting-board';
import { topicWords } from '@/lib/meeting-board-picklist';
import { boardName, effectiveIntent, summarizeBoard, type BoardCounts, type BoardMode, type Intent } from '@/lib/meeting-board-shared';
import { seatsFor, sessionWords } from '@/lib/meeting-board-match';
import { assessTeacher, commitmentCounts, flagText, teacherIntent, teacherName, topicSkill, weeksAsked } from '@/lib/meeting-board-teach';
import { loadLiveMatch, loadTeachBoard } from '@/lib/meeting-board-supply';
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
  blocks: { label: string; sessions: MatchCard[] }[];
  sessions: number;
  /** The meeting editor's Agenda tab, whose tray promotes these. */
  agendaHref: string;
}

export interface ThisSundayData {
  meeting: Pick<BoardMeeting, 'entryId' | 'title' | 'mode'> & { dateLabel: string };
  /** Board settings (Phase 3a): the saved mode, badge and block count, the badges an MB night can use. */
  board?: { mode: BoardMode; mbId: string; blockCount: number; badges: { id: string; name: string }[] };
  /** The live match (Phase 3a, rank boards only). */
  match?: ThisSundayMatch | null;
  stamp: string;
  counts: BoardCounts;
  /** Adults and Junior Leaders who answered or signed up to teach (a commitment counts as Coming). */
  adults: { coming: number; undecided: number; notComing: number; teaching: number };
  topics: { key: string; label: string; codeLabel: string; names: string[]; teachers: SupplyTeacher[] }[];
  /** The recruiting list: asked for, nobody teaching. `blocked`: committed teachers with no free block for it. */
  wanted: { key: string; label: string; codeLabel: string; names: string[]; weeks: number; canTeach: (BoardPerson & { note: string })[]; blocked?: string[] }[];
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
  const canTeachNote = (id: number) => {
    const it = adultIntent(id);
    const n = commits.get(id) ?? 0;
    return { ...teacherPerson(id), note: `${it ? INTENT_WORD[it] : 'no answer'}${n ? `, teaching ${n}` : ''}` };
  };

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
          canTeach: w.canTeach.filter((id) => adultIntent(id) !== 'not_coming').map(canTeachNote).sort((a, b) => a.name.localeCompare(b.name)),
          blocked: w.blockedTeacherIds.map((id) => teacherPerson(id).name)
        };
      })
    : teach.match.wanted
        .map((key) => {
          const t = topics.find((x) => x.key === key)!;
          const canTeach = pool
            .filter((p) => assessTeacher(p, key, teach.ctx).qualified && adultIntent(p.personId) !== 'not_coming')
            .map((p) => canTeachNote(p.personId))
            .sort((a, b) => a.name.localeCompare(b.name));
          return { key, label: t.label, codeLabel: t.codeLabel, names: t.names, weeks: weeksAsked(firstAsked.get(key) ?? [], meeting.date), canTeach };
        })
        .sort((a, b) => b.names.length - a.names.length || b.weeks - a.weeks);
  const matchView: ThisSundayMatch | null = match
    ? {
        sessions: match.sessions.length,
        agendaHref: `/admin/calendar/${meeting.entryId}?tab=agenda`,
        blocks: Array.from({ length: match.blockCount }, (_, b) => ({
          label: `Block ${b + 1}`,
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
  return {
    meeting: { entryId: meeting.entryId, title: meeting.title, mode: meeting.mode, dateLabel: fmtDateFull(meeting.date) },
    board: {
      mode: meeting.mode,
      mbId: meeting.mbId ?? '',
      blockCount: meeting.blockCount,
      badges: catalog.meritBadges
        .filter((m) => badgesWithReqs.has(m.id))
        .map((m) => ({ id: m.id, name: m.name }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },
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

/**
 * The live match, a column per block (Phase 3a). Read-only: the meeting editor's tray is the one place a session
 * becomes an agenda item. Shared by This Sunday and the Group Sessions tab.
 */
export function MatchBlocks({ match, linkPeople = true }: { match: ThisSundayMatch; linkPeople?: boolean }) {
  const who = (p: BoardPerson, extra?: string) =>
    linkPeople ? (
      <Link key={p.personId} className={styles.chip} href={entryFor(p.personId)} title={`Enter for ${p.name}`}>
        {p.name}
        {extra ? <span className={styles.chipRank}> {extra}</span> : null}
      </Link>
    ) : (
      <span key={p.personId} className={styles.chip}>
        {p.name}
        {extra ? <span className={styles.chipRank}> {extra}</span> : null}
      </span>
    );
  return (
    <div className={styles.blockCols}>
      {match.blocks.map((b) => (
        <section key={b.label} aria-label={b.label}>
          <h3 className={styles.blockHead}>{b.label}</h3>
          {b.sessions.length ? (
            b.sessions.map((s) => (
              <article key={s.id} className={styles.sessionCard}>
                <span className={styles.reqCode}>
                  {s.codeLabel}
                  {s.group ? ` · Group ${s.group}` : ''}
                </span>
                <h3>{s.title}</h3>
                <div className={styles.chips}>{s.scouts.map((x) => who(x, x.why))}</div>
                <div className={styles.teachSlot}>
                  <span className={styles.teachLabel}>Teacher</span>
                  <TeacherLinks list={[s.teacher]} />
                  {s.coTeachers.length > 0 && <span className={styles.teachMeta}> with {s.coTeachers.map((c) => c.name).join(', ')}</span>}
                </div>
              </article>
            ))
          ) : (
            <p className={styles.boardEmpty}>Nothing matched for this block yet.</p>
          )}
        </section>
      ))}
    </div>
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
          key={`${data.board.mode}:${data.board.mbId}:${data.board.blockCount}`}
          entryId={meeting.entryId}
          initial={{ mode: data.board.mode, mbId: data.board.mbId, blockCount: data.board.blockCount }}
          badges={data.board.badges}
          picks={counts.picks}
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
  const stat = (n: number, label: string) => (
    <div className={styles.stat}>
      <div className={styles.statNum}>{n}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
  return (
    <>
      {head}
      {meeting.mode === 'merit_badge' && <Notice variant="info">Merit badge night: scouts say whether they&rsquo;re coming, and pick nothing.</Notice>}
      <div className={styles.statsStrip}>
        {stat(counts.coming, 'Scouts coming')}
        {stat(counts.undecided, 'Not sure yet')}
        {stat(counts.notComing, 'Can’t make it')}
        {stat(counts.noAnswer, 'No answer')}
        {stat(counts.picks, 'Picks')}
      </div>
      <div className={styles.statsStrip}>
        {stat(data.adults.coming, 'Adults coming')}
        {stat(data.adults.undecided, 'Adults not sure yet')}
        {stat(data.adults.notComing, 'Adults can’t make it')}
        {stat(data.adults.teaching, 'Teaching')}
        {stat(data.wanted.length, 'Wanted, no teacher')}
      </div>

      {data.match && (
        <section aria-label="Live match" className={styles.matchSection}>
          <div className={styles.boardHead}>
            <h2 className={styles.sectionTitle}>Live match</h2>
            <span className={styles.teachMeta}>at most 2 topics a scout · 8 a session · rematches on every sign-up</span>
            <Link href={data.match.agendaHref}>Add sessions in the meeting editor</Link>
          </div>
          <MatchBlocks match={data.match} />
        </section>
      )}

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
                          {w.blocked.join(', ')} signed up, with no free block for it
                        </div>
                      )}
                    </td>
                    <td className={styles.alignRight}>{w.names.length}</td>
                    <td>
                      {w.canTeach.length ? (
                        w.canTeach.map((c, i) => (
                          <span key={c.personId}>
                            {i > 0 ? ', ' : ''}
                            <Link href={entryFor(c.personId)} title={`Enter for ${c.name}`}>
                              {c.name}
                            </Link>
                            <span className={styles.teachMeta}> ({c.note})</span>
                          </span>
                        ))
                      ) : (
                        <span className={styles.noTeacher}>Nobody on file</span>
                      )}
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
        </div>
      </div>
    </>
  );
}
