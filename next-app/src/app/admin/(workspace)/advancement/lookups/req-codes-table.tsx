'use client';

/**
 * Internal Requirement Codes — top-level (parent_id IS NULL) rows only;
 * nested sub-requirement tree editing still ships in a later slice (that's
 * done per-MB in the Merit Badge Catalog card's own tree editor instead).
 *
 * Renaming `code` cascades to ledger_entries.code (updateReqCode in
 * actions.ts) — historical rows store `<parentId>-<code>` composite keys
 * that the Fast Entry picker and award-gating logic match against, so a
 * silent rename would otherwise strand already-completed requirements.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import { SaveButton, SaveFeedback, useSavedSnapshot, useSavePhase } from '../../_components/save-state';
import { updateReqCode } from './actions';
import { parseTeachMinutes } from '@/lib/meeting-board-picklist';
import { useLookupTable } from './use-lookup-table';
import styles from './lookups.module.css';
import { Notice } from '../../_components/notice';
import { Dialog, DialogHeader, DialogBody, DialogActions } from '../../_components/dialog';
import { Button } from '../../../_components/button';
import type { RequirementClass } from '@/lib/requirement-class';

export interface ReqRow {
  id: number;
  source: 'rank' | 'mb';
  parentId: string;
  parentLabel: string;
  code: string;
  label: string;
  /** Immediate parent's code, e.g. "4" for rank code "4a" — null for
   *  top-level rows. Rank rows only; MB nested rows aren't shown here. */
  nestedUnder: string | null;
  /** Verbatim official BSA text, leader-pasted. Empty string = not yet set. */
  officialText: string;
  /** Expected minutes to teach it (T-3). */
  minutes: number;
  /** A rank requirement with sub-requirements: the sum of theirs, which is its time (set on the parts, not here). */
  partsMinutes: number | null;
  /** Its own class tags (Plans/Requirement-Classification.md); empty = untagged. */
  classCodes: string[];
  /** What the planner reads: its own tags, else its parent's, else M. */
  effectiveClasses: string[];
}

/** The class filter: every class, one class (by effective tag), or the untagged ones. */
const ALL = '';
const UNTAGGED = '-';

export function ReqCodesTable({ rows, classes }: { rows: ReqRow[]; classes: RequirementClass[] }) {
  const [openFor, setOpenFor] = useState<ReqRow | null>(null);
  const [classFilter, setClassFilter] = useState(ALL);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const filtered =
    classFilter === ALL ? rows : classFilter === UNTAGGED ? rows.filter((r) => !r.classCodes.length) : rows.filter((r) => r.effectiveClasses.includes(classFilter));
  const t = useLookupTable(filtered, (r) => `${r.code} ${r.label} ${r.parentLabel}`);
  const untagged = rows.filter((r) => !r.classCodes.length).length;

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (openFor && !dlg.open) dlg.showModal();
    if (!openFor && dlg.open) dlg.close();
  }, [openFor]);

  return (
    <>
      <div className={styles.cardToolbar}>
        {t.searchEl}
        <select className={styles.editInput} aria-label="Filter by class" value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
          <option value={ALL}>All classes</option>
          {classes.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} {c.name}
            </option>
          ))}
          <option value={UNTAGGED}>Untagged ({untagged})</option>
        </select>
      </div>
      <div className={t.scrollClass}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Code</th>
              <th>Label</th>
              <th>Source</th>
              <th className={styles.cellRight}>Minutes</th>
              <th>Classes</th>
              <th className={styles.cellRight}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={`${r.source}-${r.parentId}-${r.code}`}>
                <td className={styles.codeCell} style={r.nestedUnder ? { paddingLeft: 20 } : undefined}>
                  {r.nestedUnder ? `↳ ${r.code}` : r.code}
                </td>
                <td>{r.label}</td>
                <td>
                  <span className={`${styles.tag} ${r.source === 'rank' ? styles.tagRank : styles.tagMb}`}>
                    {r.source === 'rank' ? 'Rank' : 'MB'}: {r.parentLabel}
                    {r.nestedUnder ? ` — under ${r.nestedUnder}` : ''}
                  </span>
                  {r.officialText && (
                    <span className={`${styles.tag} ${styles.gapLeftSm}`} title="Official text on file">
                      📄
                    </span>
                  )}
                </td>
                <td className={styles.cellRight} data-col="minutes">
                  {r.partsMinutes != null ? `${r.partsMinutes} (its parts)` : r.minutes}
                </td>
                <td className={styles.codeCell}>
                  {r.classCodes.length ? (
                    r.classCodes.join(' ')
                  ) : (
                    <span className={styles.muted} title={r.nestedUnder ? 'Untagged: takes its parent’s classes' : 'Untagged: counts as a troop meeting'}>
                      {r.effectiveClasses.join(' ')}
                    </span>
                  )}
                </td>
                <td className={styles.cellRight}>
                  <Button variant="secondary" size="sm" onClick={() => setOpenFor(r)}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t.footerEl}

      <Dialog ref={dialogRef} onClose={() => setOpenFor(null)}>
        {openFor && <ReqCodeForm row={openFor} classes={classes} onClose={() => setOpenFor(null)} />}
      </Dialog>
    </>
  );
}

export function ReqCodeForm({ row, classes, onClose }: { row: ReqRow; classes: RequirementClass[]; onClose: () => void }) {
  const [code, setCode] = useState(row.code);
  const [tags, setTags] = useState<string[]>(row.classCodes);
  const [label, setLabel] = useState(row.label);
  const [officialText, setOfficialText] = useState(row.officialText);
  const [minutes, setMinutes] = useState(String(row.minutes));
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { dirty } = useSavedSnapshot(JSON.stringify({ code, label, officialText, minutes, tags }));
  const ownTime = row.partsMinutes == null;
  const badMinutes = ownTime && parseTeachMinutes(minutes) == null;
  const feedback = useSavePhase();

  function submit() {
    setErr(null);
    if (!code.trim()) return setErr('Code is required.');
    if (!label.trim()) return setErr('Label is required.');
    if (badMinutes) return setErr('Minutes to teach is a whole number from 1 to 240.');
    const fd = new FormData();
    fd.set('id', String(row.id));
    fd.set('source', row.source);
    fd.set('parent_id', row.parentId);
    fd.set('original_code', row.code);
    fd.set('code', code.trim());
    fd.set('label', label.trim());
    fd.set('official_text', officialText.trim());
    if (ownTime) fd.set('teach_minutes', minutes.trim());
    fd.set('class_codes', JSON.stringify(tags));
    feedback.start();
    startTransition(async () => {
      const res = await updateReqCode(fd);
      if (!res.ok) {
        feedback.fail();
        setErr(res.error ?? 'Save failed');
        return;
      }
      feedback.doneThen(onClose);
    });
  }

  return (
    <>
      <DialogHeader
        title={`Edit ${row.source === 'rank' ? 'Rank' : 'MB'} requirement — ${row.parentLabel}`}
        sub="Renaming the code updates every ledger entry already recorded under
          the old code, so completed requirements stay matched to the catalog."
      />

      <DialogBody>
      <div className={styles.fieldGrid}>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Code</span>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={`${styles.editInput} ${styles.editInputMono}`}
          />
        </label>
        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>Label</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={styles.editInput}
          />
        </label>
        {ownTime ? (
          <label className={styles.editField}>
            <span className={styles.editLabel}>Minutes to teach</span>
            <input
              type="number"
              min={1}
              max={240}
              step={1}
              value={minutes}
              aria-invalid={badMinutes || undefined}
              onChange={(e) => setMinutes(e.target.value)}
              className={styles.editInput}
            />
          </label>
        ) : (
          <p className={styles.editFieldFull}>
            Minutes to teach: {row.partsMinutes}, set on its parts (the sub-requirements below it add up to this).
          </p>
        )}
        <fieldset className={styles.editFieldFull}>
          <legend className={styles.editLabel}>Classes: where it can be done</legend>
          {/* A retired class shows only where it is already ticked; untagged counts as a troop meeting. Two columns,
              A to Z by name, read top to bottom. */}
          <div className={styles.classChecks}>
          {classes
            .filter((c) => !c.retired || tags.includes(c.code))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => (
              <label key={c.code} className={styles.checkInline} title={c.description}>
                <input
                  type="checkbox"
                  checked={tags.includes(c.code)}
                  onChange={(e) =>
                    setTags((now) => {
                      const next = e.target.checked ? [...now, c.code] : now.filter((x) => x !== c.code);
                      return classes.map((k) => k.code).filter((k) => next.includes(k));
                    })
                  }
                />
                {c.code} {c.name}
                {c.retired ? ' (retired)' : ''}
              </label>
            ))}
          </div>
        </fieldset>
        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>Official text (reference)</span>
          <textarea
            value={officialText}
            onChange={(e) => setOfficialText(e.target.value)}
            className={styles.editInput}
            rows={4}
            placeholder="Verbatim official BSA requirement wording — paste it here. Shown only to logged-in leaders and families, never on a public page."
          />
        </label>
      </div>

      {err && <Notice>{err}</Notice>}
      </DialogBody>

      <DialogActions>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <SaveButton
          dirty={dirty}
          pending={isPending}
          blocked={!code.trim() || !label.trim() || badMinutes}
          blockedReason={badMinutes ? 'Minutes to teach is a whole number from 1 to 240' : 'Code and label are required'}
          onClick={submit}
        />
        <SaveFeedback phase={feedback.phase} />
      </DialogActions>
    </>
  );
}
