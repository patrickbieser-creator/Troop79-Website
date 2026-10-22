'use client';

/**
 * Build a Plan's one quiet add row under the plan list (Plans/Build-A-Plan.md, B2; AGENTS.md "Lists end in one quiet
 * add row"): "+ Requirement  + Focus set  + New mix", each opening inline with Cancel.
 *
 *   + Requirement  the server search, whole requirements only; Add puts one on the plan. The row stays open for the
 *                  next one and says what it added. (No typed free-text title: the seed RPCs take catalog keys and
 *                  focus groups only, and a typed title needs a teacher, so it stays on "+ Add an offer".)
 *   + Focus set    the planner's sets, filtered by name or label; Add puts the set on as one class.
 *   + New mix      a name ("Mix for Oct 25" until typed over) and requirements ticked from the same search, any
 *                  level. Add mix saves it as a focus set and adds it as one class in one step.
 * The writes belong to the page (BuildPlanView): each callback resolves to an error to show, or null.
 */
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AddRow } from '@/app/_components/add-row';
import { Button } from '@/app/_components/button';
import type { FocusSearchRow, FocusSetView } from '@/lib/meeting-focus';
import { focusSetsAction } from '../focus-actions';
import { rowCode, useRequirementSearch } from './requirement-search';
import s from './build.module.css';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface AddOfferingProps {
  onPlan: ReadonlySet<string>;
  defaultMixName: string;
  addRequirement: (r: FocusSearchRow) => Promise<string | null>;
  addSet: (set: FocusSetView) => Promise<string | null>;
  newMix: (name: string, items: FocusSearchRow[]) => Promise<string | null>;
}

export function AddOffering(p: AddOfferingProps) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <AddRow
      className={s.addRow}
      open={open}
      onOpenChange={(id) => setOpen(id)}
      actions={[
        { id: 'req', label: 'Requirement', content: <RequirementPanel {...p} /> },
        { id: 'set', label: 'Focus set', content: <SetPanel {...p} /> },
        { id: 'mix', label: 'New mix', content: <MixPanel {...p} onDone={() => setOpen(null)} /> }
      ]}
    />
  );
}

function RequirementPanel({ onPlan, addRequirement }: AddOfferingProps) {
  const [q, setQ] = useState('');
  const found = useRequirementSearch(q, true);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ key: string; text: string; bad: boolean } | null>(null);
  const add = async (r: FocusSearchRow) => {
    if (busy) return;
    setBusy(r.key);
    setSaid(null);
    const err = await addRequirement(r);
    setBusy(null);
    setSaid(err ? { key: r.key, text: err, bad: true } : { key: r.key, text: `Added ${rowCode(r)}.`, bad: false });
  };
  return (
    <div className={s.addPanel}>
      <input type="text" className={s.addInput} placeholder="Tenderfoot 4a, first aid…" aria-label="Search requirements" value={q} onChange={(e) => setQ(e.target.value)} />
      <SearchResults
        state={found}
        render={(r) => (
          <li key={r.key} className={s.pickRow}>
            <span>
              <span className={s.pickTitle}>{r.label}</span>
              <span className={s.pickMeta}>{rowCode(r)}</span>
              {said?.key === r.key && said.bad ? (
                <span className={s.problem} role="alert">
                  {said.text}
                </span>
              ) : null}
            </span>
            {onPlan.has(r.key) ? (
              <span className={s.onPlan}>✓ On the plan</span>
            ) : (
              <Button variant="secondary" size="sm" className={s.addBtn} disabled={busy === r.key} onClick={() => add(r)} aria-label={`Add ${rowCode(r)}`}>
                {busy === r.key ? 'Adding…' : 'Add'}
              </Button>
            )}
          </li>
        )}
      />
      <p className={s.status} role="status">
        {said && !said.bad ? said.text : ''}
      </p>
    </div>
  );
}

function SearchResults({ state, render }: { state: ReturnType<typeof useRequirementSearch>; render: (r: FocusSearchRow) => ReactNode }) {
  if (state.status === 'idle') return null;
  if (state.status === 'loading') return <p className={s.pickMeta}>Searching…</p>;
  if (state.status === 'failed') return <p className={s.problem}>The search didn’t work. Try again.</p>;
  if (!state.rows.length) return <p className={s.pickMeta}>No requirement matches that.</p>;
  return <ul className={s.pickList}>{state.rows.map(render)}</ul>;
}

function SetPanel({ onPlan, addSet }: AddOfferingProps) {
  const [sets, setSets] = useState<FocusSetView[] | null | 'failed'>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [problem, setProblem] = useState<{ id: number; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    focusSetsAction()
      .then((res) => live && setSets(res.ok ? res.sets : 'failed'))
      .catch(() => live && setSets('failed'));
    return () => {
      live = false;
    };
  }, []);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = Array.isArray(sets) ? sets.filter((x) => words.every((w) => `${x.name} ${x.labels.join(' ')}`.toLowerCase().includes(w))) : [];
  const add = async (x: FocusSetView) => {
    if (busy != null) return;
    setBusy(x.id);
    setProblem(null);
    const err = await addSet(x);
    setBusy(null);
    if (err) setProblem({ id: x.id, text: err });
  };
  return (
    <div className={s.addPanel}>
      <input type="text" className={s.addInput} placeholder="Find a set by name or label" aria-label="Find a focus set" value={q} onChange={(e) => setQ(e.target.value)} />
      {sets === null ? <p className={s.pickMeta}>Loading the sets…</p> : null}
      {sets === 'failed' ? <p className={s.problem}>The sets didn’t load. Try again.</p> : null}
      {Array.isArray(sets) && !sets.length ? (
        <p className={s.pickMeta}>
          No focus sets yet. <Link href="/planner/focus-sets">Make one</Link>, or start a new mix.
        </p>
      ) : null}
      {Array.isArray(sets) && sets.length && !shown.length ? <p className={s.pickMeta}>No set matches that.</p> : null}
      {shown.length ? (
        <ul className={s.pickList}>
          {shown.map((x) => (
            <li key={x.id} className={s.pickRow}>
              <span>
                <span className={s.pickTitle}>{x.name}</span>
                <span className={s.pickMeta}>
                  {plural(x.items.length, 'requirement')}
                  {x.labels.length ? ` · ${x.labels.join(', ')}` : ''}
                </span>
                {problem?.id === x.id ? (
                  <span className={s.problem} role="alert">
                    {problem.text}
                  </span>
                ) : null}
              </span>
              {onPlan.has(`fg:${x.id}`) ? (
                <span className={s.onPlan}>✓ On the plan</span>
              ) : (
                <Button variant="secondary" size="sm" className={s.addBtn} disabled={busy === x.id || !x.items.length} onClick={() => add(x)} aria-label={`Add ${x.name}`}>
                  {busy === x.id ? 'Adding…' : 'Add'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Pick requirements (any level) for a mix: the search with toggles, then what is ticked, each with Remove. */
export function MixPicker({ ticked, onChange }: { ticked: FocusSearchRow[]; onChange: (next: FocusSearchRow[]) => void }) {
  const [q, setQ] = useState('');
  const found = useRequirementSearch(q, false);
  const on = new Set(ticked.map((t) => t.key));
  const toggle = (r: FocusSearchRow) => onChange(on.has(r.key) ? ticked.filter((t) => t.key !== r.key) : [...ticked, r]);
  return (
    <>
      {ticked.length ? (
        <ul className={s.tickedList} aria-label="In the mix">
          {ticked.map((t) => (
            <li key={t.key} className={s.ticked}>
              <span>
                <span className={s.code}>{rowCode(t)}</span>
                {t.label}
              </span>
              <button type="button" className={s.untick} onClick={() => toggle(t)} aria-label={`Take ${rowCode(t)} out`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input type="text" className={s.addInput} placeholder="Tenderfoot 4a, first aid…" aria-label="Search requirements to tick" value={q} onChange={(e) => setQ(e.target.value)} />
      <SearchResults
        state={found}
        render={(r) => (
          <li key={r.key}>
            <button type="button" className={on.has(r.key) ? s.tickOn : s.tick} aria-pressed={on.has(r.key)} onClick={() => toggle(r)}>
              <span className={s.tickBox} aria-hidden="true">
                {on.has(r.key) ? '✓' : ''}
              </span>
              <span>
                <span className={s.pickTitle}>{r.label}</span>
                <span className={s.pickMeta}>
                  {rowCode(r)}
                  {r.parent ? ` · in ${r.parent}` : ''}
                </span>
              </span>
            </button>
          </li>
        )}
      />
    </>
  );
}

function MixPanel({ defaultMixName, newMix, onDone }: AddOfferingProps & { onDone: () => void }) {
  const [name, setName] = useState(defaultMixName);
  const [ticked, setTicked] = useState<FocusSearchRow[]>([]);
  const [problem, setProblem] = useState<{ at: 'name' | 'save'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    if (!name.trim()) {
      setProblem({ at: 'name', text: 'Give the mix a name.' });
      return;
    }
    setBusy(true);
    setProblem(null);
    const err = await newMix(name, ticked);
    setBusy(false);
    if (err) setProblem({ at: 'save', text: err });
    else onDone();
  };
  return (
    <div className={s.addPanel}>
      <label className={s.fieldLabel}>
        Name
        <input
          type="text"
          className={problem?.at === 'name' ? `${s.addInput} ${s.bad}` : s.addInput}
          value={name}
          maxLength={80}
          aria-invalid={problem?.at === 'name' || undefined}
          onChange={(e) => {
            setName(e.target.value);
            if (problem?.at === 'name') setProblem(null);
          }}
        />
      </label>
      {problem?.at === 'name' ? (
        <p className={s.problem} role="alert">
          {problem.text}
        </p>
      ) : null}
      <MixPicker ticked={ticked} onChange={setTicked} />
      <div className={s.mixActions}>
        <Button variant="secondary" size="sm" onClick={save} disabled={busy || !ticked.length}>
          {busy ? 'Adding…' : ticked.length ? `Add mix of ${plural(ticked.length, 'requirement')}` : 'Add mix'}
        </Button>
        {problem?.at === 'save' ? (
          <p className={s.problem} role="alert">
            {problem.text}
          </p>
        ) : null}
      </div>
      <p className={s.pickMeta}>It’s saved as a focus set too, so it can be used again.</p>
    </div>
  );
}
