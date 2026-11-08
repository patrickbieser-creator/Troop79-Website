'use client';

/**
 * Live at the meeting (Plans/Meeting-Planner-III.md, Decision 10): the same plan as session cards, one per group, one
 * per merit badge, Helping teach, and each class from requests and offers. Tap a name to mark them here (a draft;
 * attendance is approved after the meeting). Derived entirely from the plan: an edit on Plan shows here at once.
 * Built for phones in the room: one column under 640px, 44px targets.
 */
import { useOptimistic, useTransition } from 'react';
import type { ThisWeek, TwPerson, TwTeacher } from '@/lib/this-week';
import type { PlanState } from '@/lib/plan-states';
import { usePlanner } from './planner-client';
import { twSetPresentAction } from './this-week-actions';
import { useWrite } from './this-week-parts';
import s from './this-week.module.css';

interface Session {
  key: string;
  title: string;
  sub: string;
  /** What's taught, very short, in the card's corner. */
  summary: string;
  tone: string;
  teachers: TwTeacher[];
  people: TwPerson[];
}

export function LiveView({ entryId, view, isToday, present }: { entryId: number; view: ThisWeek; isToday: boolean; present: readonly number[] }) {
  const p = usePlanner();
  const w = useWrite();
  const [, start] = useTransition();
  const [here, setHere] = useOptimistic(new Set(present), (cur: Set<number>, change: { id: number; on: boolean }) => {
    const next = new Set(cur);
    if (change.on) next.add(change.id);
    else next.delete(change.id);
    return next;
  });
  const coming = (x: TwPerson) => x.intent !== 'not_coming';
  const sessions: Session[] = [
    // A station isn't a session: every rotating scout visits it (station rotations); the plan view draws the rotation.
    ...view.groups.filter((g) => g.kind !== 'station').map((g) => ({
      key: g.key,
      title: g.title,
      sub: g.columns.map((c) => c.code).join(', '),
      summary: g.summary,
      tone: g.kind === 'badge' ? s['tone-mb'] : s[`tone-${g.refId}`],
      teachers: g.teachers,
      people: g.members.filter(coming)
    })),
    ...(view.helpers.length ? [{ key: 'help', title: 'Helping teach', sub: 'Older scouts and anyone done with the focus', summary: '', tone: s['tone-mb'], teachers: [], people: view.helpers.filter(coming) }] : []),
    ...view.extras.map((x) => ({ key: x.key, title: x.title, sub: `From requests and offers${x.codeLabel ? ` · ${x.codeLabel}` : ''}`, summary: '', tone: s['tone-extra'], teachers: x.teachers, people: x.scouts.filter(coming) }))
  ];
  const canTap = !!p?.canEdit && isToday;
  const tap = (id: number) => {
    const on = !here.has(id);
    start(async () => {
      setHere({ id, on });
      await w.run(() => twSetPresentAction({ entryId, personId: id, present: on }));
    });
  };
  // A teacher's button (`tone`: the card head's class) wears the head's colours; a scout's stays plain.
  const button = (x: { personId: number; name: string; state?: PlanState }, tone?: string) => {
    const on = here.has(x.personId);
    // A teacher who hasn't confirmed says so (Confirmations C-D3); a confirmed one needs no word.
    const unsure = x.state && x.state !== 'confirmed' ? ` · ${x.state === 'asked' ? 'asked' : x.state === 'changed' ? 'changed' : 'planned'}` : '';
    return (
      <button key={x.personId} type="button" className={tone ? `${s.here} ${s.hereTeacher} ${tone}` : s.here} aria-pressed={on} disabled={!canTap} onClick={() => tap(x.personId)}>
        {on ? `✓ ${x.name}` : x.name}
        {unsure ? <span className={s.stWord}>{unsure}</span> : null}
      </button>
    );
  };
  const notPlaced = view.sections.flatMap((sec) => sec.rows).filter((r) => r.gap && r.intent === 'coming');

  return (
    <>
      <p className={s.muted}>
        {canTap ? 'Tap a name when they’re here. ' : isToday ? 'Only planner editors check people in. ' : 'Check-in opens on the day of the meeting. '}
        {here.size} here so far.
      </p>
      {w.error ? (
        <p className={s.err} role="alert">
          {w.error}
        </p>
      ) : null}
      {sessions.length ? null : <p className={s.muted}>Nothing is planned yet. Pick a focus on Plan.</p>}
      <div className={s.sessions}>
        {sessions.map((x) => (
          <section key={x.key} className={s.group} aria-labelledby={`live-${x.key}`}>
            <div className={`${s.groupHead} ${x.tone}`}>
              <div>
                <h2 id={`live-${x.key}`} className={s.groupName}>
                  {x.title}
                </h2>
                <span className={s.groupSub}>{x.sub}</span>
              </div>
              {x.summary ? <span className={s.groupSummary}>{x.summary}</span> : null}
            </div>
            <div className={s.groupBody}>
              {x.teachers.length ? (
                <div className={s.row}>
                  <span className={s.rowLabel}>{x.teachers.length > 1 ? 'Teachers' : 'Teacher'}</span>
                  {x.teachers.map((t) => button(t, x.tone))}
                </div>
              ) : x.key === 'help' ? null : (
                <span className={s.slotTextEmpty}>No teachers yet</span>
              )}
              <div className={s.chips}>{x.people.map((p) => button(p))}</div>
              {x.people.length ? null : <span className={s.muted}>Nobody yet.</span>}
            </div>
          </section>
        ))}
        {notPlaced.length ? (
          <section className={s.group} aria-labelledby="live-none">
            <div className={`${s.groupHead} ${s['tone-extra']}`}>
              <h2 id="live-none" className={s.groupName}>
                Coming, nothing assigned
              </h2>
              <span className={s.groupCount}>{notPlaced.length}</span>
            </div>
            <div className={s.groupBody}>
              <div className={s.chips}>{notPlaced.map((p) => button(p))}</div>
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
