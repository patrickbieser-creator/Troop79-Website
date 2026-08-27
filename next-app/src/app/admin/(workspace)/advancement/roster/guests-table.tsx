'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PARTICIPANT_CLASS_LABEL } from '@/lib/participant-class';
import type { GuestTabRow } from '@/lib/guest-people';
import { forgetGuest, promoteGuest } from './guest-actions';
import { searchPeople } from './person-actions';
import { Notice } from '../../_components/notice';
import { Button } from '../../../_components/button';
import styles from './roster.module.css';

/**
 * People → Guests (Plans/Guests-As-People.md Phase 2): every guest a
 * household has brought, with who brought them, their last class and event,
 * a phone for adult guests only, and two actions — Forget (delete when
 * unreferenced, else deactivate) and Merge into… (promotion: the guest
 * became a member; their history moves onto the member record).
 *
 * Forgotten guests are not listed — they are history, not roster.
 */
export function GuestsTable({
  rows,
  openGuestId
}: {
  rows: GuestTabRow[];
  /** ?open=<people.id> from the global roster search — guests have no
   *  editor to open, so the row is highlighted and scrolled to instead. */
  openGuestId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [merging, setMerging] = useState<number | null>(null);
  const [mergeQuery, setMergeQuery] = useState('');
  const [results, setResults] = useState<{ id: number; display_name: string; primary_email: string | null }[]>([]);
  const [searching, startSearch] = useTransition();

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      setError(null);
      setNotice(null);
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? 'Something went wrong.');
        return;
      }
      setNotice(done);
      setMerging(null);
      setMergeQuery('');
      setResults([]);
      router.refresh();
    });

  function search(value: string) {
    setMergeQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    startSearch(async () => setResults(await searchPeople(value)));
  }

  const fmt = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
          new Date(`${iso}T12:00:00Z`)
        )
      : '—';

  const nudges = rows.filter((r) => r.forgetNudge).length;

  useEffect(() => {
    if (!openGuestId) return;
    document.getElementById(`guest-${openGuestId}`)?.scrollIntoView({ block: 'center' });
  }, [openGuestId]);

  return (
    <div>
      {nudges > 0 && (
        <div className={styles.callout}>
          <strong>{nudges} {nudges === 1 ? 'guest has' : 'guests have'} no sign-up in the last 12 months.</strong>{' '}
          Guests are kept so a returning one is the same person across events; one who isn’t coming back can be
          forgotten — a prompt, never automatic.
        </div>
      )}
      {error && <Notice variant="error">{error}</Notice>}
      {notice && <Notice variant="success">{notice}</Notice>}

      {rows.length === 0 ? (
        <p className={styles.muted}>No guests on record. Families add theirs on an event’s sign-up form; leaders on an event’s Roster.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Guest</th>
              <th>Guest of</th>
              <th>Class</th>
              <th>Last event</th>
              <th>Phone</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.personId}
                id={`guest-${r.personId}`}
                className={String(r.personId) === openGuestId ? styles.rowHighlight : undefined}
              >
                <td>
                  {r.name}
                  {r.forgetNudge && <span className={styles.warnTag}>forget?</span>}
                </td>
                <td>{r.hostLabel}</td>
                <td>{r.lastClass ? PARTICIPANT_CLASS_LABEL[r.lastClass] : <span className={styles.muted}>—</span>}</td>
                <td>
                  {r.lastEventTitle ? (
                    <>
                      {r.lastEventTitle}
                      <span className={styles.subText}>{fmt(r.lastEventDate)}</span>
                    </>
                  ) : (
                    <span className={styles.muted}>never signed up</span>
                  )}
                </td>
                <td>{r.phone ?? <span className={styles.muted}>—</span>}</td>
                <td>
                  <div className={styles.inlineRow}>
                    <Button
                      size="sm"
                      disabled={pending}
                      aria-expanded={merging === r.personId}
                      onClick={() => {
                        setMerging(merging === r.personId ? null : r.personId);
                        setMergeQuery('');
                        setResults([]);
                      }}
                    >
                      Merge into…
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Forget ${r.name}?\n\n` +
                              'A guest who never signed up is deleted; one with sign-up history is kept for the records but no longer offered.'
                          )
                        )
                          return;
                        act(() => forgetGuest(r.personId), `${r.name} forgotten.`);
                      }}
                    >
                      Forget
                    </Button>
                  </div>
                  {merging === r.personId && (
                    <div className={styles.pickerBlock}>
                      <span className={styles.fieldLabel}>Merge {r.name} into the member they became…</span>
                      <input
                        className={styles.searchInput}
                        value={mergeQuery}
                        placeholder="Type at least two letters"
                        aria-label={`Member to merge ${r.name} into`}
                        disabled={pending}
                        onChange={(e) => search(e.target.value)}
                      />
                      {searching && <span className={styles.muted}> searching…</span>}
                      {results.length > 0 && (
                        <ul className={styles.results}>
                          {results.map((p) => (
                            <li key={p.id}>
                              <Button
                                size="sm"
                                className={styles.resultRow}
                                disabled={pending}
                                onClick={() => {
                                  if (!window.confirm(`Merge ${r.name} into ${p.display_name}? Their sign-up history moves over and the guest record is retired.`)) return;
                                  act(() => promoteGuest(r.personId, p.id), `${r.name} merged into ${p.display_name}.`);
                                }}
                              >
                                {p.display_name}
                                {p.primary_email && <span className={styles.muted}> · {p.primary_email}</span>}
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
