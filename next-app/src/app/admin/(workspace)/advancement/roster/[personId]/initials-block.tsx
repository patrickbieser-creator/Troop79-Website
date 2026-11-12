'use client';

/**
 * Sign-off initials (Plans/Sign-Off-Initials.md) — the person's leaders.code,
 * the initials every ledger entry they sign carries in `by`. Shown on every
 * tab: youth leaders (JPII, OV, VK, MST) are scouts.
 *
 *   None:     "None" + Add → a code pre-filled with the suggestion.
 *   Active:   the code, how many entries it signs, Edit and Retire….
 *             A rename rewrites every entry, so it confirms with the count.
 *   Retired:  "PB, retired October 2026" + Restore.
 *
 * Each write takes effect immediately (one RPC), like the Roles block.
 * A badly shaped code keeps Save enabled; a click marks the field and says why.
 */
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtMonthYear } from '@/lib/format-date';
import { initialsShapeProblem } from '@/lib/sign-off-initials';
import { Button } from '../../../../_components/button';
import { Notice } from '../../../_components/notice';
import { SaveButton } from '../../../_components/save-state';
import saveStyles from '../../../_components/save-state.module.css';
import { ConfirmDialog, useImmediate, type ConfirmSpec } from './immediate';
import { addInitials, renameInitials, setInitialsRetired } from './initials-actions';
import type { PersonRecord } from './record-types';
import styles from './person-record.module.css';

type Pending = { kind: 'rename'; to: string } | { kind: 'retire' };

export function InitialsBlock({
  personId,
  name,
  initials,
  suggestion
}: {
  personId: number;
  name: string;
  initials: PersonRecord['initials'];
  suggestion: string;
}) {
  const router = useRouter();
  const imm = useImmediate();
  const inputId = useId();
  const noteId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const isNew = initials == null;
  const original = initials?.code ?? '';
  const problem = initialsShapeProblem(draft);
  const showProblem = tried && problem != null;
  const entries = initials?.entries ?? 0;
  const entriesLabel = `${entries.toLocaleString('en-US')} ledger ${entries === 1 ? 'entry' : 'entries'}`;

  function open() {
    imm.clear();
    setDraft(isNew ? suggestion : original);
    setTried(false);
    setEditing(true);
  }

  function close() {
    setEditing(false);
    setTried(false);
  }

  function save() {
    const code = draft.trim();
    if (isNew) {
      void imm.run(() => addInitials(personId, code), () => {
        close();
        router.refresh();
      }, `Added initials ${code}.`);
      return;
    }
    if (entries === 0) {
      void imm.run(() => renameInitials(personId, code), () => {
        close();
        router.refresh();
      }, `Changed initials to ${code}.`);
      return;
    }
    setDialogError(null);
    setPending({ kind: 'rename', to: code });
  }

  function confirmPending() {
    if (!pending) return;
    const p = pending;
    const fn = p.kind === 'rename' ? () => renameInitials(personId, p.to) : () => setInitialsRetired(personId, true);
    const ok = p.kind === 'rename' ? `Changed initials to ${p.to}.` : `Retired ${original}.`;
    void imm
      .run(fn, () => {
        close();
        router.refresh();
      }, ok)
      .then((done) => {
        if (done) setPending(null);
        else setDialogError('Nothing changed — see the message above.');
      });
  }

  function restore() {
    void imm.run(() => setInitialsRetired(personId, false), () => router.refresh(), `Restored ${original}.`);
  }

  function specFor(p: Pending): ConfirmSpec {
    if (p.kind === 'rename') {
      return {
        title: `Rename ${original} to ${p.to}?`,
        body: (
          <ul className={styles.consequences}>
            <li>
              {entriesLabel} signed {original} will read {p.to}
            </li>
            <li>Merit badge counselor and teaching links follow the new initials</li>
          </ul>
        ),
        okLabel: `Rename to ${p.to}`
      };
    }
    return {
      title: `Retire ${original}?`,
      body: (
        <ul className={styles.consequences}>
          <li>{original} leaves the Signed Off By lists in Fast Entry, Audits and the Ledger</li>
          <li>
            The {entriesLabel} signed {original} still name {name}
          </li>
          <li>Restore puts it back; after 5 years without a new entry the initials can go to someone else</li>
        </ul>
      ),
      okLabel: `Retire ${original}`
    };
  }

  return (
    <div>
      {imm.error && <Notice>{imm.error}</Notice>}
      {imm.notice && <Notice variant="success">{imm.notice}</Notice>}

      {!editing && (
        <ul className={styles.list}>
          <li>
            <span className={styles.grow}>
              {initials == null ? (
                <span className={styles.muted}>None</span>
              ) : initials.retiredAt ? (
                <>
                  <strong>{initials.code}</strong>
                  <span className={styles.muted}>, retired {fmtMonthYear(initials.retiredAt)}</span>
                </>
              ) : (
                <>
                  <strong>{initials.code}</strong> <span className={styles.muted}>· {entriesLabel}</span>
                </>
              )}
            </span>
            <span className={styles.rowActions}>
              {initials == null ? (
                <Button size="sm" variant="quiet" disabled={imm.busy} onClick={open}>
                  Add
                </Button>
              ) : initials.retiredAt ? (
                <Button size="sm" variant="quiet" disabled={imm.busy} onClick={restore}>
                  Restore
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="quiet" disabled={imm.busy} onClick={open}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    disabled={imm.busy}
                    onClick={() => {
                      setDialogError(null);
                      setPending({ kind: 'retire' });
                    }}
                  >
                    Retire…
                  </Button>
                </>
              )}
            </span>
          </li>
        </ul>
      )}

      {editing && (
        <form
          className={styles.addRow}
          onSubmit={(e) => {
            e.preventDefault();
            if (problem) setTried(true);
            else save();
          }}
        >
          <label htmlFor={inputId} className={styles.muted}>
            {isNew ? 'New initials' : 'Initials'}
          </label>
          <input
            id={inputId}
            value={draft}
            maxLength={6}
            autoComplete="off"
            spellCheck={false}
            disabled={imm.busy}
            className={showProblem ? saveStyles.bad : undefined}
            aria-invalid={showProblem || undefined}
            aria-describedby={showProblem ? noteId : undefined}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
            }}
          />
          <SaveButton
            type="submit"
            isNew={isNew}
            newLabel="Add initials"
            dirtyLabel="Save initials"
            dirty={draft.trim() !== original}
            pending={imm.busy}
            blocked={problem != null}
            onBlocked={() => setTried(true)}
          />
          <Button disabled={imm.busy} onClick={close}>
            Cancel
          </Button>
          {showProblem && (
            <p id={noteId} className={saveStyles.badNote} role="alert">
              Can’t save yet: {problem}
            </p>
          )}
        </form>
      )}

      {pending && (
        <ConfirmDialog
          spec={specFor(pending)}
          busy={imm.busy}
          error={dialogError}
          onConfirm={confirmPending}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
