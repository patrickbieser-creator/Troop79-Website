'use client';

/**
 * The bulk patrol assignment screen (Patrick, 2026-08-22).
 *
 * WHY A TABLE AND NOT DRAG-AND-DROP. The project already has the sortable
 * machinery from the front-page order work, and dragging scouts between patrol
 * columns is the obvious pretty answer. It is the wrong one here: the job is
 * "put these 23 scouts into four patrols", which is a bulk operation — select
 * a run of names, pick a patrol once. Dragging is 23 separate gestures, is
 * hostile to the keyboard, and is worse on the phone a leader is likely
 * holding. Checkboxes plus one Assign are faster and reachable by everyone.
 *
 * NOTHING SAVES UNTIL SAVE. Every edit lands in a local draft, the counts
 * update live so the shape of the troop is visible while deciding, and one
 * Save writes only the rows that actually changed. That is also what makes
 * Discard meaningful.
 */

import { useMemo, useState, useTransition } from 'react';
import {
  applyBulk,
  assignableScouts,
  diffAssignments,
  distinctPatrols,
  duplicateSpellings,
  normalizePatrolName,
  patrolCounts,
  suspectPatrolValues,
  type PatrolDraft,
  type PatrolScout
} from '@/lib/patrol-assign';
import { gradeFromGradYear, gradeLabel } from '@/lib/demographics';
// Rank ids are stored on the scout ("second-class"); this renders the display
// name. Shared with the printable roster rather than written twice.
import { rankLabel, type RosterPrintRank } from '@/lib/roster-print';
import { Notice } from '../../../_components/notice';
import { SaveButton, SaveFeedback, useSavePhase } from '../../../_components/save-state';
import styles from './patrols.module.css';

type ActionResult = { ok: boolean; error?: string; changed?: number };

/** Sentinel for the "Unassigned" option — a select cannot carry null. */
const NONE = '__none__';
const NEW = '__new__';

export function PatrolBoard({
  scouts,
  ranks,
  onSave
}: {
  scouts: PatrolScout[];
  ranks: RosterPrintRank[];
  onSave: (draft: PatrolDraft) => Promise<ActionResult>;
}) {
  const [draft, setDraft] = useState<PatrolDraft>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState<string>(NONE);
  const [newPatrol, setNewPatrol] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const feedback = useSavePhase(); // Save standard (2026-08-24)

  const rows = useMemo(() => assignableScouts(scouts), [scouts]);
  const known = useMemo(() => distinctPatrols(scouts), [scouts]);
  // Names typed during this session join the dropdown immediately, so the
  // second scout into a brand-new patrol is one click, not retyping.
  const options = useMemo(() => {
    const fromDraft = Object.values(draft)
      .map((v) => normalizePatrolName(v))
      .filter((v): v is string => !!v);
    return [...new Set([...known, ...fromDraft])].sort((a, b) => a.localeCompare(b));
  }, [known, draft]);

  const counts = useMemo(() => patrolCounts(scouts, draft), [scouts, draft]);
  const changes = useMemo(() => diffAssignments(scouts, draft), [scouts, draft]);
  const suspect = useMemo(() => suspectPatrolValues(options), [options]);
  const dupes = useMemo(() => duplicateSpellings(options), [options]);

  function valueFor(s: PatrolScout): string {
    const v = Object.prototype.hasOwnProperty.call(draft, s.id)
      ? normalizePatrolName(draft[s.id])
      : normalizePatrolName(s.patrol);
    return v ?? NONE;
  }

  function setOne(id: string, raw: string) {
    setSaved(null);
    setDraft((d) => ({ ...d, [id]: raw === NONE ? null : raw }));
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  /** Select every scout currently in one bucket — the fast path for "move the
   *  whole unassigned pile into patrols" and for emptying a patrol. */
  function selectBucket(name: string | null) {
    const ids = rows.filter((r) => valueFor(r) === (name ?? NONE)).map((r) => r.id);
    setSelected(new Set(ids));
  }

  function assignSelected() {
    setErr(null);
    setSaved(null);
    const target = bulkTarget === NEW ? normalizePatrolName(newPatrol) : bulkTarget === NONE ? null : bulkTarget;
    if (bulkTarget === NEW && !target) {
      setErr('Type a name for the new patrol.');
      return;
    }
    setDraft((d) => applyBulk(d, [...selected], target));
    setSelected(new Set());
    if (bulkTarget === NEW) {
      setBulkTarget(target!);
      setNewPatrol('');
    }
  }

  function save() {
    setErr(null);
    setSaved(null);
    feedback.start();
    startTransition(async () => {
      const res = await onSave(draft);
      if (!res.ok) {
        feedback.fail();
        setErr(res.error ?? 'Save failed');
        return;
      }
      setSaved(res.changed ?? 0);
      setDraft({});
      setSelected(new Set());
      feedback.done();
    });
  }

  const unassigned = counts.find((c) => c.name === null)?.count ?? 0;

  return (
    <div>
      <div className={styles.countsRow}>
        {counts.map((c) => (
          <button
            key={c.name ?? NONE}
            type="button"
            className={`${styles.countChip} ${c.name === null ? styles.countChipNone : ''}`}
            onClick={() => selectBucket(c.name)}
            title={`Select everyone in ${c.name ?? 'Unassigned'}`}
          >
            {c.name ?? 'Unassigned'} <span className={styles.countNum}>{c.count}</span>
          </button>
        ))}
      </div>

      {suspect.length > 0 && (
        <Notice variant="warning">
          <strong>{suspect.join(', ')}</strong> {suspect.length === 1 ? 'is' : 'are'} in the patrol
          column but {suspect.length === 1 ? 'is not a patrol' : 'are not patrols'}. Junior Leader
          has its own setting on the scout&rsquo;s Roster record, so a scout carrying it here has
          two different things in one field. Reassign them to a real patrol and set Junior Leader on
          their record instead.
        </Notice>
      )}

      {dupes.length > 0 && (
        <Notice variant="warning">
          Two spellings of the same patrol:{' '}
          {dupes.map(([a, b]) => `“${a}” and “${b}”`).join('; ')}. Assign everyone to one spelling
          and the other disappears.
        </Notice>
      )}

      <div className={styles.bulkBar}>
        <label className={styles.bulkCheck}>
          <input
            type="checkbox"
            checked={selected.size > 0 && selected.size === rows.length}
            onChange={toggleAll}
            aria-label="Select every scout"
          />
          <span>{selected.size > 0 ? `${selected.size} selected` : 'Select all'}</span>
        </label>

        <span className={styles.bulkWord}>Assign to</span>
        <select
          className={styles.bulkSelect}
          value={bulkTarget}
          onChange={(e) => setBulkTarget(e.target.value)}
          aria-label="Patrol to assign the selected scouts to"
        >
          <option value={NONE}>Unassigned</option>
          {options.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          <option value={NEW}>+ New patrol…</option>
        </select>

        {bulkTarget === NEW && (
          <input
            type="text"
            className={styles.bulkInput}
            value={newPatrol}
            placeholder="Patrol name"
            onChange={(e) => setNewPatrol(e.target.value)}
            aria-label="New patrol name"
          />
        )}

        <button
          type="button"
          className={styles.bulkBtn}
          onClick={assignSelected}
          disabled={selected.size === 0}
        >
          Assign {selected.size > 0 ? selected.size : ''}
        </button>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.checkCol}>
              <span className={styles.srOnly}>Select</span>
            </th>
            <th>Scout</th>
            <th>Grade</th>
            <th>Rank</th>
            <th>Patrol</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const value = valueFor(s);
            const changed = changes.some((c) => c.id === s.id);
            return (
              <tr key={s.id} className={changed ? styles.rowChanged : ''}>
                <td className={styles.checkCol}>
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => toggle(s.id)}
                    aria-label={`Select ${s.display_name}`}
                  />
                </td>
                <td className={styles.nameCell}>{s.display_name}</td>
                <td className={styles.muted}>{gradeLabel(gradeFromGradYear(s.graduation_year)) || '—'}</td>
                <td className={styles.muted}>{rankLabel(s.current_rank, ranks) ?? '—'}</td>
                <td>
                  <select
                    className={styles.rowSelect}
                    value={value}
                    onChange={(e) => setOne(s.id, e.target.value)}
                    aria-label={`Patrol for ${s.display_name}`}
                  >
                    <option value={NONE}>— Unassigned —</option>
                    {options.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {err && <Notice variant="error">{err}</Notice>}
      {saved !== null && (
        <Notice variant="success">
          {saved === 0
            ? 'Nothing to save — no patrol changed.'
            : `Saved — ${saved} scout${saved === 1 ? '' : 's'} moved.`}
        </Notice>
      )}

      <div className={styles.saveBar}>
        <span className={styles.saveCount}>
          {changes.length === 0
            ? unassigned > 0
              ? `${unassigned} scout${unassigned === 1 ? '' : 's'} still unassigned`
              : 'Every scout is in a patrol'
            : `${changes.length} change${changes.length === 1 ? '' : 's'} pending`}
        </span>
        <button
          type="button"
          className={styles.discardBtn}
          onClick={() => {
            setDraft({});
            setSelected(new Set());
            setSaved(null);
            setErr(null);
          }}
          disabled={changes.length === 0 || isPending}
        >
          Discard
        </button>
        <SaveButton
          className={styles.saveBtn}
          dirty={changes.length > 0}
          pending={isPending}
          dirtyLabel="Save patrol assignments"
          onClick={save}
        />
        <SaveFeedback phase={feedback.phase} />
      </div>
    </div>
  );
}
