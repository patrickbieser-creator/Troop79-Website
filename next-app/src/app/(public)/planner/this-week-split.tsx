'use client';

/**
 * Split or merge… (Plans/Meeting-Planner-III-Split-Groups.md, S4, D8): one panel per rank group. Split into 2 or 3
 * runs the auto planner's proposal (S3) and shows it as the real placement; the planner can tick which requirements
 * each group teaches and set where Group 2 and 3 start ("starts at N requirements done"), and the preview follows. On a
 * split rank it opens on the groups as they are, with One group (merge); on a merged one, As it was. Nothing is
 * written until the footer's button; Cancel (or closing) discards.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Drawer } from '@/app/_components/drawer';
import { Button } from '@/app/_components/button';
import { NumberBox } from '@/app/_components/stepper';
import type { SplitView } from '@/lib/group-split-proposal';
import type { TwGroup } from '@/lib/this-week';
import { twApplySplitAction, twMergeGroupAction, twPreviewSplitAction, twUnmergeGroupAction } from './this-week-actions';
import { useWrite } from './this-week-parts';
import s from './this-week.module.css';

type Mode = 2 | 3 | 'merge' | 'again';
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function SplitPanel({ entryId, group, onClose, onMerged }: { entryId: number; group: TwGroup; onClose: () => void; onMerged: (base: string) => void }) {
  const w = useWrite();
  const split = group.sections > 1;
  const stored = group.stored;
  const [mode, setMode] = useState<Mode>(group.merged ? 'again' : split ? (group.sections as 2 | 3) : 2);
  const [view, setView] = useState<SplitView | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  /** The group a "nothing to teach" refusal points at (marked in place). */
  const [bad, setBad] = useState<number | null>(null);
  const asked = useRef(0);

  // Ask the server for a preview; the newest answer wins. Callers set `loading`.
  const preview = async (q: { count: number } | { sections: string[][]; levels: number[] }) => {
    const n = ++asked.current;
    const r = await twPreviewSplitAction({ entryId, group: group.base, ...q });
    if (n !== asked.current) return;
    setLoading(false);
    if (r.ok) {
      setView(r.view);
      setProblem(null);
    } else {
      setView(null);
      setProblem(r.error);
    }
  };

  // A mode's starting point: the groups as they are (a split or merged rank), else a fresh proposal.
  const load = (m: Mode) => {
    if (m === 'merge') return;
    const current = stored && (m === 'again' || (split && m === group.sections)) ? stored : null;
    void preview(current ? { sections: current.sections, levels: current.levels } : { count: m === 'again' ? 2 : m });
  };
  const choose = (m: Mode) => {
    setMode(m);
    setProblem(null);
    setBad(null);
    if (m !== 'merge') setLoading(true);
    load(m);
  };
  const first = useRef(mode);
  useEffect(() => load(first.current), []); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (sections: string[][], levels: number[]) => {
    if (!view) return;
    setView({ ...view, sections, levels });
    if (bad != null && sections[bad]?.length) {
      setBad(null);
      setProblem(null);
    }
    setLoading(true);
    void preview({ sections, levels });
  };
  const tick = (key: string, i: number, on: boolean) => {
    if (!view) return;
    edit(
      view.sections.map((sec, j) => (j === i ? (on ? [...sec, key] : sec.filter((k) => k !== key)) : sec)),
      view.levels
    );
  };
  const setLevel = (i: number, n: number) => {
    if (!view) return;
    // Levels only rise: raising one lifts the ones after it, lowering one lowers the ones before it.
    const levels = view.levels.map((x, j) => (j === i ? n : j > i ? Math.max(x, n) : j > 0 ? Math.min(x, n) : 0));
    edit(view.sections, levels);
  };

  const apply = async () => {
    if (mode === 'merge') {
      if (await w.run(() => twMergeGroupAction({ entryId, group: group.base }))) {
        onMerged(group.base);
        onClose();
      }
      return;
    }
    if (mode === 'again' && stored) {
      if (await w.run(() => twUnmergeGroupAction({ entryId, group: group.base }))) onClose();
      return;
    }
    if (!view) return;
    const empty = view.sections.findIndex((sec) => !sec.length);
    if (empty >= 0) {
      setBad(empty);
      setProblem(`Can’t save yet: Group ${empty + 1} has nothing to teach.`);
      return;
    }
    if (await w.run(() => twApplySplitAction({ entryId, group: group.base, sections: view.sections, levels: view.levels, adds: view.adds }))) onClose();
  };

  const modes: { m: Mode; label: string }[] = [
    ...(group.merged && stored ? [{ m: 'again' as const, label: 'As it was' }] : []),
    { m: 2, label: '2 groups' },
    { m: 3, label: '3 groups' },
    ...(split ? [{ m: 'merge' as const, label: 'One group' }] : [])
  ];
  // A radio group: one Tab stop, arrows move and choose.
  const arrows = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = modes.findIndex((x) => x.m === mode);
    const next = modes[(i + step + modes.length) % modes.length];
    choose(next.m);
    (e.currentTarget.querySelector(`[data-mode="${String(next.m)}"]`) as HTMLButtonElement | null)?.focus();
  };
  const verb = mode === 'merge' ? 'Merge into one group' : mode === 'again' ? 'Split again as it was' : split ? 'Save groups' : `Split into ${mode} groups`;
  const status = mode === 'merge' || !view ? '' : loading ? 'Updating the groups…' : `Groups updated: ${view.groups.map((g) => `${g.label}, ${plural(g.members.length, 'scout')}`).join('; ')}.`;

  return (
    <Drawer
      eyebrow="Split or merge"
      title={`${group.name} group`}
      sub={view ? `${plural(view.placed, 'scout')} placed tonight` : undefined}
      onClose={onClose}
      footer={
        <>
          {problem || w.error ? (
            <p className={s.err} role="alert">
              {problem ?? w.error}
            </p>
          ) : null}
          <div className={s.row}>
            <Button variant="primary" disabled={w.busy || (mode !== 'merge' && (loading || !view))} onClick={apply}>
              {w.busy ? 'Saving…' : verb}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </>
      }
    >
      <div className={s.seg} role="radiogroup" aria-label={`How many ${group.name} groups`} onKeyDown={arrows}>
        {modes.map((x) => (
          <button
            key={String(x.m)}
            type="button"
            role="radio"
            data-mode={String(x.m)}
            aria-checked={mode === x.m}
            tabIndex={mode === x.m ? 0 : -1}
            className={s.segBtn}
            onClick={() => choose(x.m)}
          >
            {x.label}
          </button>
        ))}
      </div>
      <p className={s.srOnly} role="status">
        {status}
      </p>

      {mode === 'merge' ? (
        <p className={s.splitNote}>Everyone goes back to one {group.name} group. Split or merge… can bring these groups back as they were.</p>
      ) : !view ? (
        <p className={s.muted}>{loading ? 'Working out the groups…' : null}</p>
      ) : (
        <>
          <ol className={s.splitGroups}>
            {view.groups.map((g, i) => (
              <li key={g.label} className={`${s.splitGroup} ${bad === i ? s.splitBad : ''}`}>
                <div className={s.splitHead}>
                  <strong>{g.label}</strong>
                  <span className={s.muted}>
                    {plural(g.members.length, 'scout')} · {g.minutes} min
                  </span>
                </div>
                {i > 0 && mode !== 'again' ? (
                  <div className={s.splitLevel}>
                    <label htmlFor={`lvl-${i}`}>Starts at</label>
                    <NumberBox id={`lvl-${i}`} value={view.levels[i]} min={0} max={500} onCommit={(n) => setLevel(i, n)} describedBy={`lvl-${i}-hint`} framed />
                    <span>requirements done</span>
                    <span id={`lvl-${i}-hint`} className={s.splitHint}>
                      Scouts with at least this many {view.name} requirements done start here.
                    </span>
                  </div>
                ) : i > 0 ? (
                  <span className={s.muted}>Starts at {view.levels[i]} requirements done</span>
                ) : null}
                <p className={s.splitNames}>{g.members.length ? g.members.map((m) => m.name).join(', ') : 'Nobody lands here yet.'}</p>
                {bad === i ? <p className={s.splitBadNote}>Group {i + 1} has nothing to teach. Tick at least one requirement for it below.</p> : null}
              </li>
            ))}
          </ol>

          <table className={s.splitTable}>
            <caption className={s.drawerCaption}>What each group teaches</caption>
            <thead>
              <tr>
                <th scope="col">Requirement</th>
                {view.groups.map((_, i) => (
                  <th key={i} scope="col" className={bad === i ? s.splitBadHead : undefined}>
                    <span aria-hidden="true">{i + 1}</span>
                    <span className={s.srOnly}>Group {i + 1}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.options.map((o) => (
                <tr key={o.key}>
                  <th scope="row">
                    <span className={s.splitCode}>{o.code}</span> {o.label}
                    {view.adds.includes(o.key) ? <span className={s.splitTag}>Added to tonight</span> : null}
                  </th>
                  {view.sections.map((sec, i) => (
                    <td key={i}>
                      <label className={s.splitTick}>
                        <input
                          type="checkbox"
                          checked={sec.includes(o.key)}
                          disabled={mode === 'again'}
                          aria-label={`${o.code} in Group ${i + 1}`}
                          aria-invalid={bad === i || undefined}
                          onChange={(e) => tick(o.key, i, e.target.checked)}
                        />
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Drawer>
  );
}
