'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { ageOn, yptStatus } from '@/lib/demographics';
import { deleteLeader } from '../lookups/actions';
import { LeaderForm, type LeaderRow } from './leader-form';
import type { ScoutRow } from './scout-form';
import { SortHeader, useSortable } from './use-sortable';
import styles from './roster.module.css';

/*
 * Adults on the roster — and, since v1.12, where they're managed. Add/edit
 * moved here from Lookups & Admin alongside scouts, so the whole "who is in
 * this troop" job lives on one screen.
 *
 * There is no active/inactive tab here: `leaders` has no active flag. An adult
 * leaves the roster by being deleted, or stops counting as an adult by being
 * linked to a currently-active scout (youth leader initials) — see page.tsx.
 */

type ColKey = 'name' | 'code' | 'role' | 'age' | 'ypt' | 'bsa' | 'health' | 'contact';

/** today carried on the row so the comparator can stay at module scope. */
type SortableAdult = LeaderRow & { _today: string };

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${iso}T12:00:00Z`));
}

/** Module scope — see the note on useSortable. */
function adultValue(l: SortableAdult, key: ColKey): unknown {
  switch (key) {
    case 'name':
      return l.name;
    case 'code':
      return l.code;
    case 'role':
      return l.role;
    case 'age':
      return ageOn(l.birthdate, l._today);
    case 'ypt':
      // Sort by the date it runs out, so the most urgent surface together.
      // "Not on file" has no date and falls to the bottom via the null rule.
      return l.ypt_completed ? yptStatus(l.ypt_completed, l._today).expires : null;
    case 'bsa':
      return l.bsa_member_id;
    case 'health':
      return l.health_form_date;
    case 'contact':
      return l.email || l.phone;
    default:
      return null;
  }
}

interface Props {
  adults: LeaderRow[];
  scouts: Pick<ScoutRow, 'id' | 'display_name'>[];
  today: string;
}

export function AdultsTable({ adults, scouts, today }: Props) {
  const [openFor, setOpenFor] = useState<LeaderRow | 'new' | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<{ code: string; msg: string } | null>(null);
  const [, startTransition] = useTransition();

  /* Delete came across from the old Lookups card. The database refuses when
     ledger rows still reference the signer, so the confirm text says so
     rather than letting the failure arrive as a surprise. */
  function onDelete(code: string) {
    if (
      !window.confirm(
        `Delete leader "${code}"? Only allowed when no ledger rows reference this signer.`
      )
    ) {
      return;
    }
    setBusyCode(code);
    setRowErr(null);
    const fd = new FormData();
    fd.set('code', code);
    startTransition(async () => {
      const res = await deleteLeader(fd);
      setBusyCode(null);
      if (!res.ok) setRowErr({ code, msg: res.error ?? 'Delete failed' });
    });
  }

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (openFor && !dlg.open) dlg.showModal();
    if (!openFor && dlg.open) dlg.close();
  }, [openFor]);

  const decorated = useMemo(() => adults.map((l) => ({ ...l, _today: today })), [adults, today]);
  const { sorted, sortKey, sortDir, toggle } = useSortable<SortableAdult, ColKey>(
    decorated,
    adultValue,
    'name'
  );

  const head = (label: string, colKey: ColKey) => (
    <SortHeader label={label} colKey={colKey} sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
  );

  return (
    <>
      <div className={styles.tableToolbar}>
        <span className={styles.muted}>{adults.length} adults</span>
        <button type="button" className={styles.addBtn} onClick={() => setOpenFor('new')}>
          + Add Adult
        </button>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            {head('Name', 'name')}
            {head('Initials', 'code')}
            {head('Role', 'role')}
            {head('Age', 'age')}
            {head('YPT', 'ypt')}
            {head('BSA ID', 'bsa')}
            {head('Health Form', 'health')}
            {head('Contact', 'contact')}
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((l) => {
            const ypt = yptStatus(l.ypt_completed, today);
            const dash = <span className={styles.muted}>—</span>;
            return (
              <tr key={l.code}>
                <td>
                  <button
                    type="button"
                    className={styles.nameBtn}
                    onClick={() => setOpenFor(l)}
                    title="Edit this adult"
                  >
                    {l.name}
                  </button>
                </td>
                <td className={styles.mono}>{l.code}</td>
                <td>{l.role ?? dash}</td>
                <td>{ageOn(l.birthdate, today) ?? dash}</td>
                <td>
                  {ypt.status === 'current' && (
                    <span className={`${styles.badge} ${styles.badgeOk}`}>
                      thru {fmtDate(ypt.expires)}
                    </span>
                  )}
                  {ypt.status === 'expiring' && (
                    <span className={`${styles.badge} ${styles.badgeWarn}`}>
                      expires {fmtDate(ypt.expires)}
                    </span>
                  )}
                  {ypt.status === 'expired' && (
                    <span className={`${styles.badge} ${styles.badgeBad}`}>
                      expired {fmtDate(ypt.expires)}
                    </span>
                  )}
                  {ypt.status === 'missing' && (
                    <span className={`${styles.badge} ${styles.badgeMuted}`}>not on file</span>
                  )}
                </td>
                <td className={styles.mono}>{l.bsa_member_id ?? '—'}</td>
                <td>{l.health_form_date ? fmtDate(l.health_form_date) : dash}</td>
                <td>{[l.phone, l.email].filter(Boolean).join(' · ') || dash}</td>
                <td style={{ textAlign: 'right' }}>
                  <button type="button" className={styles.editBtn} onClick={() => setOpenFor(l)}>
                    Edit
                  </button>{' '}
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    onClick={() => onDelete(l.code)}
                    disabled={busyCode === l.code}
                  >
                    {busyCode === l.code ? '…' : 'Delete'}
                  </button>
                  {rowErr?.code === l.code && (
                    <span className={styles.rowErr}>{rowErr.msg}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <dialog
        ref={dialogRef}
        className={styles.editDialog}
        onClose={() => setOpenFor(null)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setOpenFor(null);
        }}
      >
        {openFor && (
          <LeaderForm
            row={openFor === 'new' ? null : openFor}
            scouts={scouts}
            onClose={() => setOpenFor(null)}
          />
        )}
      </dialog>
    </>
  );
}
