'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  setEntryFlag,
  cancelEntry,
  restoreEntry,
  claimSlotFor,
  unclaimSlotFor,
  setEntryClass,
  addGuestEntry,
  setEntryTransport
} from '../../events/actions';
import { LEG_LABEL, RIDE_STATUSES, RIDE_STATUS_LABEL, rideCell, type Leg, type RideStatus } from '@/lib/transport';
import {
  PARTICIPANT_CLASSES,
  PARTICIPANT_CLASS_LABEL,
  GUEST_CLASSES,
  isYouthClass,
  type ParticipantClass
} from '@/lib/participant-class';
import { Badge } from '../../_components/badge';
import { recordEventFeePaymentAction, voidEventFeePaymentAction } from '../../finance/actions';
import type { TransactionMethod } from '@/lib/finance';
import { diffClaimEdits, type ClaimEdit } from '@/lib/event-signup-admin';
import type { RosterRow } from './page';
import styles from '../../events/events-admin.module.css';
import { Dialog, DialogHeader, DialogBody, DialogActions } from '../../_components/dialog';
import { SortHeader, useSortable } from '../../_components/use-sortable';

type RosterColKey = 'name' | 'household' | 'status' | 'owed';

/** Module scope on purpose — see the note on useSortable. */
function rosterValue(r: RosterRow, key: RosterColKey): unknown {
  switch (key) {
    case 'name':
      return r.name;
    case 'household':
      return r.household;
    case 'status':
      return r.status;
    case 'owed':
      return r.owed;
  }
}

const PARTICIPATION_LABEL: Record<string, string> = {
  full: 'attending',
  driver_only: 'driver only',
  contributor: 'contributor'
};

/** Roster table with leader-managed slip/payment ticks, a per-row jobs &
 *  commitments editor, and a CSV export. One troop-wide list — no patrol
 *  grouping (see page.tsx).
 *
 *  Layout (Patrick, 2026-08-21): ONE line per name. The old line-2
 *  "kind · participation · +guests" plus notes/answers are gone from the
 *  name cell — participation, guests, answers and notes are their own
 *  columns, and the adult/scout indicator is dropped entirely (a richer
 *  participant classification is coming — Plans/Participant-Classification.md).
 *  The per-row Edit opens the jobs editor because "jobs and commitments
 *  often fluctuate widely between when people sign up and the day of need". */
export function RosterTable({
  rows,
  removedRows,
  signupId,
  calendarEntryId,
  showSlip,
  slots
}: {
  rows: RosterRow[];
  removedRows: RosterRow[];
  signupId: number;
  calendarEntryId: number;
  showSlip: boolean;
  /** Every job on this signup — the editor's checklist. */
  slots: { id: number; label: string }[];
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // Two-click confirm rather than a modal: a stray click shouldn't drop
  // someone from a trip, but a dialog for every removal is heavy.
  const [confirming, setConfirming] = useState<number | null>(null);

  // Marking payment received needs a method + amount, which a bare
  // checkbox can't collect (Plans/Troop-Finances.md Phase 2 event-fee
  // integration) — checking the box opens this dialog instead of writing
  // the flag directly; un-checking voids the linked transaction and needs
  // no prompt.
  const [payingRow, setPayingRow] = useState<RosterRow | null>(null);
  const [payMethod, setPayMethod] = useState<TransactionMethod>('venmo');
  const [payAmountText, setPayAmountText] = useState('');
  const payDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = payDialogRef.current;
    if (!dlg) return;
    if (payingRow && !dlg.open) dlg.showModal();
    if (!payingRow && dlg.open) dlg.close();
  }, [payingRow]);

  // Jobs & commitments editor — one row at a time; the whole claim set is
  // edited locally and diffed on Save (lib/event-signup-admin diffClaimEdits)
  // into the minimal claimSlotFor/unclaimSlotFor calls.
  const [editingRow, setEditingRow] = useState<RosterRow | null>(null);
  const [editClaims, setEditClaims] = useState<Map<number, { checked: boolean; comment: string }>>(new Map());
  const [editClass, setEditClass] = useState<ParticipantClass>('adult');
  const jobsDialogRef = useRef<HTMLDialogElement>(null);

  // Add a guest (Plans/Participant-Classification.md decision 3/4): a NAMED
  // non-roster attendee — Webelos, Cub Scout, Youth Guest, Adult Guest —
  // brought by one of the roster entries. Leaders add here; families add
  // theirs on the public form.
  const [addingGuest, setAddingGuest] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestClass, setGuestClass] = useState<(typeof GUEST_CLASSES)[number]>('webelos');
  const [guestHost, setGuestHost] = useState<number | ''>('');
  const guestDialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dlg = guestDialogRef.current;
    if (!dlg) return;
    if (addingGuest && !dlg.open) dlg.showModal();
    if (!addingGuest && dlg.open) dlg.close();
  }, [addingGuest]);
  function openAddGuest() {
    setGuestName('');
    setGuestClass('webelos');
    setGuestHost(rows.find((r) => r.hostEntryId === null)?.id ?? '');
    setAddingGuest(true);
  }
  function saveGuest() {
    if (!guestName.trim() || guestHost === '') return;
    start(async () => {
      setError(null);
      const res = await addGuestEntry(signupId, calendarEntryId, Number(guestHost), guestName, guestClass);
      if (!res.ok) {
        setError(res.error ?? 'Could not add the guest.');
        return;
      }
      setAddingGuest(false);
      router.refresh();
    });
  }

  useEffect(() => {
    const dlg = jobsDialogRef.current;
    if (!dlg) return;
    if (editingRow && !dlg.open) dlg.showModal();
    if (!editingRow && dlg.open) dlg.close();
  }, [editingRow]);

  // Transport (Plans/Event-Logistics.md §A): legs driven, seats INCLUDING the
  // driver, and a ride status for the legs not driven.
  const [editTransport, setEditTransport] = useState({
    drivesOut: false,
    drivesBack: false,
    seatsOut: 4,
    seatsBack: 4,
    rideOut: 'needs_ride' as RideStatus,
    rideBack: 'needs_ride' as RideStatus
  });

  function openJobsEditor(r: RosterRow) {
    const byId = new Map(r.claimDetails.map((c) => [c.slotId, c.comment ?? '']));
    setEditClaims(
      new Map(slots.map((sl) => [sl.id, { checked: byId.has(sl.id), comment: byId.get(sl.id) ?? '' }]))
    );
    setEditClass(r.participantClass);
    setEditTransport({
      drivesOut: r.drivesOut,
      drivesBack: r.drivesBack,
      seatsOut: r.vehicleSeatsOut ?? r.vehicleSeatsBack ?? 4,
      seatsBack: r.vehicleSeatsBack ?? r.vehicleSeatsOut ?? 4,
      rideOut: r.rideOut ?? 'needs_ride',
      rideBack: r.rideBack ?? 'needs_ride'
    });
    setEditingRow(r);
  }

  function transportChanged(r: RosterRow) {
    const t = editTransport;
    return (
      t.drivesOut !== r.drivesOut ||
      t.drivesBack !== r.drivesBack ||
      (t.drivesOut && t.seatsOut !== r.vehicleSeatsOut) ||
      (t.drivesBack && t.seatsBack !== r.vehicleSeatsBack) ||
      (!t.drivesOut && t.rideOut !== (r.rideOut ?? 'needs_ride')) ||
      (!t.drivesBack && t.rideBack !== (r.rideBack ?? 'needs_ride'))
    );
  }

  function saveJobs() {
    if (!editingRow) return;
    const row = editingRow;
    const after: ClaimEdit[] = [...editClaims.entries()]
      .filter(([, v]) => v.checked)
      .map(([slotId, v]) => ({ slotId, comment: v.comment.trim() || null }));
    const diff = diffClaimEdits(row.claimDetails, after);
    start(async () => {
      setError(null);
      try {
        if (transportChanged(row)) {
          const t = editTransport;
          const res = await setEntryTransport(
            row.id,
            {
              drivesOut: t.drivesOut,
              drivesBack: t.drivesBack,
              vehicleSeatsOut: t.drivesOut ? t.seatsOut : null,
              vehicleSeatsBack: t.drivesBack ? t.seatsBack : null,
              rideOut: t.drivesOut ? null : t.rideOut,
              rideBack: t.drivesBack ? null : t.rideBack
            },
            signupId,
            calendarEntryId
          );
          if (!res.ok) {
            setError(res.error ?? 'Could not save transportation.');
            return;
          }
        }
        if (editClass !== row.participantClass) {
          const res = await setEntryClass(row.id, editClass, signupId, calendarEntryId);
          if (!res.ok) {
            setError(res.error ?? 'Could not save the class.');
            return;
          }
        }
        for (const c of diff.upsert) {
          const res = await claimSlotFor(c.slotId, row.id, signupId, calendarEntryId, c.comment);
          if (!res.ok) {
            setError(res.error ?? 'Could not save jobs.');
            return;
          }
        }
        for (const slotId of diff.remove) {
          const res = await unclaimSlotFor(slotId, row.id, signupId, calendarEntryId);
          if (!res.ok) {
            setError(res.error ?? 'Could not save jobs.');
            return;
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save jobs.');
        return;
      }
      setEditingRow(null);
      router.refresh();
    });
  }

  function openPayDialog(r: RosterRow) {
    setPayMethod('venmo');
    setPayAmountText(String(r.owed));
    setPayingRow(r);
  }

  function confirmPayment() {
    if (!payingRow) return;
    const amount = Number(payAmountText);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const row = payingRow;
    start(async () => {
      setError(null);
      try {
        // requireAnyOf() throws (rather than returning ok:false) when the
        // actor lacks calendar.write/finance.manage entirely — a leader
        // without either capability shouldn't see this button, but the
        // server action re-checks regardless, and a bare throw here would
        // otherwise surface as an unhandled rejection instead of the same
        // friendly error banner every other failure uses.
        const res = await recordEventFeePaymentAction({
          signupEntryId: row.id,
          amount,
          method: payMethod,
          signupId
        });
        if (!res.ok) setError(res.error ?? 'Could not record payment.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not record payment.');
      }
      setPayingRow(null);
      router.refresh();
    });
  }

  function unmarkPayment(r: RosterRow) {
    start(async () => {
      setError(null);
      try {
        const res = await voidEventFeePaymentAction(r.id, signupId);
        if (!res.ok) setError(res.error ?? 'Could not undo payment.');
        else router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not undo payment.');
      }
    });
  }

  const defaultOrder = [...rows].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)
  );
  // null initial key: the adults-then-scouts… (kind → name) compound grouping
  // above IS the default; column sorting starts only when a header is clicked.
  const { sorted, sortKey, sortDir, toggle: toggleSort } = useSortable<RosterRow, RosterColKey>(
    defaultOrder,
    rosterValue,
    null
  );

  const exportCsv = () => {
    const head = [
      'Type', 'Name', 'Household', 'Status', 'Participation', 'Tier', 'Days',
      'Owed', 'Guests', 'Guest note',
      'Drives there (seats incl. driver)', 'Drives back (seats incl. driver)', 'Ride there', 'Ride back',
      'Slip', 'Paid', 'Jobs', 'Answers', 'Notes'
    ];
    const body = sorted.map((r) => [
      PARTICIPANT_CLASS_LABEL[r.participantClass], r.name, r.household, r.status, r.participation, r.tierLabel ?? '',
      r.days ?? '', r.owed, r.guests, r.guestNote ?? '',
      r.drivesOut ? (r.vehicleSeatsOut ?? '') : '', r.drivesBack ? (r.vehicleSeatsBack ?? '') : '',
      rideCell(r, 'out', r.carOut), rideCell(r, 'back', r.carBack),
      r.slipReceived ? 'Y' : 'N', r.paymentReceived ? 'Y' : 'N',
      r.claimsDisplay.join(' | '), r.answers.join(' | '), r.notes ?? ''
    ]);
    const csv = [head, ...body]
      .map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `event-roster-${signupId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggle = (r: RosterRow, field: 'permission_slip_received' | 'payment_received', v: boolean) =>
    start(async () => {
      setError(null);
      const res = await setEntryFlag(r.id, field, v, signupId, calendarEntryId);
      if (!res.ok) setError(res.error ?? 'Could not save.');
      else router.refresh();
    });

  const colCount = 14 + (showSlip ? 1 : 0);

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h2>Everyone signed up ({rows.length})</h2>
        <div>
          <button type="button" className={styles.enableBtn} onClick={openAddGuest} disabled={pending || rows.length === 0}>
            Add a guest
          </button>{' '}
          <button type="button" className={styles.enableBtn} onClick={() => window.print()}>
            Print
          </button>{' '}
          <button type="button" className={styles.enableBtn} onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>
      {error && <p className={styles.err}>{error}</p>}

      <table className={styles.table}>
        <thead>
          <tr>
            <SortHeader label="Name" colKey="name" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
            <th scope="col">Class</th>
            <SortHeader label="Household" colKey="household" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
            <SortHeader label="Status" colKey="status" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
            <th scope="col">Participation</th>
            <th scope="col">Guests</th>
            <SortHeader label="Owed" colKey="owed" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
            <th scope="col">Driving</th>
            <th scope="col">Ride</th>
            <th scope="col">Jobs</th>
            <th scope="col">Answers</th>
            <th scope="col">Notes</th>
            {showSlip && <th scope="col">Slip</th>}
            <th scope="col">Paid</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} className={r.status === 'waitlist' ? styles.waitRow : undefined}>
              <td className={styles.nowrap}>
                <span className={styles.evTitle}>{r.name}</span>
              </td>
              <td className={styles.nowrap}>
                <Badge variant={isYouthClass(r.participantClass) ? 'info' : 'neutral'}>
                  {PARTICIPANT_CLASS_LABEL[r.participantClass]}
                </Badge>
                {r.hostEntryId !== null && (
                  <span className={styles.guestOf}>
                    guest of {rows.find((h) => h.id === r.hostEntryId)?.name ?? '—'}
                  </span>
                )}
              </td>
              <td>{r.household}</td>
              <td className={styles.nowrap}>
                {r.status === 'waitlist' ? <strong>Waitlist</strong> : r.status}
              </td>
              <td className={`${styles.nowrap} ${styles.cellMuted}`}>
                {PARTICIPATION_LABEL[r.participation] ?? r.participation}
              </td>
              <td className={styles.nowrap}>
                {r.guests > 0 ? `+${r.guests}${r.guestNote ? ` (${r.guestNote})` : ''}` : '—'}
              </td>
              <td className={styles.nowrap}>
                {r.owed > 0 ? `$${r.owed}` : '—'}
                {r.days ? <span className={styles.evCat}>{r.days} days</span> : null}
              </td>
              <td className={styles.nowrap}>
                {r.drivesOut || r.drivesBack
                  ? [
                      r.drivesOut && `there · ${r.vehicleSeatsOut} seats`,
                      r.drivesBack && `back · ${r.vehicleSeatsBack} seats`
                    ]
                      .filter(Boolean)
                      .join(' / ')
                  : '—'}
              </td>
              <td className={`${styles.nowrap} ${styles.cellMuted}`}>
                {r.status === 'yes' && r.participation !== 'contributor'
                  ? (['out', 'back'] as Leg[])
                      .filter((leg) => !(leg === 'out' ? r.drivesOut : r.drivesBack))
                      .map((leg) => `${LEG_LABEL[leg].toLowerCase()}: ${rideCell(r, leg, leg === 'out' ? r.carOut : r.carBack)}`)
                      .join(' · ') || '—'
                  : '—'}
              </td>
              <td>{r.claimsDisplay.join(', ') || '—'}</td>
              <td className={styles.cellMuted}>{r.answers.join(' · ') || '—'}</td>
              <td className={styles.cellMuted}>{r.notes || '—'}</td>
              {showSlip && (
                <td>
                  <input
                    type="checkbox"
                    checked={r.slipReceived}
                    disabled={pending || !isYouthClass(r.participantClass)}
                    aria-label={`Permission slip received — ${r.name}`}
                    onChange={(e) => toggle(r, 'permission_slip_received', e.target.checked)}
                  />
                </td>
              )}
              <td>
                <input
                  type="checkbox"
                  checked={r.paymentReceived}
                  disabled={pending || r.owed === 0}
                  aria-label={`Payment received — ${r.name}`}
                  onChange={(e) => (e.target.checked ? openPayDialog(r) : unmarkPayment(r))}
                />
              </td>
              <td className={styles.nowrap}>
                <button
                  type="button"
                  className={styles.rowEdit}
                  disabled={pending}
                  aria-label={`Edit jobs and commitments — ${r.name}`}
                  onClick={() => openJobsEditor(r)}
                >
                  Edit
                </button>{' '}
                {confirming === r.id ? (
                  <>
                    <button
                      type="button"
                      className={styles.rowDel}
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          setError(null);
                          const res = await cancelEntry(r.id, signupId, calendarEntryId);
                          if (!res.ok) setError(res.error ?? 'Could not remove.');
                          setConfirming(null);
                          router.refresh();
                        })
                      }
                    >
                      Confirm
                    </button>{' '}
                    <button
                      type="button"
                      className={styles.rowEdit}
                      onClick={() => setConfirming(null)}
                    >
                      Keep
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={styles.rowDel}
                    disabled={pending}
                    onClick={() => setConfirming(r.id)}
                  >
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={colCount} className={styles.empty}>
                Nobody has signed up yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {removedRows.length > 0 && (
        <div className={styles.removedBlock}>
          <p className={styles.panelHint}>
            <strong>Removed ({removedRows.length}).</strong> Their spots are already back in the
            pool — restore anyone taken off by mistake.
          </p>
          <ul className={styles.coverList}>
            {removedRows.map((r) => (
              <li key={r.id}>
                <span>
                  {r.name} <span className={styles.evCat}>{r.household}</span>
                </span>
                <button
                  type="button"
                  className={styles.rowEdit}
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      setError(null);
                      const res = await restoreEntry(r.id, signupId, calendarEntryId);
                      if (!res.ok) setError(res.error ?? 'Could not restore.');
                      router.refresh();
                    })
                  }
                >
                  Put back
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog ref={jobsDialogRef} onClose={() => setEditingRow(null)}>
        {editingRow && (
          <>
            <DialogHeader title={`Edit — ${editingRow.name}`} />
            <DialogBody>
              <label className={`adminLabel ${styles.payField}`}>
                Class
                <select
                  value={editClass}
                  onChange={(e) => setEditClass(e.target.value as ParticipantClass)}
                  aria-label="Class"
                >
                  {PARTICIPANT_CLASSES.map((c) => (
                    <option key={c} value={c}>
                      {PARTICIPANT_CLASS_LABEL[c]}
                    </option>
                  ))}
                </select>
              </label>
              {editingRow.participation !== 'contributor' && editingRow.status !== 'cancelled' && (
                <>
                  <p className={`adminLabel ${styles.jobsHeading}`}>Transportation</p>
                  <ul className={styles.jobsList}>
                    {(['out', 'back'] as Leg[]).map((leg) => {
                      const drives = leg === 'out' ? editTransport.drivesOut : editTransport.drivesBack;
                      const seats = leg === 'out' ? editTransport.seatsOut : editTransport.seatsBack;
                      const ride = leg === 'out' ? editTransport.rideOut : editTransport.rideBack;
                      return (
                        <li key={leg}>
                          <label>
                            <input
                              type="checkbox"
                              checked={drives}
                              disabled={editingRow.kind !== 'adult'}
                              onChange={(e) =>
                                setEditTransport((t) => ({
                                  ...t,
                                  [leg === 'out' ? 'drivesOut' : 'drivesBack']: e.target.checked
                                }))
                              }
                            />
                            Drives {LEG_LABEL[leg].toLowerCase()}
                          </label>
                          {drives ? (
                            <input
                              type="number"
                              min={1}
                              max={15}
                              aria-label={`Seats ${LEG_LABEL[leg].toLowerCase()}, including the driver`}
                              value={seats}
                              onChange={(e) =>
                                setEditTransport((t) => ({
                                  ...t,
                                  [leg === 'out' ? 'seatsOut' : 'seatsBack']: Math.max(1, Number(e.target.value) || 1)
                                }))
                              }
                            />
                          ) : (
                            <select
                              aria-label={`Ride ${LEG_LABEL[leg].toLowerCase()}`}
                              value={ride}
                              onChange={(e) =>
                                setEditTransport((t) => ({
                                  ...t,
                                  [leg === 'out' ? 'rideOut' : 'rideBack']: e.target.value as RideStatus
                                }))
                              }
                            >
                              {RIDE_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {RIDE_STATUS_LABEL[s]}
                                </option>
                              ))}
                            </select>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <p className={styles.jobsEmpty}>Seat counts include the driver. Placing riders in cars happens on Rides &amp; assignments.</p>
                </>
              )}
              <p className={`adminLabel ${styles.jobsHeading}`}>Jobs &amp; commitments</p>
              {slots.length === 0 ? (
                <p className={styles.jobsEmpty}>This signup has no jobs defined yet — add them in the Builder.</p>
              ) : (
                <ul className={styles.jobsList}>
                  {slots.map((sl) => {
                    const st = editClaims.get(sl.id) ?? { checked: false, comment: '' };
                    return (
                      <li key={sl.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={st.checked}
                            onChange={(e) =>
                              setEditClaims((prev) => {
                                const next = new Map(prev);
                                next.set(sl.id, { ...st, checked: e.target.checked });
                                return next;
                              })
                            }
                          />
                          {sl.label}
                        </label>
                        {st.checked && (
                          <input
                            type="text"
                            placeholder="Note (optional) — e.g. Sat dinner, bringing two"
                            aria-label={`Note for ${sl.label}`}
                            value={st.comment}
                            onChange={(e) =>
                              setEditClaims((prev) => {
                                const next = new Map(prev);
                                next.set(sl.id, { ...st, comment: e.target.value });
                                return next;
                              })
                            }
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </DialogBody>
            <DialogActions>
              <button type="button" className={styles.rowEdit} onClick={() => setEditingRow(null)} disabled={pending}>
                Cancel
              </button>
              <button type="button" className={styles.enableBtn} disabled={pending} onClick={saveJobs}>
                {pending ? 'Saving…' : 'Save'}
              </button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <Dialog ref={guestDialogRef} onClose={() => setAddingGuest(false)}>
        {addingGuest && (
          <>
            <DialogHeader title="Add a guest" />
            <DialogBody>
              <label className={`adminLabel ${styles.payField}`}>
                Guest name
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  aria-label="Guest name"
                  placeholder="e.g. Sam Lee"
                  autoFocus
                />
              </label>
              <label className={`adminLabel ${styles.payField}`}>
                Guest class
                <select
                  value={guestClass}
                  onChange={(e) => setGuestClass(e.target.value as (typeof GUEST_CLASSES)[number])}
                  aria-label="Guest class"
                >
                  {GUEST_CLASSES.map((c) => (
                    <option key={c} value={c}>
                      {PARTICIPANT_CLASS_LABEL[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`adminLabel ${styles.payField}`}>
                Brought by
                <select
                  value={guestHost}
                  onChange={(e) => setGuestHost(e.target.value ? Number(e.target.value) : '')}
                  aria-label="Brought by"
                >
                  <option value="">Select who is bringing them…</option>
                  {rows
                    .filter((r) => r.hostEntryId === null)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
            </DialogBody>
            <DialogActions>
              <button type="button" className={styles.rowEdit} onClick={() => setAddingGuest(false)} disabled={pending}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.enableBtn}
                disabled={pending || !guestName.trim() || guestHost === ''}
                onClick={saveGuest}
              >
                {pending ? 'Adding…' : 'Add guest'}
              </button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <Dialog ref={payDialogRef} onClose={() => setPayingRow(null)}>
        {payingRow && (
          <>
            <DialogHeader title={`Record payment — ${payingRow.name}`} />
            <DialogBody>
              <label className={`adminLabel ${styles.payField}`}>
                Method
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as TransactionMethod)}>
                  <option value="venmo">Venmo</option>
                  <option value="check">Check</option>
                  <option value="cash">Cash</option>
                  <option value="scout_account">Scout account balance</option>
                  <option value="bank">Bank transfer</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className={`adminLabel ${styles.payField}`}>
                Amount
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={payAmountText}
                  onChange={(e) => setPayAmountText(e.target.value)}
                />
              </label>
            </DialogBody>
            <DialogActions>
              <button type="button" className={styles.rowEdit} onClick={() => setPayingRow(null)}>
                Cancel
              </button>
              <button type="button" className={styles.enableBtn} disabled={pending} onClick={confirmPayment}>
                Record payment
              </button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </section>
  );
}
