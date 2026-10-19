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
 * Phase 3a adds the live match, the block count and the board-mode switch here.
 */
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { fmtDateFull } from '@/lib/format-date';
import { loadBoardStamp, loadBoardState, loadNextMeeting, type BoardMeeting } from '@/lib/meeting-board';
import { topicWords } from '@/lib/meeting-board-picklist';
import { boardName, effectiveIntent, summarizeBoard, type BoardCounts, type Intent } from '@/lib/meeting-board-shared';
import { assessTeacher, commitmentCounts, flagText, teacherIntent, teacherName, topicSkill, weeksAsked } from '@/lib/meeting-board-teach';
import { loadTeachBoard } from '@/lib/meeting-board-supply';
import { Notice } from '../../_components/notice';
import { Button } from '../../../_components/button';
import { BoardPoller } from './board-poller';
import styles from './meeting-plan.module.css';

export interface BoardPerson {
  personId: number;
  name: string;
}

export interface SupplyTeacher extends BoardPerson {
  /** "from a First Aid offer", "sign-off needs a counselor", "not in their skills". */
  notes: string[];
}

export interface ThisSundayData {
  meeting: Pick<BoardMeeting, 'entryId' | 'title' | 'mode'> & { dateLabel: string };
  stamp: string;
  counts: BoardCounts;
  /** Adults and Junior Leaders who answered or signed up to teach (a commitment counts as Coming). */
  adults: { coming: number; undecided: number; notComing: number; teaching: number };
  topics: { key: string; label: string; codeLabel: string; names: string[]; teachers: SupplyTeacher[] }[];
  /** The recruiting list: asked for, nobody teaching. */
  wanted: { key: string; label: string; codeLabel: string; names: string[]; weeks: number; canTeach: (BoardPerson & { note: string })[] }[];
  /** Put on the board by a teacher, asked for by nobody. */
  offered: { key: string; label: string; codeLabel: string; teachers: SupplyTeacher[] }[];
  skillOffers: (BoardPerson & { skill: string; note: string | null; scouts: number })[];
  undecidedAdults: (BoardPerson & { fits: string[] })[];
  notComingAdults: BoardPerson[];
  undecided: BoardPerson[];
  notComing: (BoardPerson & { held: number })[];
  comingNothing: BoardPerson[];
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
  const wanted = teach.match.wanted
    .map((key) => {
      const t = topics.find((x) => x.key === key)!;
      const canTeach = pool
        .filter((p) => assessTeacher(p, key, teach.ctx).qualified && adultIntent(p.personId) !== 'not_coming')
        .map((p) => {
          const it = adultIntent(p.personId);
          const n = commits.get(p.personId) ?? 0;
          return { ...teacherPerson(p.personId), note: `${it ? INTENT_WORD[it] : 'no answer'}${n ? `, teaching ${n}` : ''}` };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      return { key, label: t.label, codeLabel: t.codeLabel, names: t.names, weeks: weeksAsked(firstAsked.get(key) ?? [], meeting.date), canTeach };
    })
    .sort((a, b) => b.names.length - a.names.length || b.weeks - a.weeks);
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
  const undecidedAdults = adultIds
    .filter((id) => adultIntent(id) === 'undecided')
    .map((id) => ({ ...teacherPerson(id), fits: teach.match.wanted.filter((k) => assessTeacher(teach.people.get(id)!, k, teach.ctx).qualified).map((k) => words(k).codeLabel || words(k).label) }));

  const byName = (a: BoardPerson, b: BoardPerson) => a.name.localeCompare(b.name);
  return {
    meeting: { entryId: meeting.entryId, title: meeting.title, mode: meeting.mode, dateLabel: fmtDateFull(meeting.date) },
    stamp,
    counts,
    adults,
    topics,
    wanted,
    offered,
    skillOffers,
    undecidedAdults: undecidedAdults.sort(byName),
    notComingAdults: adultIds.filter((id) => adultIntent(id) === 'not_coming').map(teacherPerson).sort(byName),
    undecided: rows.filter((r) => intentOf.get(r.personId) === 'undecided').map(person),
    notComing: rows.filter((r) => intentOf.get(r.personId) === 'not_coming').map((r) => ({ ...person(r), held: r.picks.length })),
    comingNothing: rows.filter((r) => intentOf.get(r.personId) === 'coming' && !r.picks.some((p) => !p.later)).map(person),
    noAnswer: rows.filter((r) => intentOf.get(r.personId) == null).map(person),
    scouts: rows.map(person).sort(byName),
    adultPeople: pool.filter((p) => p.kind === 'adult').map((p) => teacherPerson(p.personId)).sort(byName)
  };
}

export async function ThisSundayTab() {
  return <ThisSundayView data={await loadThisSunday()} />;
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

export function ThisSundayView({ data }: { data: ThisSundayData | null }) {
  if (!data) return <div className={styles.empty}>There&rsquo;s no troop meeting on the calendar yet.</div>;
  const { meeting, counts } = data;
  const head = (
    <div className={styles.boardHead}>
      <span className={styles.boardWhen}>
        {meeting.dateLabel} · {meeting.title}
      </span>
      {meeting.mode !== 'closed' && <BoardPoller entryId={meeting.entryId} stamp={data.stamp} />}
    </div>
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
          <People list={data.undecided} empty="Nobody." />
          <h2 className={styles.sectionTitle}>Can&rsquo;t make it</h2>
          <People
            list={data.notComing}
            empty="Nobody."
            extra={(p) => {
              const held = data.notComing.find((x) => x.personId === p.personId)?.held ?? 0;
              return held ? `· ${held} saved` : '';
            }}
          />
          <h2 className={styles.sectionTitle}>Coming with nothing picked</h2>
          <People list={data.comingNothing} empty="Everyone coming has picked something." />
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
