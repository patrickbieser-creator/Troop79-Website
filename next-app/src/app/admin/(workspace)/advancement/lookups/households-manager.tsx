'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createHousehold, renameHousehold, deleteHousehold } from './household-actions';
import styles from './lookups.module.css';

export interface HouseholdRow {
  id: number;
  label: string;
  members: string[];
}

/**
 * The households themselves — not who is in them, which is edited on each
 * person.
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

  const labelCounts = households.reduce<Record<string, number>>((acc, h) => {
    const k = h.label.trim().toLowerCase();
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? 'Something went wrong.');
      else {
        setEditing(null);
        router.refresh();
      }
    });
  }

  return (
    <div>
      {error && <div className={styles.rowError}>{error}</div>}

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
                    <>
                      {h.members.join(', ')}
                      <span className={styles.muted}> ({h.members.length})</span>
                    </>
                  )}
                </td>
                <td className={styles.actionsCell}>
                  {editing === h.id ? (
                    <>
                      <button
                        className={styles.smallBtn}
                        disabled={pending || !draft.trim()}
                        onClick={() => run(() => renameHousehold(h.id, draft))}
                      >
                        Save
                      </button>
                      <button
                        className={styles.smallBtn}
                        disabled={pending}
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className={styles.smallBtn}
                        disabled={pending}
                        onClick={() => {
                          setDraft(h.label);
                          setEditing(h.id);
                        }}
                      >
                        Rename
                      </button>
                      {h.members.length === 0 && (
                        <button
                          className={styles.smallBtn}
                          disabled={pending}
                          onClick={() => {
                            if (window.confirm(`Delete the empty household "${h.label}"?`)) {
                              run(() => deleteHousehold(h.id));
                            }
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

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
        <button
          className={styles.smallBtn}
          disabled={pending || !newLabel.trim()}
          onClick={() => {
            run(() => createHousehold(newLabel));
            setNewLabel('');
          }}
        >
          + Add household
        </button>
      </div>
      <p className={styles.hint}>
        Who belongs to a household is set on each person, under Roster. Only households with nobody
        in them can be deleted.
      </p>
    </div>
  );
}
