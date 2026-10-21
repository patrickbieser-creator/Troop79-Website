/**
 * The Meeting Planner's This Sunday board, design 1a, read-only (Plans/Meeting-Planner-II.md, P1;
 * prototypes/meeting-plan-II/README.md "Screen 1", phone layout from prototypes/meeting-plan-II/phone/board.html).
 *
 * Everyone who may view sees everything (Decision 4). Editors (P2a) also get: every name opens that person's drawer,
 * Assign beside each person who could teach a request, "+ Add an offer", and Enter for someone. Viewers see the same
 * board with plain names and no buttons (the client pieces in planner-client.tsx check the planner context). Send
 * request and nudges are P2b. P3: the Meeting focus strip lists what was seeded ("Seed this meeting" for the planning
 * team); a seeded topic carries a Focus tag, and one nobody picked yet still asks for a teacher.
 *
 * Desktop: a header with the two attendance bars, then cards on the left (Ready to teach, Requests with no teacher,
 * Offered no takers, Haven't answered) and Who's coming on the right, then the Everyone wall. At 900px the right
 * column drops under the cards; on a phone the teacher lists and the Everyone wall's other columns fold.
 */
import type { ReactNode } from 'react';
import type { AttendanceCounts, CanTeachPerson, FocusChip, PlannerBoard, PlannerPerson, WallColumns } from '@/lib/meeting-planner-board';
import { minutesText } from '@/lib/meeting-board-picklist';
import { Fold } from './fold';
import { AddOfferButton, AdultsSendEmails, AssignButton, EnterForSomeone, NudgeButton, PersonName, SeedButton, SendRequestButton, type SomeoneRow } from './planner-client';
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

/** The Meeting focus strip: one chip per seeded topic, "{teacher | no teacher} · N scouts". */
function FocusStrip({ focus }: { focus: readonly FocusChip[] }) {
  return (
    <section className={styles.focusStrip} aria-label="Meeting focus">
      <h2 className={styles.focusLabel}>Meeting focus</h2>
      {focus.length ? (
        <ul className={styles.focusChips}>
          {focus.map((f) => (
            <li key={f.key} className={f.teachers.length ? styles.focusChipMatched : styles.focusChip}>
              <span className={styles.focusChipTitle}>{f.title}</span>
              <span>
                {f.teachers.length ? f.teachers.join(', ') : 'no teacher'} · {plural(f.scouts, 'scout')}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.focusNone}>Nothing seeded yet.</p>
      )}
      <SeedButton focus={focus} />
    </section>
  );
}

/** The Focus tag on a seeded requirement (a focus group's own code line already says "Meeting focus"). */
const FocusTag = ({ seededBy, kind }: { seededBy?: string | null; kind: string }) => (seededBy != null && kind !== 'focus' ? <span className={styles.kindFocus}>Focus</span> : null);

const ANSWER_WORD = { coming: 'Coming', undecided: 'Not sure', notComing: 'Can’t', noAnswer: 'No answer' } as const;

/** Everyone on the board, for Enter for someone: scouts, then adults, with their answer. */
function someone(board: PlannerBoard): SomeoneRow[] {
  const rows = (cols: WallColumns, role: SomeoneRow['role']) =>
    (Object.keys(ANSWER_WORD) as (keyof WallColumns)[]).flatMap((k) => cols[k].map((t) => ({ personId: t.personId, name: t.name, role, answer: ANSWER_WORD[k] })));
  return [...rows(board.everyone.scouts, 'Scout'), ...rows(board.everyone.adults, 'Adult')].sort((a, b) => a.name.localeCompare(b.name));
}

export function PlannerBoardView({ board, heading, canSeed = false }: { board: PlannerBoard; heading: ReactNode; canSeed?: boolean }) {
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
      {board.focus.length || canSeed ? <FocusStrip focus={board.focus} /> : null}

      <div className={styles.body}>
        <div className={styles.left}>
          <Card tone="ready" badge="✓" title="Ready to teach" summary={plural(board.ready.length, 'session')} action={<AddOfferButton />}>
            {board.ready.length ? (
              <ul className={styles.rows}>
                {board.ready.map((r) => (
                  <li key={r.key} className={styles.readyRow}>
                    <div>
                      <p className={styles.codeLine}>
                        <span className={styles.code}>{r.codeLabel}</span> <span className={styles.rowTitle}>{r.title}</span> <FocusTag seededBy={r.seededBy} kind={r.kind} />
                      </p>
                      <Chips people={r.scouts} />
                    </div>
                    <div className={styles.readyTeacher}>
                      <p className={styles.teacherName}>
                        {r.teachers.map((t, i) => (
                          <span key={t.personId}>
                            {i ? ', ' : ''}
                            <PersonName personId={t.personId} name={t.name} />
                          </span>
                        ))}
                      </p>
                      <p className={styles.meta}>
                        {plural(r.scouts.length, 'scout')}
                        {r.minutes ? ` · ${minutesText(r.minutes)}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>Nothing is ready yet. A session shows up here once it has a teacher and at least one scout.</p>
            )}
          </Card>

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
                          : 'Seeded focus · no scouts picked it yet'}
                      </p>
                      {r.seededBy ? <p className={styles.meta}>Seeded by {r.seededBy}</p> : null}
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

          <Card tone="offer" badge="2" title="Offered, no takers yet" summary={plural(board.offered.length, 'offer')} action={<AddOfferButton />}>
            {board.offered.length ? (
              <ul className={styles.rows}>
                {board.offered.map((o) => (
                  <li key={o.key} className={styles.offerRow}>
                    <p className={styles.tagLine}>
                      <span className={styles.code}>{o.codeLabel}</span>
                      <FocusTag seededBy={o.seededBy} kind={o.kind} />
                      <span className={styles.meta}>
                        Offered by{' '}
                        {o.teachers.map((t, i) => (
                          <span key={t.personId}>
                            {i ? ', ' : ''}
                            <PersonName personId={t.personId} name={t.name} />
                          </span>
                        ))}
                      </span>
                    </p>
                    <p className={styles.bigTitle}>{o.title}</p>
                    {o.likelyFits.length ? (
                      <div className={styles.fits}>
                        <span className={styles.meta}>Likely fits:</span>
                        <Chips people={o.likelyFits} />
                      </div>
                    ) : null}
                    {o.kind === 'rank' ? <NudgeButton topicKey={o.key} title={o.title} codeLabel={o.codeLabel} teachers={o.teachers.map((t) => t.name).join(', ')} /> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>Every offer has scouts.</p>
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
