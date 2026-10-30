'use client';

/**
 * Saved meeting plans on This week's focus card (Patrick, 2026-10-29). Top right: "Save plan…" (a name and a date,
 * the date defaulting to this meeting's), then "Load a saved plan…" below it: a list with search by name, a merit
 * badge filter and sort by date. Loading replaces this meeting's focus sets, merit badges and planner-added
 * requirements, after an inline confirm that names what goes. Each saved plan can be renamed or re-dated, or deleted
 * after a confirm. A saved plan is criteria only (lib/saved-plans-shared): never scouts or teachers. The planning
 * team's (seed); the card renders none of this for anyone else.
 */
import { useMemo, useState } from 'react';
import { DateField } from '@/app/_components/date-field';
import { fmtDate } from '@/lib/format-date';
import type { ThisWeek } from '@/lib/this-week';
import { cleanPlanName, filterPlans, planBadges, planSummary, removedByLoad, type PlanFilter, type SavedPlan } from '@/lib/saved-plans-shared';
import { twDeletePlanAction, twLoadPlanAction, twSavePlanAction, twUpdatePlanAction } from './saved-plan-actions';
import { useWrite } from './this-week-parts';
import s from './this-week.module.css';

type Open = null | 'save' | 'load';

export function SavedPlans({
  entryId,
  meetingDate,
  view,
  plans,
  badges
}: {
  entryId: number;
  /** 'YYYY-MM-DD'. */
  meetingDate: string;
  view: ThisWeek;
  plans: readonly SavedPlan[];
  badges: readonly { id: string; name: string }[];
}) {
  const [open, setOpen] = useState<Open>(null);
  // The buttons sit at the card's top right; an open panel takes the card's full width below the heading row.
  return (
    <>
      <div className={s.savedActions}>
        <button type="button" className={s.quiet} aria-expanded={open === 'save'} onClick={() => setOpen(open === 'save' ? null : 'save')}>
          Save plan…
        </button>
        <button type="button" className={s.savedLink} aria-expanded={open === 'load'} onClick={() => setOpen(open === 'load' ? null : 'load')}>
          Load a saved plan…
        </button>
      </div>
      {open === 'save' ? <SaveForm entryId={entryId} meetingDate={meetingDate} onDone={() => setOpen(null)} /> : null}
      {open === 'load' ? <LoadList entryId={entryId} view={view} plans={plans} badges={badges} onDone={() => setOpen(null)} /> : null}
    </>
  );
}

function SaveForm({ entryId, meetingDate, onDone }: { entryId: number; meetingDate: string; onDone: () => void }) {
  const w = useWrite();
  const [name, setName] = useState('');
  const [date, setDate] = useState(meetingDate);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    if (!cleanPlanName(name)) return setProblem('Give the plan a name (80 characters at most).');
    if (!date) return setProblem('Pick a date.');
    setProblem(null);
    if (await w.run(() => twSavePlanAction({ entryId, name, planDate: date }))) onDone();
  };
  return (
    <form
      className={s.savedPanel}
      aria-label="Save this plan"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className={s.muted}>Saves the focus sets, merit badges and added requirements. Not the scouts or teachers.</p>
      <label className={s.fieldLabel}>
        Name
        <input className={s.search} value={name} maxLength={80} aria-invalid={problem?.startsWith('Give') || undefined} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className={s.fieldLabel}>
        Date
        <DateField value={date} onChange={setDate} />
      </label>
      <div className={s.row}>
        <button type="submit" className={s.savedPrimary} disabled={w.busy || !name.trim()}>
          {w.busy ? 'Saving…' : 'Save plan'}
        </button>
        <button type="button" className={s.quiet} onClick={onDone}>
          Cancel
        </button>
      </div>
      {problem || w.error ? (
        <p className={s.err} role="alert">
          {problem ?? w.error}
        </p>
      ) : null}
    </form>
  );
}

type Mode = { kind: 'load' | 'edit' | 'delete'; id: number } | null;

function LoadList({ entryId, view, plans, badges, onDone }: { entryId: number; view: ThisWeek; plans: readonly SavedPlan[]; badges: readonly { id: string; name: string }[]; onDone: () => void }) {
  const w = useWrite();
  const [f, setF] = useState<PlanFilter>({ q: '', mbId: null, sort: 'newest' });
  const [mode, setMode] = useState<Mode>(null);
  const ids = useMemo(() => badges.map((b) => b.id), [badges]);
  const badgeName = useMemo(() => new Map(badges.map((b) => [b.id, b.name])), [badges]);
  const inPlans = useMemo(() => [...new Set(plans.flatMap((p) => planBadges(p.criteria, ids)))].sort((a, b) => (badgeName.get(a) ?? a).localeCompare(badgeName.get(b) ?? b)), [plans, ids, badgeName]);
  const rows = filterPlans(plans, f, ids);
  if (!plans.length) {
    return (
      <div className={s.savedPanel}>
        <p className={s.muted}>No saved plans yet. Save this one with Save plan….</p>
      </div>
    );
  }
  return (
    <div className={s.savedPanel} role="region" aria-label="Saved plans">
      <div className={s.row}>
        <label className={s.fieldLabel}>
          Find a plan
          <input className={s.search} type="search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Search by name" />
        </label>
        <label className={s.fieldLabel}>
          Merit badge
          <select className={s.search} value={f.mbId ?? ''} onChange={(e) => setF({ ...f, mbId: e.target.value || null })}>
            <option value="">Any</option>
            {inPlans.map((id) => (
              <option key={id} value={id}>
                {badgeName.get(id) ?? id}
              </option>
            ))}
          </select>
        </label>
        <label className={s.fieldLabel}>
          Sort
          <select className={s.search} value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value as PlanFilter['sort'] })}>
            <option value="newest">Newest date first</option>
            <option value="oldest">Oldest date first</option>
          </select>
        </label>
      </div>
      {rows.length ? null : <p className={s.muted}>No saved plan matches.</p>}
      <ul className={s.savedList}>
        {rows.map((p) => (
          <li key={p.id} className={s.savedItem}>
            {mode?.kind === 'edit' && mode.id === p.id ? (
              <EditRow entryId={entryId} plan={p} onDone={() => setMode(null)} />
            ) : (
              <>
                <div className={s.savedMain}>
                  <span className={s.savedName}>{p.name}</span>
                  <span className={s.muted}>
                    {fmtDate(p.planDate)} · {planSummary(p.criteria)}
                  </span>
                </div>
                <div className={s.row}>
                  <button type="button" className={s.toggle} disabled={w.busy} onClick={() => setMode({ kind: 'load', id: p.id })}>
                    Load
                  </button>
                  <button type="button" className={s.quiet} disabled={w.busy} onClick={() => setMode({ kind: 'edit', id: p.id })}>
                    Edit
                  </button>
                  <button type="button" className={s.quiet} disabled={w.busy} onClick={() => setMode({ kind: 'delete', id: p.id })}>
                    Delete
                  </button>
                </div>
                {mode?.kind === 'load' && mode.id === p.id ? (
                  <Confirm
                    text={loadText(p, view)}
                    yes="Load and replace"
                    busy={w.busy}
                    onYes={async () => {
                      if (await w.run(() => twLoadPlanAction({ entryId, planId: p.id }))) {
                        setMode(null);
                        onDone();
                      }
                    }}
                    onNo={() => setMode(null)}
                  />
                ) : null}
                {mode?.kind === 'delete' && mode.id === p.id ? (
                  <Confirm
                    text={`Delete “${p.name}”? It can’t be loaded again. Meetings already planned from it keep their plan.`}
                    yes="Delete"
                    busy={w.busy}
                    onYes={async () => {
                      if (await w.run(() => twDeletePlanAction({ entryId, planId: p.id }))) setMode(null);
                    }}
                    onNo={() => setMode(null)}
                  />
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
      {w.error ? (
        <p className={s.err} role="alert">
          {w.error}
        </p>
      ) : null}
    </div>
  );
}

function loadText(p: SavedPlan, view: ThisWeek): string {
  const gone = removedByLoad(view, p.criteria);
  const head = `Replace this meeting’s focus with “${p.name}” (${planSummary(p.criteria)})?`;
  const goes = gone.length ? ` This takes off ${gone.join(', ')}.` : ' Nothing on this meeting is taken off.';
  return `${head}${goes} Scouts’ answers stay. Teachers signed up for a group or class that goes are kept on file but won’t show until it comes back.`;
}

function Confirm({ text, yes, busy, onYes, onNo }: { text: string; yes: string; busy: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <div className={s.savedConfirm} role="group" aria-label="Confirm">
      <p className={s.savedConfirmText}>{text}</p>
      <div className={s.row}>
        <button type="button" className={s.savedPrimary} disabled={busy} onClick={onYes}>
          {busy ? 'Working…' : yes}
        </button>
        <button type="button" className={s.quiet} disabled={busy} onClick={onNo}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function EditRow({ entryId, plan, onDone }: { entryId: number; plan: SavedPlan; onDone: () => void }) {
  const w = useWrite();
  const [name, setName] = useState(plan.name);
  const [date, setDate] = useState(plan.planDate);
  const [problem, setProblem] = useState<string | null>(null);
  const dirty = name !== plan.name || date !== plan.planDate;
  const save = async () => {
    if (!cleanPlanName(name)) return setProblem('Give the plan a name (80 characters at most).');
    if (!date) return setProblem('Pick a date.');
    setProblem(null);
    if (await w.run(() => twUpdatePlanAction({ entryId, planId: plan.id, name, planDate: date }))) onDone();
  };
  return (
    <form
      className={s.savedEdit}
      aria-label={`Editing ${plan.name}`}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className={s.fieldLabel}>
        Name
        <input className={s.search} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className={s.fieldLabel}>
        Date
        <DateField value={date} onChange={setDate} />
      </label>
      <div className={s.row}>
        <button type="submit" className={s.savedPrimary} disabled={w.busy || !dirty} title={dirty ? undefined : 'No changes to save yet'}>
          {w.busy ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </button>
        <button type="button" className={s.quiet} onClick={onDone}>
          Cancel
        </button>
      </div>
      {problem || w.error ? (
        <p className={s.err} role="alert">
          {problem ?? w.error}
        </p>
      ) : null}
    </form>
  );
}
