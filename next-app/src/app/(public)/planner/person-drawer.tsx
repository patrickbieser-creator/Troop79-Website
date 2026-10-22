'use client';

/**
 * The person drawer (Plans/Meeting-Planner-II.md P2a; prototypes/meeting-plan-II/README.md "Screen 2"): one person's
 * "Coming Sunday?" and, for a scout, up to 5 picks; for an adult (or a Junior Leader), what they're teaching, no cap.
 * Everything saves on tap and is recorded as entered by the editor. A refusal is said in place, under the control
 * that caused it, and that control goes back to how it was. P5b: someone who hasn't answered gets "Remind" (adult
 * editors only), which emails them, or a scout's parents.
 */
import { useEffect, useState } from 'react';
import { Drawer } from '@/app/_components/drawer';
import { INTENT_LABEL, type Intent } from '@/lib/meeting-board-shared';
import type { DrawerOption, PersonDrawer } from '@/lib/meeting-planner-drawer';
import { plannerOpenPersonAction, plannerSetAnswerAction, plannerTogglePickAction, plannerToggleTeachAction, type PlannerDrawerResult } from './actions';
import { RemindButton, SAVE_FAILED, usePlanner } from './planner-client';
import styles from './planner.module.css';

const ANSWERS: { intent: Intent; label: string; cls: string }[] = [
  { intent: 'coming', label: 'Coming', cls: styles.segComing },
  { intent: 'undecided', label: 'Not sure', cls: styles.segUnsure },
  { intent: 'not_coming', label: 'Can’t', cls: styles.segCant }
];

export function PersonDrawerView({ personId, onClose }: { personId: number; onClose: () => void }) {
  const p = usePlanner()!;
  const [drawer, setDrawer] = useState<PersonDrawer | null>(null);
  const [problem, setProblem] = useState<{ at: string; text: string } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    plannerOpenPersonAction({ entryId: p.entryId, personId })
      .then((res) => {
        if (!live) return;
        if (res.ok) setDrawer(res.drawer);
        else setProblem({ at: 'open', text: res.error });
      })
      .catch(() => live && setProblem({ at: 'open', text: SAVE_FAILED.replace('save', 'open') }));
    return () => {
      live = false;
    };
  }, [p.entryId, personId]);

  async function save(at: string, write: () => Promise<PlannerDrawerResult>) {
    setSaving(at);
    setProblem(null);
    // The board behind refreshes once, when the drawer closes (planner-client), not on every tick.
    const res = await p.sync.run(write, { defer: true });
    setSaving(null);
    if (res.ok) setDrawer(res.drawer);
    else setProblem({ at, text: res.error });
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
  const toggle = (o: DrawerOption) =>
    save(o.key, () =>
      scout
        ? plannerTogglePickAction({ entryId: p.entryId, personId, key: o.key, on: !o.on })
        : plannerToggleTeachAction({ entryId: p.entryId, personId, key: o.key, on: !o.on })
    );
  const option = (o: DrawerOption) => {
    const blocked = scout && full && !o.on;
    return (
      <li key={o.key}>
        <button
          type="button"
          role="checkbox"
          aria-checked={o.on}
          className={o.on ? styles.optOn : styles.opt}
          disabled={saving != null}
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
              disabled={saving != null}
              onClick={() => (drawer.intent === a.intent ? undefined : save('answer', () => plannerSetAnswerAction({ entryId: p.entryId, personId, intent: a.intent })))}
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
        {drawer.shown == null ? <RemindButton personId={personId} name={drawer.name} /> : null}
      </fieldset>

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
    </Drawer>
  );
}
