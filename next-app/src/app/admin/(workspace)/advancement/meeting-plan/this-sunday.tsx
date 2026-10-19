/**
 * Meeting Plan › This Sunday (Phase 1 of Plans/Meeting-Requests-And-Teaching-Offers.md; prototype
 * prototypes/meeting-board/admin-plan.html): the live demand board for the next meeting. Who's coming (Coming / Not
 * sure yet / Can't make it / no answer; a pick counts as Coming), what scouts asked for and who asked, by name. A
 * leader enters for someone who phoned or texted through the member page itself (?for=), so the edit is the same
 * component the family uses and saves as entered by the leader. Polls a version stamp (BoardPoller).
 *
 * Phase 3a adds the live match, the block count and the board-mode switch here.
 */
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { fmtDateFull } from '@/lib/format-date';
import { loadBoardStamp, loadBoardState, loadNextMeeting, type BoardMeeting } from '@/lib/meeting-board';
import { topicWords } from '@/lib/meeting-board-picklist';
import { boardName, effectiveIntent, summarizeBoard, type BoardCounts } from '@/lib/meeting-board-shared';
import { Notice } from '../../_components/notice';
import { Button } from '../../../_components/button';
import { BoardPoller } from './board-poller';
import styles from './meeting-plan.module.css';

export interface BoardPerson {
  personId: number;
  name: string;
}

export interface ThisSundayData {
  meeting: Pick<BoardMeeting, 'entryId' | 'title' | 'mode'> & { dateLabel: string };
  stamp: string;
  counts: BoardCounts;
  topics: { key: string; label: string; codeLabel: string; names: string[] }[];
  undecided: BoardPerson[];
  notComing: (BoardPerson & { held: number })[];
  comingNothing: BoardPerson[];
  noAnswer: BoardPerson[];
  scouts: BoardPerson[];
}

export async function loadThisSunday(): Promise<ThisSundayData | null> {
  const sb = createAdminClient();
  const meeting = await loadNextMeeting(sb);
  if (!meeting) return null;
  const catalog = await loadAdvancementCatalog();
  const [rows, stamp] = await Promise.all([loadBoardState(sb, meeting, catalog), loadBoardStamp(sb, meeting.entryId)]);
  const { counts, demand } = summarizeBoard(rows);
  const nameOf = new Map(rows.map((r) => [r.personId, boardName(r.name)]));
  const person = (r: { personId: number }) => ({ personId: r.personId, name: nameOf.get(r.personId) ?? '' });
  const intentOf = new Map(rows.map((r) => [r.personId, effectiveIntent(r.intent, r.picks)]));
  const topics = [...demand]
    .map(([key, ids]) => {
      const w = topicWords(key, catalog.ranks, catalog.rankRequirements, catalog.meritBadges);
      return { key, label: w?.label ?? key, codeLabel: w?.codeLabel ?? '', names: ids.map((id) => nameOf.get(id) ?? '').sort() };
    })
    .sort((a, b) => b.names.length - a.names.length || a.codeLabel.localeCompare(b.codeLabel));
  return {
    meeting: { entryId: meeting.entryId, title: meeting.title, mode: meeting.mode, dateLabel: fmtDateFull(meeting.date) },
    stamp,
    counts,
    topics,
    undecided: rows.filter((r) => intentOf.get(r.personId) === 'undecided').map(person),
    notComing: rows.filter((r) => intentOf.get(r.personId) === 'not_coming').map((r) => ({ ...person(r), held: r.picks.length })),
    comingNothing: rows.filter((r) => intentOf.get(r.personId) === 'coming' && !r.picks.some((p) => !p.later)).map(person),
    noAnswer: rows.filter((r) => intentOf.get(r.personId) == null).map(person),
    scouts: rows.map(person).sort((a, b) => a.name.localeCompare(b.name))
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

      <div className={styles.boardCols}>
        <div>
          <h2 className={styles.sectionTitle}>What scouts asked for</h2>
          {data.topics.length ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Topic</th>
                  <th className={styles.alignRight}>Wanted</th>
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
        </div>
        <div>
          <h2 className={styles.sectionTitle}>Not sure yet</h2>
          <People list={data.undecided} empty="Nobody." />
          <h2 className={styles.sectionTitle}>Can&rsquo;t make it</h2>
          <People list={data.notComing} empty="Nobody." extra={(p) => {
            const held = data.notComing.find((x) => x.personId === p.personId)?.held ?? 0;
            return held ? `· ${held} saved` : '';
          }} />
          <h2 className={styles.sectionTitle}>Coming with nothing picked</h2>
          <People list={data.comingNothing} empty="Everyone coming has picked something." />
          <h2 className={styles.sectionTitle}>No answer yet</h2>
          <People list={data.noAnswer} empty="Everyone has answered." />

          <h2 className={styles.sectionTitle}>Enter for someone</h2>
          <form method="get" action="/member/meeting" className={styles.obForm}>
            <select name="for" aria-label="Scout" className={styles.obSelect} defaultValue="" required>
              <option value="" disabled>
                Choose a scout…
              </option>
              {data.scouts.map((s) => (
                <option key={s.personId} value={s.personId}>
                  {s.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary" size="sm">
              Open
            </Button>
          </form>
          <p className={styles.boardEmpty}>Took a pick by phone or text? Open their page; it saves as entered by you.</p>
        </div>
      </div>
    </>
  );
}
