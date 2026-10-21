'use client';

/**
 * Nudge families (Plans/Meeting-Planner-II.md P2b; prototypes/meeting-plan-II/README.md "Screen 2", phone/drawer.html
 * nudge mode): for an offer nobody picked, the Troop 79 Bugler offers it to the families an adult chooses. It starts
 * with nobody selected: "Select likely fits (N)" ticks the scouts working on that rank, "Clear" unticks everyone.
 * Nothing is sent until "Send to N families"; sending is always an explicit choice, never everyone at once.
 */
import { useEffect, useState } from 'react';
import { Drawer } from '@/app/_components/drawer';
import { plannerNudgeFamiliesAction, plannerSendNudgeAction, type NudgeFamily } from './actions';
import { SAVE_FAILED, usePlanner } from './planner-client';
import styles from './planner.module.css';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function NudgeDrawer({ topicKey, title, codeLabel, teachers, onSent, onClose }: { topicKey: string; title: string; codeLabel: string; teachers: string; onSent: (n: number) => void; onClose: () => void }) {
  const p = usePlanner()!;
  const [families, setFamilies] = useState<NudgeFamily[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    plannerNudgeFamiliesAction({ entryId: p.entryId, topicKey })
      .then((res) => {
        if (!live) return;
        if (res.ok) setFamilies(res.families);
        else setProblem(res.error);
      })
      .catch(() => live && setProblem(SAVE_FAILED.replace('save', 'load')));
    return () => {
      live = false;
    };
  }, [p.entryId, topicKey]);

  const likely = (families ?? []).filter((f) => f.likely);
  const toggle = (id: number) =>
    setChosen((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function send() {
    setSending(true);
    setProblem(null);
    const res = await p.sync.run(() => plannerSendNudgeAction({ entryId: p.entryId, topicKey, scoutIds: [...chosen] }));
    setSending(false);
    if (!res.ok) {
      setProblem(res.error);
      return;
    }
    if (res.skipped.length && !res.sent.length) {
      setProblem(`Nothing went out: ${res.skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}.`);
      return;
    }
    onSent(res.sent.length);
    onClose();
  }

  return (
    <Drawer
      eyebrow={`${codeLabel} · ${title}`}
      title="Nudge families"
      sub={`${teachers} is teaching this Sunday. Pick which families get a note.`}
      onClose={onClose}
      footer={
        <>
          {problem ? (
            <p className={styles.rowProblem} role="alert">
              {problem}
            </p>
          ) : null}
          <button type="button" className={styles.primaryWide} disabled={!chosen.size || sending} onClick={send}>
            {sending ? 'Sending…' : `Send to ${plural(chosen.size, 'family', 'families')}`}
          </button>
          <p className={styles.drawerFoot}>Nothing is sent until you press Send</p>
        </>
      }
    >
      <h3 className={styles.drawerLabel}>
        Families · {chosen.size} selected <span className={styles.optMeta}>Likely fits are listed first</span>
      </h3>
      <div className={styles.quick}>
        <button type="button" className={styles.quickBtn} disabled={!likely.length} onClick={() => setChosen(new Set(likely.map((f) => f.personId)))}>
          Select likely fits ({likely.length})
        </button>
        <button type="button" className={styles.quickBtn} disabled={!chosen.size} onClick={() => setChosen(new Set())}>
          Clear
        </button>
      </div>
      <details className={styles.preview}>
        <summary>What they’ll get</summary>
        <p>
          An email from the Troop 79 Bugler to each scout’s parents (and the scout, from 13), offering {title} ({codeLabel}) at this Sunday’s meeting, with
          a link to say yes or no.
        </p>
      </details>
      {families == null && !problem ? <p className={styles.optMeta}>Loading the families…</p> : null}
      {families && !families.length ? <p className={styles.optMeta}>Every scout who could pick this already has, or can’t make it.</p> : null}
      <ul className={styles.optList} aria-label="Families">
        {(families ?? []).map((f) => (
          <li key={f.personId}>
            <button type="button" role="checkbox" aria-checked={chosen.has(f.personId)} className={chosen.has(f.personId) ? styles.optOn : styles.opt} onClick={() => toggle(f.personId)}>
              <span className={styles.check} aria-hidden="true">
                {chosen.has(f.personId) ? '✓' : ''}
              </span>
              <span className={styles.optText}>
                <span className={styles.optTitle}>{f.name}</span>
                <span className={styles.optMeta}>{f.meta}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Drawer>
  );
}
