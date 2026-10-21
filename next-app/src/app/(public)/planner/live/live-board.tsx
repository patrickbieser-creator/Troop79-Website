'use client';

/**
 * Meeting Live, read-only (Plans/Meeting-Planner-II.md P4a; prototypes/meeting-plan-II/Meeting Live.dc.html and
 * phone/live.html). Desktop: a Not scheduled column, then one column per rotation. Phone (≤ 640 px): one column at a
 * time under a sticky rotation switcher. Each card: code, title, a repeat tag, the teacher, the scouts (a small star
 * when it's a retake, 8c), and its conflict lines (shown, never enforced, 8d).
 *
 * Before anyone starts Meeting Live the cards are the matcher's preview; an editor gets one "Start Meeting Live" that
 * saves it (P4a proves the snapshot path; P4b adds the editing controls, P4c attendance).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import type { LiveCard, LiveView } from '@/lib/meeting-live-shared';
import { plannerLiveStartAction } from '../live-actions';
import styles from './live.module.css';

const FAILED = 'That didn’t save. Check your connection and try again.';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

interface Column {
  key: string;
  rotation: number | null;
  label: string;
  short: string;
  location: string | null;
}

export function LiveBoard({ view, canEdit, entryId }: { view: LiveView; canEdit: boolean; entryId: number }) {
  const router = useRouter();
  const columns: Column[] = [
    { key: 'u', rotation: null, label: 'Not scheduled', short: 'Not scheduled', location: null },
    ...view.rotations.map((r) => ({ key: String(r.number), rotation: r.number, label: `Rotation ${r.number}`, short: `R${r.number}`, location: r.location }))
  ];
  const [tab, setTab] = useState(columns[1]?.key ?? 'u');
  const [start, setStart] = useState<'idle' | 'starting' | string>('idle');
  const cardsIn = (c: Column) => view.cards.filter((x) => x.rotation === c.rotation);

  const begin = async () => {
    setStart('starting');
    try {
      const res = await plannerLiveStartAction({ entryId });
      if (!res.ok) return setStart(res.error);
      setStart('idle');
      router.refresh();
    } catch {
      setStart(FAILED);
    }
  };

  return (
    <div className={styles.live}>
      {!view.started || view.overlaps ? (
        <div className={styles.bar}>
          {!view.started ? (
            <p className={styles.preview}>
              The board’s match so far. It changes as answers come in until Meeting Live starts.
            </p>
          ) : null}
          {!view.started && canEdit ? (
            <span className={styles.startWrap}>
              <Button onClick={begin} disabled={start === 'starting'}>
                {start === 'starting' ? 'Starting…' : 'Start Meeting Live'}
              </Button>
              {start !== 'idle' && start !== 'starting' ? (
                <span className={styles.problem} role="alert">
                  {start}
                </span>
              ) : null}
            </span>
          ) : null}
          {view.overlaps ? <span className={styles.overlaps}>{plural(view.overlaps, 'overlap')}</span> : null}
        </div>
      ) : null}

      <div className={styles.switcher} role="tablist" aria-label="Rotations">
        {columns.map((c) => {
          const n = cardsIn(c).length + (c.rotation == null && view.pool.length ? 1 : 0);
          const warn = cardsIn(c).some((x) => x.conflicts.length);
          return (
            <button
              key={c.key}
              type="button"
              role="tab"
              id={`live-tab-${c.key}`}
              aria-selected={tab === c.key}
              aria-controls={`live-col-${c.key}`}
              aria-label={`${c.label}${c.location ? `, ${c.location}` : ''}, ${plural(n, c.rotation == null ? 'item' : 'class', c.rotation == null ? 'items' : 'classes')}${warn ? ', has overlaps' : ''}`}
              className={styles.tab}
              onClick={() => setTab(c.key)}
            >
              <span className={styles.tabLabel}>
                {c.short}
                <span className={styles.tabCount}>{n}</span>
              </span>
              {c.location ? <span className={styles.tabLoc}>{c.location}</span> : null}
              {warn ? <span className={styles.tabWarn} aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>

      <div className={styles.columns}>
        {columns.map((c) => {
          const cards = cardsIn(c);
          const scouts = new Set(cards.flatMap((x) => x.members.map((m) => m.personId))).size;
          const teachers = new Set(cards.map((x) => x.teacher?.personId).filter((id) => id != null)).size;
          return (
            <section
              key={c.key}
              id={`live-col-${c.key}`}
              aria-labelledby={`live-h-${c.key}`}
              data-phone={tab === c.key ? 'shown' : 'hidden'}
              className={c.rotation == null ? styles.unscheduledCol : styles.column}
            >
              <header className={styles.colHead}>
                <h2 id={`live-h-${c.key}`} className={styles.colTitle}>
                  {c.label}
                </h2>
                {c.location ? <p className={styles.location}>{c.location}</p> : null}
                {c.rotation != null && cards.length ? (
                  <p className={styles.colSum}>
                    {plural(cards.length, 'class', 'classes')} · {plural(scouts, 'scout')} · {plural(teachers, 'teacher')}
                  </p>
                ) : null}
              </header>
              {c.rotation == null ? (
                <section className={styles.pool} aria-labelledby="live-pool">
                  <h3 id="live-pool" className={styles.poolTitle}>
                    Coming, nothing assigned · {view.pool.length}
                  </h3>
                  {view.pool.length ? (
                    <ul className={styles.chips}>
                      {view.pool.map((p) => (
                        <li key={p.personId} className={styles.chip}>
                          {p.name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.quiet}>Everyone has a class.</p>
                  )}
                </section>
              ) : null}
              {cards.map((x) => (
                <LiveCardView key={x.id} card={x} />
              ))}
              {c.rotation != null && !cards.length ? <p className={styles.empty}>{c.label} is empty.</p> : null}
            </section>
          );
        })}
      </div>
      {view.cards.some((x) => x.members.some((m) => m.retake)) ? (
        <p className={styles.legend}>
          <span className={styles.legendStar} aria-hidden="true">
            ★
          </span>{' '}
          retake: already completed this
        </p>
      ) : null}
    </div>
  );
}

function LiveCardView({ card }: { card: LiveCard }) {
  const kind = card.rotation == null ? styles.cardUn : card.kind === 'mb' ? styles.cardMb : card.kind === 'rank' || card.kind === 'focus' ? styles.cardRank : styles.cardOther;
  return (
    <article className={`${styles.card} ${kind}`} aria-labelledby={`live-card-${card.id}`}>
      <p className={styles.code}>
        {card.codeLabel ? <span>{card.codeLabel}</span> : null}
        {card.repeats.length ? <span className={styles.repeat}>{`Repeat · also ${card.repeats.map((r) => (r == null ? 'unscheduled' : `R${r}`)).join(', ')}`}</span> : null}
      </p>
      <h3 id={`live-card-${card.id}`} className={styles.cardTitle}>
        {card.title}
      </h3>
      <p className={styles.teacherRow}>
        <span className={styles.teacherLabel}>Teacher</span>
        {card.teacher ? <span className={styles.teacher}>{card.teacher.name}</span> : <span className={styles.noTeacher}>No teacher yet</span>}
      </p>
      {card.members.length ? (
        <ul className={styles.chips}>
          {card.members.map((m) => (
            <li key={m.personId} className={styles.chip} aria-label={m.retake ? `${m.name}, retake: already completed this` : undefined}>
              {m.name}
              {m.retake ? (
                <span className={styles.star} aria-hidden="true">
                  ★
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.quiet}>No scouts yet.</p>
      )}
      {card.conflicts.map((line) => (
        <p key={line} className={styles.conflict}>
          {line}
        </p>
      ))}
    </article>
  );
}
