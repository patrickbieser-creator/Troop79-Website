'use client';

/**
 * The person drawer (Plans/Meeting-Planner-II.md P2a; prototypes/meeting-plan-II/README.md "Screen 2"): one person's
 * "Coming Sunday?" and, for a scout, up to 5 picks; for an adult (or a Junior Leader), what they're teaching, no cap.
 * Everything saves on tap and is recorded as entered by the editor. A tick shows at once (perf, 2026-10-22) and saves
 * behind it, one write at a time per person; the 5-pick cap counts ticks still saving. A refusal is said in place,
 * under the control that caused it, and that control goes back to how it was. P5b: someone who hasn't answered gets "Remind" (adult
 * editors only), which emails them, or a scout's parents.
 *
 * Planner III (Patrick, 2026-10-29): a scout on This week gets "Tonight" in place of picks: where they are, Move to
 * another group, Help teach, a class from requests and offers, or Unassign (back to the planner); and, when none
 * fits, a way back to This week to add a focus set or requirement.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Drawer } from '@/app/_components/drawer';
import { INTENT_LABEL, type Intent } from '@/lib/meeting-board-shared';
import type { DrawerOption, PersonDrawer } from '@/lib/meeting-planner-drawer';
import { plannerOpenPersonAction, plannerSetAnswerAction, plannerTogglePickAction, plannerToggleTeachAction, type DrawerTick, type PlannerTickResult } from './actions';
import { twSetRoleAction, type RoleInput } from './this-week-actions';
import { SAVE_FAILED, usePlanner } from './planner-client';
import styles from './planner.module.css';

const ANSWERS: { intent: Intent; label: string; cls: string }[] = [
  { intent: 'coming', label: 'Coming', cls: styles.segComing },
  { intent: 'undecided', label: 'Not sure', cls: styles.segUnsure },
  { intent: 'not_coming', label: 'Can’t', cls: styles.segCant }
];

/** A tick not yet confirmed by the server. */
interface Tick {
  id: number;
  key: string;
  on: boolean;
}

/** The drawer as the editor sees it: what the server last confirmed, with the ticks still saving laid over it. The
 *  counts and the implied answer follow the same rules as the server (effectiveIntent / teacherIntent: a pick for this
 *  meeting or a teaching commitment means Coming when there's no stored answer). */
function withTicks(d: PersonDrawer, ticks: readonly Tick[]): PersonDrawer {
  if (!ticks.length) return d;
  const on = new Map(d.options.map((o) => [o.key, o.on]));
  let count = d.kind === 'scout' ? d.picked : d.teaching;
  for (const t of ticks) {
    if (!on.has(t.key) || on.get(t.key) === t.on) continue;
    on.set(t.key, t.on);
    count += t.on ? 1 : -1;
  }
  const options = d.options.map((o) => (on.get(o.key) === o.on ? o : { ...o, on: on.get(o.key)! }));
  const shown = d.intent ?? (count > 0 ? 'coming' : null);
  return d.kind === 'scout' ? { ...d, options, picked: count, shown } : { ...d, options, teaching: count, shown };
}

/** What one write changed, laid over the confirmed drawer (the server no longer reloads the whole drawer per tick). */
function withTick(d: PersonDrawer, t: DrawerTick): PersonDrawer {
  const options = t.key == null ? d.options : d.options.map((o) => (o.key === t.key && o.on !== t.on ? { ...o, on: !!t.on } : o));
  const base = { ...d, options, intent: t.intent, shown: t.shown };
  if (t.count == null) return base;
  return base.kind === 'scout' ? { ...base, picked: t.count } : { ...base, teaching: t.count };
}

export function PersonDrawerView({ personId, onClose }: { personId: number; onClose: () => void }) {
  const p = usePlanner()!;
  const [confirmed, setConfirmed] = useState<PersonDrawer | null>(null);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [problem, setProblem] = useState<{ at: string; text: string } | null>(null);
  const [answering, setAnswering] = useState(false);
  const nextId = useRef(0);
  const { serial, run } = p.sync;

  useEffect(() => {
    let live = true;
    serial(personId, () => plannerOpenPersonAction({ entryId: p.entryId, personId }))
      .then((res) => {
        if (!live) return;
        if (res.ok) setConfirmed(res.drawer);
        else setProblem({ at: 'open', text: res.error });
      })
      .catch(() => live && setProblem({ at: 'open', text: SAVE_FAILED.replace('save', 'open') }));
    return () => {
      live = false;
    };
  }, [p.entryId, personId, serial]);

  const drawer = useMemo(() => (confirmed ? withTicks(confirmed, ticks) : null), [confirmed, ticks]);

  /** Every write for this person goes through one queue, in click order; the board behind refreshes on close. */
  function write(write: () => Promise<PlannerTickResult>) {
    return serial(personId, () => run(write, { defer: true }));
  }

  if (!drawer) {
    return (
      <Drawer title={problem ? 'Couldn’t open' : 'Loading…'} onClose={onClose}>
        {problem ? (
          <p className={styles.rowProblem} role="alert">
            {problem.text}
          </p>
        ) : null}
      </Drawer>
    );
  }

  const scout = drawer.kind === 'scout';
  const full = scout && drawer.picked >= drawer.max;
  /** Optimistic: the box flips now; a refusal puts it back and says why under it. */
  const toggle = async (o: DrawerOption) => {
    const tick = { id: nextId.current++, key: o.key, on: !o.on };
    setProblem(null);
    setTicks((t) => [...t, tick]);
    const res = await write(() =>
      scout
        ? plannerTogglePickAction({ entryId: p.entryId, personId, key: o.key, on: tick.on })
        : plannerToggleTeachAction({ entryId: p.entryId, personId, key: o.key, on: tick.on })
    );
    if (res.ok) setConfirmed((d) => (d ? withTick(d, res.tick) : d));
    else setProblem({ at: o.key, text: res.error });
    setTicks((t) => t.filter((x) => x.id !== tick.id));
  };
  const answer = async (intent: Intent) => {
    setAnswering(true);
    setProblem(null);
    const res = await write(() => plannerSetAnswerAction({ entryId: p.entryId, personId, intent }));
    setAnswering(false);
    if (res.ok) setConfirmed((d) => (d ? withTick(d, res.tick) : d));
    else setProblem({ at: 'answer', text: res.error });
  };
  /** Tonight: one hand placement, then the drawer reads again (where they are now is This week's call). */
  const place = async (role: RoleInput) => {
    setAnswering(true);
    setProblem(null);
    const res = await serial(personId, () => run(() => twSetRoleAction({ entryId: p.entryId, personId, ...role }), { defer: true }));
    if (res.ok) {
      const again = await serial(personId, () => plannerOpenPersonAction({ entryId: p.entryId, personId }));
      if (again.ok) setConfirmed(again.drawer);
    } else setProblem({ at: 'place', text: res.error });
    setAnswering(false);
  };
  const saving = answering || ticks.length > 0;
  const option = (o: DrawerOption) => {
    const blocked = scout && full && !o.on;
    return (
      <li key={o.key}>
        <button
          type="button"
          role="checkbox"
          aria-checked={o.on}
          className={o.on ? styles.optOn : styles.opt}
          onClick={() => (blocked ? setProblem({ at: o.key, text: `Already ${drawer.max} picks. Untick one to add another.` }) : toggle(o))}
        >
          <span className={styles.check} aria-hidden="true">
            {o.on ? '✓' : ''}
          </span>
          <span className={styles.optText}>
            <span className={styles.optTitle}>{o.title}</span>
            <span className={styles.optMeta}>{o.meta}</span>
          </span>
        </button>
        {problem?.at === o.key ? (
          <p className={styles.rowProblem} role="alert">
            {problem.text}
          </p>
        ) : null}
      </li>
    );
  };
  const board = drawer.options.filter((o) => o.section === 'board');
  const more = drawer.options.filter((o) => o.section === 'more');

  return (
    <Drawer
      eyebrow={scout ? 'Scout' : drawer.sub.startsWith('Junior') ? 'Junior Leader' : 'Adult'}
      title={drawer.name}
      sub={scout ? drawer.sub : null}
      onClose={onClose}
      footer={<p className={styles.drawerFoot}>{saving ? 'Saving…' : 'Saves as you go · recorded as entered by you'}</p>}
    >
      <fieldset className={styles.answer}>
        <legend className={styles.drawerLabel}>Coming Sunday?</legend>
        <div className={styles.seg}>
          {ANSWERS.map((a) => (
            <button
              key={a.intent}
              type="button"
              className={drawer.shown === a.intent ? `${styles.segBtn} ${a.cls}` : styles.segBtn}
              aria-pressed={drawer.shown === a.intent}
              disabled={answering}
              onClick={() => (drawer.intent === a.intent ? undefined : answer(a.intent))}
            >
              {a.label}
            </button>
          ))}
        </div>
        {drawer.shown && !drawer.intent ? <p className={styles.optMeta}>{INTENT_LABEL[drawer.shown]} because they {scout ? 'picked something' : 'are teaching'}.</p> : null}
        {problem?.at === 'answer' ? (
          <p className={styles.rowProblem} role="alert">
            {problem.text}
          </p>
        ) : null}
      </fieldset>

      {drawer.kind === 'scout' && drawer.place ? (
        <>
          <h3 className={styles.drawerLabel}>Tonight</h3>
          <p className={styles.placeNow}>{drawer.place.now}</p>
          <ul className={styles.optList} aria-label="Where they go tonight">
            {drawer.place.options.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={o.current}
                  className={o.current ? styles.optOn : styles.opt}
                  disabled={answering}
                  onClick={() => (o.current ? undefined : place(o.role))}
                >
                  <span className={styles.check} aria-hidden="true">
                    {o.current ? '✓' : ''}
                  </span>
                  <span className={styles.optText}>
                    <span className={styles.optTitle}>{o.label}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {drawer.place.canUnassign ? (
            <button type="button" className={styles.quietAdd} disabled={answering} onClick={() => place({ role: null })}>
              Unassign · let the planner place {drawer.name.split(' ')[0]}
            </button>
          ) : null}
          {problem?.at === 'place' ? (
            <p className={styles.rowProblem} role="alert">
              {problem.text}
            </p>
          ) : null}
          <p className={styles.placeHint}>
            None of these fit?{' '}
            <button type="button" className={styles.linkBtn} onClick={onClose}>
              Back to This week
            </button>{' '}
            to add a focus set or requirement.
          </p>
        </>
      ) : (
        <>
          {scout && drawer.shown === 'not_coming' && drawer.picked ? <p className={styles.drawerNote}>Picks are saved for a later meeting.</p> : null}

          <h3 className={styles.drawerLabel}>
            {scout ? (
              <>
                Picks · {drawer.picked} of {drawer.max} <span className={styles.optMeta}>They’ll work on one or two</span>
              </>
            ) : (
              <>
                Teaching · {drawer.teaching} <span className={styles.optMeta}>What they can teach is listed first</span>
              </>
            )}
          </h3>
          {board.length ? (
            <ul className={styles.optList} aria-label="On this week’s board">
              {board.map(option)}
            </ul>
          ) : (
            <p className={styles.optMeta}>Nothing is on the board yet.</p>
          )}
          {more.length ? (
            <>
              <h3 className={styles.drawerLabel}>More from their rank</h3>
              <ul className={styles.optList}>{more.map(option)}</ul>
            </>
          ) : null}
          {!scout ? (
            <button type="button" className={styles.quietAdd} onClick={() => p.openOffer(personId, personId)}>
              + Offer something else
            </button>
          ) : null}
        </>
      )}
    </Drawer>
  );
}
