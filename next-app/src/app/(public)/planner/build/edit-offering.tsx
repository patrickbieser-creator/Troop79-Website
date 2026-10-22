'use client';

/**
 * A plan row's Edit (Plans/Build-A-Plan.md, B2), in the shared Drawer:
 *
 *   Teacher       (meeting_planner.edit) everyone who could teach it, qualified first with a one-line reason
 *                 (counselors say so), then other adults with what is missing. A tick signs them up to teach it, an
 *                 untick takes them off: each saves at once, like the planner's person drawer. Server-checked.
 *   Requirements  (meeting_planner.seed, a mix only) its name and requirements, saved with "Save changes"; closing the
 *                 drawer discards. Save changes THIS meeting's copy only (B5b). "Also update the focus set '<name>'…",
 *                 a quiet action below, asks first in a danger Dialog; its confirm saves the draft here AND the set in
 *                 one call (no double save). Meetings already using the set keep theirs either way. Dirty-gated Save
 *                 with Discard changes beside it (back to the last save).
 * A control busy saving is aria-disabled (not disabled), so keyboard focus stays on it (qa-lead B2 #1). When unticking
 * the last teacher takes the row off the plan, the drawer stays open and says so (`gone`), never unmounting silently.
 * Each write hands the page its slice (onTeachers / onMix); the drawer never reloads the plan.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/app/_components/button';
import { Drawer } from '@/app/_components/drawer';
import type { PlanRow, TeacherChoice } from '@/lib/build-plan';
import type { FocusSearchRow, FocusSetItem } from '@/lib/meeting-focus';
import { plannerEditMixAction, plannerMixAction, plannerSetTeacherAction, plannerTeacherChoicesAction, type BuildClassResult, type BuildTeacherResult } from '../build-actions';
import { MixPicker } from './add-offering';
import s from './build.module.css';

const SAVE_FAILED = 'That didn’t save. Check your connection and try again.';

export function EditOffering({
  entryId,
  row,
  canEdit,
  canSeed,
  onTeachers,
  onMix,
  onClose,
  gone = false
}: {
  entryId: number;
  row: PlanRow;
  /** The row left the plan while the drawer was open (its last teacher was taken off). */
  gone?: boolean;
  canEdit: boolean;
  canSeed: boolean;
  onTeachers: (res: Extract<BuildTeacherResult, { ok: true }>) => void;
  onMix: (res: Extract<BuildClassResult, { ok: true }>) => void;
  onClose: () => void;
}) {
  const isMix = row.key.startsWith('fg:');
  // A live region mounted from the start (its text set later), so "Removed from the plan." is announced; and since the
  // focused teacher toggle unmounts with its section, focus moves here (qa-lead B3 #2).
  const status = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (gone) status.current?.focus();
  }, [gone]);
  return (
    <Drawer eyebrow="Edit" title={row.title} sub={row.codeLabel} onClose={onClose}>
      <p ref={status} className={gone ? s.pickMeta : s.srOnly} role="status" tabIndex={-1}>
        {gone ? 'Removed from the plan.' : ''}
      </p>
      {canEdit && !gone ? <TeacherSection entryId={entryId} rowKey={row.key} onTeachers={onTeachers} /> : null}
      {canSeed && isMix && !gone ? <MixSection entryId={entryId} rowKey={row.key} onMix={onMix} /> : null}
    </Drawer>
  );
}

function TeacherSection({ entryId, rowKey, onTeachers }: { entryId: number; rowKey: string; onTeachers: (res: Extract<BuildTeacherResult, { ok: true }>) => void }) {
  const [choices, setChoices] = useState<TeacherChoice[] | null | 'failed'>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [problem, setProblem] = useState<{ id: number; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    plannerTeacherChoicesAction({ entryId, key: rowKey })
      .then((res) => live && setChoices(res.ok ? res.choices : 'failed'))
      .catch(() => live && setChoices('failed'));
    return () => {
      live = false;
    };
  }, [entryId, rowKey]);

  const toggle = async (c: TeacherChoice) => {
    if (busy != null) return;
    setBusy(c.personId);
    setProblem(null);
    const res = await plannerSetTeacherAction({ entryId, key: rowKey, personId: c.personId, on: !c.teaching }).catch(() => ({ ok: false as const, error: SAVE_FAILED }));
    setBusy(null);
    if (!res.ok) {
      setProblem({ id: c.personId, text: res.error });
      return;
    }
    setChoices((cs) => (Array.isArray(cs) ? cs.map((x) => (x.personId === c.personId ? { ...x, teaching: !c.teaching } : x)) : cs));
    onTeachers(res);
  };

  const list = (items: TeacherChoice[]) => (
    <ul className={s.pickList}>
      {items.map((c) => (
        <li key={c.personId}>
          <button type="button" className={c.teaching ? s.tickOn : s.tick} aria-pressed={c.teaching} aria-disabled={busy === c.personId || undefined} onClick={() => toggle(c)}>
            <span className={s.tickBox} aria-hidden="true">
              {c.teaching ? '✓' : ''}
            </span>
            <span>
              <span className={s.pickTitle}>{c.name}</span>
              {c.reason ? <span className={s.pickMeta}>{c.reason}</span> : null}
            </span>
          </button>
          {problem?.id === c.personId ? (
            <p className={s.problem} role="alert">
              {problem.text}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );

  const ready = Array.isArray(choices) ? choices : [];
  const fit = ready.filter((c) => c.teaching || c.qualified);
  const others = ready.filter((c) => !c.teaching && !c.qualified);
  return (
    <section className={s.editSection} aria-labelledby="edit-teacher">
      <h3 id="edit-teacher" className={s.editLabel}>
        Teacher
      </h3>
      {choices === null ? <p className={s.pickMeta}>Finding who can teach it…</p> : null}
      {choices === 'failed' ? <p className={s.problem}>The list didn’t load. Close and try again.</p> : null}
      {Array.isArray(choices) && !fit.length ? <p className={s.pickMeta}>Nobody listed has this skill yet.</p> : null}
      {fit.length ? list(fit) : null}
      {others.length ? (
        <details className={s.others}>
          <summary>Other adults ({others.length})</summary>
          {list(others)}
        </details>
      ) : null}
    </section>
  );
}

const asRow = (i: FocusSetItem): FocusSearchRow => ({ ...i, parent: null, topLevel: false });

function MixSection({ entryId, rowKey, onMix }: { entryId: number; rowKey: string; onMix: (res: Extract<BuildClassResult, { ok: true }>) => void }) {
  const [saved, setSaved] = useState<{ name: string; items: FocusSearchRow[] } | null | 'failed'>(null);
  const [masterName, setMasterName] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState('');
  const [items, setItems] = useState<FocusSearchRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ at: 'name' | 'items' | 'save'; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    plannerMixAction({ entryId, key: rowKey })
      .then((res) => {
        if (!live) return;
        if (!res.ok) return setSaved('failed');
        const it = res.items.map(asRow);
        setSaved({ name: res.name, items: it });
        setMasterName(res.setName);
        setName(res.name);
        setItems(it);
      })
      .catch(() => live && setSaved('failed'));
    return () => {
      live = false;
    };
  }, [entryId, rowKey]);

  if (saved === null) return <p className={s.pickMeta}>Loading the mix…</p>;
  if (saved === 'failed') return <p className={s.problem}>The mix didn’t load. Close and try again.</p>;
  const dirty = name !== saved.name || items.map((i) => i.key).join('|') !== saved.items.map((i) => i.key).join('|');

  const discard = () => {
    setName(saved.name);
    setItems(saved.items);
    setProblem(null);
  };
  /** Marks a missing name or an empty mix in place; true when the draft can be written. */
  const whole = () => {
    if (!name.trim()) setProblem({ at: 'name', text: 'Give the mix a name.' });
    else if (!items.length) setProblem({ at: 'items', text: 'Tick at least one requirement.' });
    else return true;
    return false;
  };
  /** One write: this meeting's copy, plus the focus set when `updateSet`. The error to show, or null. */
  const write = async (updateSet: boolean): Promise<string | null> => {
    setBusy(true);
    setProblem(null);
    const input = { entryId, key: rowKey, name, items: items.map((i) => i.key) };
    const res = await plannerEditMixAction(updateSet ? { ...input, updateSet } : input).catch(() => ({ ok: false as const, error: SAVE_FAILED }));
    setBusy(false);
    if (!res.ok) return res.error;
    setSaved({ name: res.title, items });
    setName(res.title);
    if (updateSet) setMasterName(res.title);
    onMix(res);
    return null;
  };
  const save = async () => {
    if (busy || !dirty || !whole()) return;
    const err = await write(false);
    if (err) setProblem({ at: 'save', text: err });
  };
  const askUpdateSet = () => {
    if (busy || !whole()) return;
    setConfirming(true);
  };

  return (
    <section className={s.editSection} aria-labelledby="edit-mix">
      <h3 id="edit-mix" className={s.editLabel}>
        Requirements
      </h3>
      <p className={s.pickMeta}>Changes this meeting only.</p>
      <label className={s.fieldLabel}>
        Name
        <input
          type="text"
          className={problem?.at === 'name' ? `${s.addInput} ${s.bad}` : s.addInput}
          value={name}
          maxLength={80}
          aria-invalid={problem?.at === 'name' || undefined}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className={problem?.at === 'items' ? s.badBox : undefined}>
        <MixPicker ticked={items} onChange={setItems} label="Add a requirement" />
      </div>
      {problem ? (
        <p className={s.problem} role="alert">
          {problem.text}
        </p>
      ) : null}
      <div className={s.mixActions}>
        <Button variant="primary" size="sm" onClick={save} disabled={!dirty} aria-disabled={busy || undefined} title={dirty ? undefined : 'No changes to save yet'}>
          {busy ? 'Saving changes…' : dirty ? 'Save changes' : 'Saved'}
        </Button>
        <Button variant="ghost" size="sm" onClick={discard} disabled={!dirty || busy}>
          Discard changes
        </Button>
      </div>
      <div className={s.mixActions}>
        <Button variant="ghost" size="sm" onClick={askUpdateSet} aria-disabled={busy || undefined}>
          Also update the focus set ‘{masterName}’…
        </Button>
      </div>
      {confirming ? <UpdateSetDialog masterName={masterName} dirty={dirty} onConfirm={() => write(true)} onClose={() => setConfirming(false)} /> : null}
    </section>
  );
}

/** "Are you sure?" before the master focus set changes. With a dirty draft its one action saves the draft here too. */
function UpdateSetDialog({ masterName, dirty, onConfirm, onClose }: { masterName: string; dirty: boolean; onConfirm: () => Promise<string | null>; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const dlg = ref.current;
    if (dlg && typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
    else dlg?.setAttribute('open', '');
  }, []);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    const err = await onConfirm();
    setBusy(false);
    if (err) setProblem(err);
    else onClose();
  };
  return (
    <dialog
      ref={ref}
      className={s.confirm}
      aria-labelledby="build-update-set-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="build-update-set-title" className={s.confirmTitle}>
        Are you sure?
      </h2>
      <p className={s.confirmText}>
        Update the focus set ‘{masterName}’? Plans that add it from now on get these requirements. Meetings already using it keep theirs.
      </p>
      {dirty ? <p className={s.confirmText}>Your unsaved changes are saved to this meeting as well.</p> : null}
      {problem ? (
        <p className={s.problem} role="alert">
          {problem}
        </p>
      ) : null}
      <div className={s.confirmActions}>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="danger" onClick={go} aria-disabled={busy || undefined}>
          {busy ? 'Updating…' : 'Update the focus set'}
        </Button>
      </div>
    </dialog>
  );
}
