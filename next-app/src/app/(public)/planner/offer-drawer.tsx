'use client';

/**
 * Add an offer (Plans/Meeting-Planner-II.md Decisions 10a/10b; phone mock phone/offer.js): what will be taught (one
 * requirement, a merit badge, or a typed title) and who teaches it. In P2a a teacher is required: a teacher-less offer
 * is a seeded topic (P3). Opened from the board's "+ Add an offer", or from an adult's drawer with them already chosen.
 *
 * Search matches every typed word against the code and the words ("tenderfoot 4a", "first aid"). The Add button is
 * greyed only while nothing is chosen; pressed without a teacher, it marks the teacher list and says why.
 *
 * P3 (Decision 10b): the planning team may choose "No teacher yet" for a requirement: that puts it on the meeting's
 * plan. Build a Plan B4 (one add path): it goes through Build's own add, plannerAddOfferingAction, so no two code paths
 * seed a topic; an offer with a teacher keeps the teach path (plannerAddOfferAction). A whole badge or a typed title
 * still needs a teacher.
 */
import { useEffect, useState } from 'react';
import { Drawer } from '@/app/_components/drawer';
import { FREEFORM_MAX } from '@/lib/meeting-board-teach';
import { plannerAddOfferAction, plannerOfferChoicesAction, type OfferChoice } from './actions';
import { twAddRequirementAction } from './this-week-actions';
import { usePlanner } from './planner-client';
import styles from './planner.module.css';

type What = { kind: 'key'; key: string; label: string } | { kind: 'title'; title: string };

const SHOWN = 12;

export function OfferDrawer({ teacherId, onClose }: { teacherId: number | null; onClose: () => void }) {
  const p = usePlanner()!;
  const [choices, setChoices] = useState<OfferChoice[] | null>(null);
  const [q, setQ] = useState('');
  const [what, setWhat] = useState<What | null>(null);
  const [teacher, setTeacher] = useState<number | null>(teacherId);
  const [problem, setProblem] = useState<{ at: 'what' | 'teacher' | 'save'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    plannerOfferChoicesAction()
      .then((res) => live && setChoices(res.ok ? res.choices : []))
      .catch(() => live && setChoices([]));
    return () => {
      live = false;
    };
  }, []);

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length && choices ? choices.filter((c) => words.every((w) => `${c.codeLabel} ${c.label}`.toLowerCase().includes(w))) : [];
  const matches = { reqs: hits.filter((c) => !c.key.startsWith('mb:')).slice(0, SHOWN), badges: hits.filter((c) => c.key.startsWith('mb:')).slice(0, SHOWN) };

  async function add() {
    if (!what) return;
    const seedable = p.canSeed && what.kind === 'key' && !what.key.startsWith('mb:');
    if (teacher == null && !seedable) {
      setProblem({ at: 'teacher', text: p.canSeed ? 'A whole badge or a typed title needs a teacher.' : 'Choose who teaches it.' });
      return;
    }
    setSaving(true);
    setProblem(null);
    const res =
      teacher == null && what.kind === 'key'
        ? await p.sync.run(() => twAddRequirementAction({ entryId: p.entryId, key: what.key }))
        : await p.sync.run(() => plannerAddOfferAction({ entryId: p.entryId, personId: teacher!, what: what.kind === 'key' ? { key: what.key } : { title: what.title } }));
    setSaving(false);
    if (res.ok) onClose();
    else setProblem({ at: 'save', text: res.error });
  }

  const choice = (c: OfferChoice) => (
    <li key={c.key}>
      <button type="button" className={styles.opt} onClick={() => setWhat({ kind: 'key', key: c.key, label: `${c.codeLabel === 'Merit badge' ? '' : `${c.codeLabel} · `}${c.label}` })}>
        <span className={styles.optText}>
          <span className={styles.optTitle}>{c.label}</span>
          <span className={styles.optMeta}>{c.codeLabel}</span>
        </span>
      </button>
    </li>
  );
  const typed = q.trim().replace(/\s+/g, ' ').slice(0, FREEFORM_MAX);

  return (
    <Drawer
      eyebrow="Add an offer"
      title="What will be taught?"
      sub="It goes on this meeting’s plan."
      onClose={onClose}
      footer={
        <>
          {problem?.at === 'save' ? (
            <p className={styles.rowProblem} role="alert">
              {problem.text}
            </p>
          ) : null}
          <button type="button" className={styles.primaryWide} disabled={!what || saving} onClick={add}>
            {saving ? 'Adding…' : 'Add offer'}
          </button>
          <p className={styles.drawerFoot}>Recorded as entered by you</p>
        </>
      }
    >
      {what ? (
        <div className={styles.chosen}>
          <span className={styles.optTitle}>{what.kind === 'key' ? what.label : what.title}</span>
          <button type="button" className={styles.linkBtn} onClick={() => setWhat(null)}>
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            type="search"
            className={styles.enterInput}
            placeholder="Tenderfoot 4a, first aid, knots…"
            aria-label="Search requirements and merit badges"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          {!choices ? <p className={styles.optMeta}>Loading the requirements…</p> : null}
          {matches.reqs.length ? (
            <>
              <h3 className={styles.drawerLabel}>Requirements</h3>
              <ul className={styles.optList}>{matches.reqs.map(choice)}</ul>
            </>
          ) : null}
          {matches.badges.length ? (
            <>
              <h3 className={styles.drawerLabel}>Merit badges</h3>
              <ul className={styles.optList}>{matches.badges.map(choice)}</ul>
            </>
          ) : null}
          {typed ? (
            <button type="button" className={styles.quietAdd} onClick={() => setWhat({ kind: 'title', title: typed })}>
              Use “{typed}” as a title
            </button>
          ) : null}
        </>
      )}

      <fieldset className={problem?.at === 'teacher' ? `${styles.answer} ${styles.bad}` : styles.answer}>
        <legend className={styles.drawerLabel}>Who teaches it?</legend>
        {problem?.at === 'teacher' ? (
          <p className={styles.rowProblem} role="alert">
            {problem.text}
          </p>
        ) : null}
        <ul className={styles.optList} aria-label="Who teaches it">
          {p.canSeed ? (
            <li>
              <button
                type="button"
                aria-pressed={teacher == null}
                className={teacher == null ? styles.optOn : styles.opt}
                onClick={() => {
                  setTeacher(null);
                  if (problem?.at === 'teacher') setProblem(null);
                }}
              >
                <span className={styles.check} aria-hidden="true">
                  {teacher == null ? '✓' : ''}
                </span>
                <span className={styles.optText}>
                  <span className={styles.optTitle}>No teacher yet</span>
                  <span className={styles.optMeta}>Puts it on the plan</span>
                </span>
              </button>
            </li>
          ) : null}
          {p.adults.map((a) => (
            <li key={a.personId}>
              <button
                type="button"
                aria-pressed={teacher === a.personId}
                className={teacher === a.personId ? styles.optOn : styles.opt}
                onClick={() => {
                  setTeacher(a.personId);
                  if (problem?.at === 'teacher') setProblem(null);
                }}
              >
                <span className={styles.check} aria-hidden="true">
                  {teacher === a.personId ? '✓' : ''}
                </span>
                <span className={styles.optTitle}>{a.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </fieldset>
    </Drawer>
  );
}
