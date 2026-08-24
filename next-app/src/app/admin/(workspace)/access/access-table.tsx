'use client';

import { useState, useTransition } from 'react';
import { CAPABILITIES, CAPABILITY_LABEL, BUNDLES, type Capability } from '@/lib/capabilities';
import type { GrantRow } from '@/lib/capabilities-admin';
import styles from './access.module.css';
import { fmtDate } from '@/lib/format-date';

/** Short column headers — the full label is the cell's accessible name. */
const SHORT: Record<Capability, string> = {
  'advancement.write': 'Advance',
  'roster.manage': 'Roster',
  'calendar.write': 'Calendar',
  'news.write': 'News',
  'meeting_plan.use': 'Mtg Plan',
  'library.moderate': 'Library',
  'library.proxy_view': 'Proxy',
  'finance.manage': 'Finance',
  'finance.view': 'Fin. View'
};

export interface AccessTableProps {
  rows: GrantRow[];
  addable: { personId: number; name: string; isActiveScout: boolean }[];
  grantAction: (formData: FormData) => Promise<void>;
  revokeAction: (formData: FormData) => Promise<void>;
  applyBundleAction: (formData: FormData) => Promise<void>;
  revokeAllAction: (formData: FormData) => Promise<void>;
  revokeSessionsAction: (formData: FormData) => Promise<void>;
}

export function AccessTable({
  rows,
  addable,
  grantAction,
  revokeAction,
  applyBundleAction,
  revokeAllAction,
  revokeSessionsAction
}: AccessTableProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [bundleByPerson, setBundleByPerson] = useState<Record<number, string>>({});
  const [addPersonId, setAddPersonId] = useState('');

  function run(action: (fd: FormData) => Promise<void>, fields: Record<string, string | number>) {
    setError(null);
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
    startTransition(async () => {
      try {
        await action(fd);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      }
    });
  }

  function toggle(row: GrantRow, capability: Capability) {
    const held = row.capabilities.includes(capability);
    run(held ? revokeAction : grantAction, { personId: row.personId, capability });
  }

  return (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Person</th>
              {CAPABILITIES.map((cap) => (
                <th key={cap} scope="col" className={styles.capCol} title={CAPABILITY_LABEL[cap]}>
                  {SHORT[cap]}
                </th>
              ))}
              <th scope="col">Bundle</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.personId}>
                <th scope="row" className={styles.person}>
                  {row.name}
                  {row.isActiveScout ? <span className={styles.youthTag}>youth</span> : null}
                  {row.leaderCode ? <span className={styles.personMeta}>{row.leaderCode}</span> : null}
                </th>

                {CAPABILITIES.map((cap) => {
                  const held = row.capabilities.includes(cap);
                  const grantedBy = row.grantedBy[cap];
                  return (
                    <td key={cap} className={styles.capCell}>
                      <button
                        type="button"
                        className={`${styles.toggle} ${held ? styles.toggleOn : ''}`}
                        disabled={pending}
                        aria-pressed={held}
                        // The accessible name has to carry person + capability:
                        // a grid of bare checkmarks is unusable by screen reader
                        // and untestable by role+name.
                        aria-label={`${CAPABILITY_LABEL[cap]} — ${row.name}`}
                        title={
                          held && grantedBy
                            ? `Granted by ${grantedBy}${row.grantedAt[cap] ? ` on ${fmtDate(row.grantedAt[cap])}` : ''}`
                            : CAPABILITY_LABEL[cap]
                        }
                        onClick={() => toggle(row, cap)}
                      >
                        {held ? '✓' : ''}
                      </button>
                    </td>
                  );
                })}

                <td>
                  <div className={styles.rowActions}>
                    <select
                      className={styles.select}
                      aria-label={`Bundle for ${row.name}`}
                      value={bundleByPerson[row.personId] ?? ''}
                      onChange={(e) =>
                        setBundleByPerson((prev) => ({ ...prev, [row.personId]: e.target.value }))
                      }
                    >
                      <option value="">Apply bundle…</option>
                      {Object.entries(BUNDLES).map(([key, b]) => (
                        <option key={key} value={key}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={styles.smallBtn}
                      disabled={pending || !bundleByPerson[row.personId]}
                      onClick={() =>
                        run(applyBundleAction, {
                          personId: row.personId,
                          bundle: bundleByPerson[row.personId] ?? ''
                        })
                      }
                    >
                      Apply
                    </button>
                  </div>
                </td>

                <td>
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.smallBtn}
                      disabled={pending || row.capabilities.length === 0}
                      onClick={() => run(revokeAllAction, { personId: row.personId })}
                    >
                      Clear grants
                    </button>
                    <button
                      type="button"
                      className={`${styles.smallBtn} ${styles.dangerBtn}`}
                      disabled={pending}
                      title="Bumps session_epoch — signs this person out of every device"
                      onClick={() => run(revokeSessionsAction, { personId: row.personId })}
                    >
                      Revoke sessions
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.addRow}>
        <h2>Grant access to someone else</h2>
        <p>
          Anyone on the roster can be given a capability — an older scout serving as SPL might hold
          only &ldquo;Generate meeting plans&rdquo;.
        </p>
        <select
          className={styles.select}
          aria-label="Person to grant access to"
          value={addPersonId}
          onChange={(e) => setAddPersonId(e.target.value)}
        >
          <option value="">Choose a person…</option>
          {addable.map((p) => (
            <option key={p.personId} value={p.personId}>
              {p.name}
              {p.isActiveScout ? ' (youth)' : ''}
            </option>
          ))}
        </select>
        <select className={styles.select} aria-label="Capability to grant" id="add-capability" defaultValue="">
          <option value="">Choose a capability…</option>
          {CAPABILITIES.map((cap) => (
            <option key={cap} value={cap}>
              {CAPABILITY_LABEL[cap]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={styles.smallBtn}
          disabled={pending || !addPersonId}
          onClick={() => {
            const sel = document.getElementById('add-capability') as HTMLSelectElement | null;
            if (!sel?.value) {
              setError('Choose a capability to grant.');
              return;
            }
            run(grantAction, { personId: addPersonId, capability: sel.value });
            setAddPersonId('');
            sel.value = '';
          }}
        >
          Grant
        </button>
      </div>
    </>
  );
}
