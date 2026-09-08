'use client';

import { useState, useTransition } from 'react';
import { SaveButton, SaveFeedback, useSavePhase } from '../../_components/save-state';
import { useRouter } from 'next/navigation';
import { createHousehold, renameHousehold, deleteHousehold } from './household-actions';
import { setHousehold } from '../roster/person-actions';
import styles from './lookups.module.css';
import { Button } from '../../../_components/button';

export interface HouseholdMemberRow {
  personId: number;
  name: string;
}

export interface HouseholdRow {
  id: number;
  label: string;
  members: HouseholdMemberRow[];
}

/** The last removal, so the notice can offer to put them back. */
interface Removed {
  personId: number;
  name: string;
  householdId: number;
  label: string;
}

/**
 * The households themselves — not who is in them, which is edited on each
 * person. The one membership edit offered here is REMOVAL (Patrick,
 * 2026-09-08: "there is no way that I can find to remove a person from a
 * household") — each listed member carries a × that writes at once through
 * the same setHousehold(member, null) the person record uses, with an Undo.
 * Adding someone stays on the person: their record is where you confirm
 * which Johnson you mean.
 *
 * Every row lists its members, because the label alone does not identify a
 * household: the troop has two Stollenwerk families, and had two Haslam and two
 * Pasquesi entries where one of each held nobody. Duplicate labels are called
 * out rather than prevented — two Johnson families may legitimately share a
 * surname, so the fix is naming them apart, not refusing the second.
 */
export function HouseholdsManager({ households }: { households: HouseholdRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [removed, setRemoved] = useState<Removed | null>(null);

  function removeMember(h: HouseholdRow, m: HouseholdMemberRow) {
    setRemoved(null);
    run(
      () => setHousehold(m.personId, null),
      () => setRemoved({ personId: m.personId, name: m.name, householdId: h.id, label: h.label })
    );
  }

  function undoRemove() {
    if (!removed) return;
    const r = removed;
    run(
      () => setHousehold(r.personId, r.householdId),
      () => setRemoved(null)
    );
  }

  const labelCounts = households.reduce<Record<string, number>>((acc, h) => {
    const k = h.label.trim().toLowerCase();
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  const feedback = useSavePhase();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        feedback.fail();
        setError(res.error ?? 'Something went wrong.');
      } else {
        setEditing(null);
        feedback.done();
        onOk?.();
        router.refresh();
      }
    });
  }

  return (
    <div>
      <SaveFeedback phase={feedback.phase} />
      {error && <div className={styles.rowError}>{error}</div>}
      {removed && (
        <div className={styles.notice} role="status" aria-label="Household changed">
          <span className={styles.noticeText}>
            Removed {removed.name} from {removed.label} — they stay on the roster.
          </span>
          <Button variant="secondary" size="sm" disabled={pending} onClick={undoRemove}>
            Undo
          </Button>
          <button type="button" className={styles.noticeClose} aria-label="Dismiss" onClick={() => setRemoved(null)}>
            ×
          </button>
        </div>
      )}

      <div className={styles.addRow}>
        <input
          className={styles.input}
          value={newLabel}
          placeholder="New household — e.g. Stollenwerk (Joe &amp; Mindy)"
          disabled={pending}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newLabel.trim()) {
              run(() => createHousehold(newLabel));
              setNewLabel('');
            }
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={pending || !newLabel.trim()}
          onClick={() => {
            run(() => createHousehold(newLabel));
            setNewLabel('');
          }}
        >
          + Add household
        </Button>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Household</th>
            <th>Members</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {households.map((h) => {
            const duplicate = labelCounts[h.label.trim().toLowerCase()] > 1;
            return (
              <tr key={h.id}>
                <td>
                  {editing === h.id ? (
                    <input
                      className={styles.input}
                      value={draft}
                      autoFocus
                      disabled={pending}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && draft.trim()) run(() => renameHousehold(h.id, draft));
                        if (e.key === 'Escape') setEditing(null);
                      }}
                    />
                  ) : (
                    <>
                      <strong>{h.label}</strong>
                      {duplicate && (
                        <span
                          className={styles.warnTag}
                          title="Another household has this exact name — rename one so they can be told apart."
                        >
                          duplicate name
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td>
                  {h.members.length === 0 ? (
                    <em className={styles.muted}>empty</em>
                  ) : (
                    <ul className={styles.memberChips} aria-label={`${h.label} members`}>
                      {h.members.map((m) => (
                        <li key={m.personId} className={styles.memberChip}>
                          <span>{m.name}</span>
                          <button
                            type="button"
                            className={styles.memberChipRemove}
                            disabled={pending}
                            aria-label={`Remove ${m.name} from ${h.label}`}
                            title={`Take ${m.name} out of this household — they stay on the roster`}
                            onClick={() => removeMember(h, m)}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                      <li className={styles.muted}>({h.members.length})</li>
                    </ul>
                  )}
                </td>
                <td className={styles.actionsCell}>
                  {editing === h.id ? (
                    <>
                      <SaveButton
                        className={styles.smallBtn}
                        dirty={draft.trim() !== h.label}
                        pending={pending}
                        blocked={!draft.trim()}
                        blockedReason="A name is required"
                        onClick={() => {
                          feedback.start();
                          run(() => renameHousehold(h.id, draft));
                        }}
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={pending}
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={pending}
                        onClick={() => {
                          setDraft(h.label);
                          setEditing(h.id);
                        }}
                      >
                        Rename
                      </Button>
                      {h.members.length === 0 && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={pending}
                          onClick={() => {
                            if (window.confirm(`Delete the empty household "${h.label}"?`)) {
                              run(() => deleteHousehold(h.id));
                            }
                          }}
                        >
                          Delete
                        </Button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className={styles.hint}>
        Someone joins a household on their own record, under Roster; the × here takes them out of one
        (they stay on the roster). Only households with nobody in them can be deleted.
      </p>
    </div>
  );
}
