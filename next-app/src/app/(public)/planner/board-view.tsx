/**
 * Who's coming, the Meeting Planner's attendance board (Plans/Meeting-Planner-II.md P1, design 1a; Build a Plan B4,
 * Decision 4 renamed the tab). Phone layout from prototypes/meeting-plan-II/phone/board.html.
 *
 * Everyone who may view sees everything (Decision 4). Editors (P2a) also get: every name opens that person's drawer,
 * Assign beside each person who could teach a request, "+ Add an offer", and Enter for someone. Viewers see the same
 * board with plain names and no buttons (the client pieces in planner-client.tsx check the planner context). P2b: Send
 * request, adults only. P5b: adult editors get "Remind everyone…" on Haven't answered (and "Remind" in each drawer).
 *
 * B4 (Build a Plan "Consolidation"): what the meeting offers is Build a Plan's job. The Meeting focus strip and the
 * seed drawer retired; the plan strip links to this meeting on /planner/build ("Edit the plan", "See the plan" for a
 * viewer) and keeps the board's one "+ Add an offer" (Decision 10a). The Ready to teach and Offered, no takers cards
 * moved into Build as row states (Ready / Needs scouts; their nudges are Build's Invite…). Requests with no teacher
 * stays: who among the people able to teach it is coming, Assign (teaches it and is marked Coming) and Send request
 * have no home in Build yet.
 *
 * Desktop: a header with the two attendance bars, the plan strip, then cards on the left (Requests with no teacher,
 * Haven't answered) and Who's coming on the right, then the Everyone wall. At 900px the right column drops under the
 * cards; on a phone the teacher lists and the Everyone wall's other columns fold.
 */
import type { ReactNode } from 'react';
import type { AttendanceCounts, CanTeachPerson, PlannerBoard, PlannerPerson, WallColumns } from '@/lib/meeting-planner-board';
import { minutesText } from '@/lib/meeting-board-picklist';
import { Fold } from './fold';
import { AddOfferButton, AdultsSendEmails, AssignButton, EnterForSomeone, PersonName, PlanLink, RemindEveryone, SendRequestButton, type SomeoneRow } from './planner-client';
import styles from './planner.module.css';

const KIND_LABEL = { rank: 'Rank', mb: 'Merit badge', ff: 'Other', focus: 'Focus' } as const;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A stacked bar: coming, not sure, can't; the empty track is "no answer". SVG so the widths are attributes. */
function AttendanceBar({ label, counts, tone }: { label: string; counts: AttendanceCounts; tone: 'scout' | 'adult' }) {
  const pct = (n: number) => (counts.total ? (n / counts.total) * 100 : 0);
  const segs = [
    { n: counts.coming, cls: tone === 'scout' ? styles.segScout : styles.segAdult },
    { n: counts.undecided, cls: styles.segUnsure },
    { n: counts.notComing, cls: styles.segCant }
  ];
  let x = 0;
  return (
    <div className={styles.bar}>
      <div className={styles.barHead}>
        <span>{label}</span>
        <span>{counts.total}</span>
      </div>
      <svg className={styles.barTrack} viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden="true">
        {segs.map((s, i) => {
          const r = <rect key={i} x={x} y={0} width={pct(s.n)} height={14} className={s.cls} />;
          x += pct(s.n);
          return r;
        })}
      </svg>
      <p className={styles.barLegend}>
        <strong className={tone === 'scout' ? styles.legendScout : styles.legendAdult}>● {counts.coming} coming</strong> · {counts.undecided} not sure · {counts.notComing} can’t · {counts.noAnswer} no answer
      </p>
    </div>
  );
}

function Card({ tone, badge, title, summary, action, children }: { tone: 'ready' | 'need' | 'offer' | 'quiet'; badge: string; title: string; summary: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.card}>
      <header className={`${styles.band} ${styles[tone]}`}>
        <span className={styles.bandBadge} aria-hidden="true">
          {badge}
        </span>
        <h2 className={styles.bandTitle}>{title}</h2>
        <span className={styles.bandSummary}>{summary}</span>
        {action}
      </header>
      {children}
    </section>
  );
}

function Chips({ people, adult }: { people: readonly PlannerPerson[]; adult?: boolean }) {
  return (
    <ul className={styles.chips}>
      {people.map((p) => (
        <li key={p.personId}>
          <PersonName personId={p.personId} name={p.name} className={adult ? styles.chipAdult : styles.chip} />
        </li>
      ))}
    </ul>
  );
}

function TeacherGroup({ label, tone, people, topic }: { label: string; tone: 'coming' | 'unsure' | 'none'; people: readonly CanTeachPerson[]; topic: { key: string; title: string; kind: string } }) {
  if (!people.length) return null;
  return (
    <>
      <li className={`${styles.groupHead} ${styles[`group_${tone}`]}`}>
        {label} · {people.length}
      </li>
      {people.map((p) => (
        <li key={p.personId} className={styles.teacherRow}>
          <span className={styles.teacherWho}>
            <PersonName personId={p.personId} name={p.name} className={styles.teacherName} />
            <span className={styles.teacherStatus}>
              {p.status}
              {p.requested ? ' · request sent' : ''}
            </span>
          </span>
          <span className={styles.rowActions}>
            {topic.kind !== 'ff' && topic.kind !== 'focus' ? <SendRequestButton personId={p.personId} name={p.name} topicKey={topic.key} title={topic.title} requested={p.requested} /> : null}
            <AssignButton personId={p.personId} name={p.name} topicKey={topic.key} title={topic.title} />
          </span>
        </li>
      ))}
    </>
  );
}

function Wall({ title, cols, tone }: { title: string; cols: WallColumns; tone: 'scout' | 'adult' }) {
  const col = (label: string, tiles: WallColumns['coming'], phoneOpen = false) => (
    <Fold className={styles.wallCol} summaryClassName={styles.wallColHead} summary={`${label} · ${tiles.length}`} phoneOpen={phoneOpen}>
      <ul className={styles.tiles}>
        {tiles.map((t) => (
          <li key={t.personId} className={tone === 'adult' ? styles.tileAdult : styles.tile}>
            <PersonName personId={t.personId} name={t.name} className={styles.tileName} />
            {t.tag ? <span className={styles.tileTag}>{t.tag}</span> : null}
          </li>
        ))}
      </ul>
    </Fold>
  );
  return (
    <section className={styles.wallCard}>
      <h3 className={tone === 'adult' ? styles.wallHeadAdult : styles.wallHead}>{title}</h3>
      <div className={styles.wallGrid}>
        {col('Coming', cols.coming, true)}
        {col('Not sure', cols.undecided)}
        {col('Can’t', cols.notComing)}
        {col('No answer', cols.noAnswer)}
      </div>
    </section>
  );
}

/** The Planner tag on a requirement the planning team put on the plan (Build a Plan's origin word; a focus set says so already). */
const FocusTag = ({ seededBy, kind }: { seededBy?: string | null; kind: string }) => (seededBy != null && kind !== 'focus' ? <span className={styles.kindFocus}>Planner</span> : null);

const ANSWER_WORD = { coming: 'Coming', undecided: 'Not sure', notComing: 'Can’t', noAnswer: 'No answer' } as const;

/** Everyone on the board, for Enter for someone: scouts, then adults, with their answer. */
function someone(board: PlannerBoard): SomeoneRow[] {
  const rows = (cols: WallColumns, role: SomeoneRow['role']) =>
    (Object.keys(ANSWER_WORD) as (keyof WallColumns)[]).flatMap((k) => cols[k].map((t) => ({ personId: t.personId, name: t.name, role, answer: ANSWER_WORD[k] })));
  return [...rows(board.everyone.scouts, 'Scout'), ...rows(board.everyone.adults, 'Adult')].sort((a, b) => a.name.localeCompare(b.name));
}

export function PlannerBoardView({ board, heading, entryId }: { board: PlannerBoard; heading: ReactNode; entryId: number }) {
  const waitingTotal = new Set(board.noTeacher.flatMap((r) => r.waiting.map((p) => p.personId))).size;
  const { scouts: hs, adults: ha } = board.haventAnswered;
  return (
    <>
      <header className={styles.head}>
        {heading}
        <div className={styles.headBars}>
          <AttendanceBar label="Scouts" counts={board.attendance.scouts} tone="scout" />
          <AttendanceBar label="Adults" counts={board.attendance.adults} tone="adult" />
        </div>
      </header>
      <section className={styles.planStrip} aria-label="This meeting’s plan">
        <PlanLink entryId={entryId} />
        <AddOfferButton />
      </section>

      <div className={styles.body}>
        <div className={styles.left}>
          <Card tone="need" badge="1" title="Requests with no teacher" summary={`${plural(board.noTeacher.length, 'topic')} · ${plural(waitingTotal, 'scout')} waiting`}>
            <AdultsSendEmails />
            {board.noTeacher.length ? (
              <ul className={styles.rows}>
                {board.noTeacher.map((r) => (
                  <li key={r.key} className={styles.needRow}>
                    <div>
                      <p className={styles.tagLine}>
                        <span className={styles.code}>{r.codeLabel}</span>
                        {r.kind !== 'focus' ? <span className={r.kind === 'mb' ? styles.kindMb : styles.kindRank}>{KIND_LABEL[r.kind]}</span> : null}
                        {r.minutes ? <span className={styles.meta}>{minutesText(r.minutes)}</span> : null}
                        <FocusTag seededBy={r.seededBy} kind={r.kind} />
                      </p>
                      <p className={styles.bigTitle}>{r.title}</p>
                      <p className={styles.waitLine}>
                        {r.waiting.length
                          ? `${plural(r.waiting.length, 'scout')} waiting${r.weeks > 1 ? ` · asked ${r.weeks} weeks running` : ''}`
                          : 'On the plan · no scouts picked it yet'}
                      </p>
                      {r.seededBy ? <p className={styles.meta}>Added by {r.seededBy}</p> : null}
                      <Chips people={r.waiting} />
                    </div>
                    <Fold
                      className={styles.canTeach}
                      summaryClassName={styles.canTeachHead}
                      summary={
                        <>
                          {r.canTeach.total === 1 ? '1 person can teach this' : `${r.canTeach.total} people can teach this`} <span className={styles.canTeachHint}>grouped by their answer</span>
                        </>
                      }
                    >
                      {r.canTeach.total ? (
                        <ul className={styles.teacherList}>
                          <TeacherGroup label="Coming" tone="coming" people={r.canTeach.coming} topic={r} />
                          <TeacherGroup label="Not sure yet" tone="unsure" people={r.canTeach.undecided} topic={r} />
                          <TeacherGroup label="Haven’t answered" tone="none" people={r.canTeach.noAnswer} topic={r} />
                        </ul>
                      ) : (
                        <p className={styles.empty}>Nobody on file can teach this yet.</p>
                      )}
                    </Fold>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>Every request has a teacher.</p>
            )}
          </Card>

          <Card tone="quiet" badge="3" title="Haven’t answered" summary={`${plural(hs.length, 'scout')} · ${plural(ha.length, 'adult')}`}>
            <div className={styles.cardBody}>
              {hs.length ? (
                <>
                  <h3 className={styles.listLabel}>Scouts · {hs.length}</h3>
                  <Chips people={hs} />
                </>
              ) : null}
              {ha.length ? (
                <>
                  <h3 className={styles.listLabel}>Adults · {ha.length}</h3>
                  <Chips people={ha} adult />
                </>
              ) : null}
              {!hs.length && !ha.length ? <p className={styles.empty}>Everyone has answered.</p> : null}
              <RemindEveryone personIds={[...hs, ...ha].map((x) => x.personId)} />
            </div>
          </Card>
        </div>

        <aside className={styles.right}>
          <EnterForSomeone people={someone(board)} />
          <section className={styles.sideCard}>
            <h2 className={styles.sideTitle}>
              Who’s coming{' '}
              <span className={styles.meta}>
                {plural(board.whosComing.scouts.length, 'scout')} · {plural(board.whosComing.adults.length, 'adult')}
              </span>
            </h2>
            {(['scouts', 'adults'] as const).map((k) =>
              board.whosComing[k].length ? (
                <div key={k}>
                  <h3 className={styles.listLabel}>{k === 'scouts' ? 'Scouts' : 'Adults'}</h3>
                  <ul className={styles.comingList}>
                    {board.whosComing[k].map((p) => (
                      <li key={p.personId} className={styles.comingRow}>
                        <PersonName personId={p.personId} name={p.name} className={styles.comingName} />
                        <span className={p.nothingYet ? styles.comingNudge : styles.comingDetail}>{p.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null
            )}
          </section>
          <section className={styles.sideCard}>
            <h3 className={styles.sideSubtitle}>Not sure yet</h3>
            {board.notSure.length ? <Chips people={board.notSure} /> : <p className={styles.meta}>Nobody.</p>}
            <h3 className={styles.sideSubtitle}>Can’t make it</h3>
            {board.cantMakeIt.length ? (
              <ul className={styles.chips}>
                {board.cantMakeIt.map((p) => (
                  <li key={p.personId}>
                    <PersonName personId={p.personId} name={`${p.name}${p.saved ? ` · ${p.saved} saved for later` : ''}`} className={styles.chipMuted} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.meta}>Nobody.</p>
            )}
          </section>
        </aside>
      </div>

      <section className={styles.everyone}>
        <h2 className={styles.everyoneTitle}>Everyone</h2>
        <Wall title="Scouts" cols={board.everyone.scouts} tone="scout" />
        <Wall title="Adults" cols={board.everyone.adults} tone="adult" />
      </section>
    </>
  );
}
