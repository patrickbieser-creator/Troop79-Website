'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  cancelEntry,
  restoreEntry,
  deleteEntryPermanently,
  claimSlotFor,
  unclaimSlotFor,
  setEntryClass,
  addGuestEntry,
  loadGuestsForHost,
  setEntryTransport,
  setLeaderAnswer
} from '../../events/actions';
import {
  healthFormLikelyCurrent,
  isCheckboxColumn,
  leaderColumnHeader,
  printableLeaderQuestions,
  LEADER_PRESETS,
  type LeaderQuestion
} from '@/lib/leader-columns';
import { LEG_LABEL, RIDE_STATUSES, RIDE_STATUS_LABEL, rideCell, rideShort, type Leg, type RideStatus } from '@/lib/transport';
import {
  PARTICIPANT_CLASSES,
  PARTICIPANT_CLASS_LABEL,
  GUEST_CLASSES,
  isYouthClass,
  type ParticipantClass
} from '@/lib/participant-class';
import { Badge } from '../../_components/badge';
import { TabStrip } from '../../_components/tab-strip';
import { SearchField, useTableSearch } from '../../_components/search-field';
import { ClassPill } from '../../events/class-pill';
import { getScoutAccountBalanceForEntryAction, recordEventFeePaymentAction } from '../../finance/actions';
import { PayGuard, wouldGoNegative, type AccountFacts } from '../../events/pay-guard';
import { PAY_METHOD_LABEL, type PayMethod } from '@/lib/event-money';
import { fmtDate } from '@/lib/format-date';
import { diffClaimEdits, type ClaimEdit } from '@/lib/event-signup-admin';
import { jobCoverage, jobWhen, resolveJobCodes } from '@/lib/job-codes';
import { AddPerson, type AddCandidate } from './add-person';
import type { RosterRow } from './page';
import type { GuestMode } from '@/lib/guest-mode';
import type { HouseholdGuest } from '@/lib/guest-payload';
import styles from '../../events/events-admin.module.css';
import { Dialog, DialogHeader, DialogBody, DialogActions } from '../../_components/dialog';
import { SaveButton, SaveFeedback, useSavePhase } from '../../_components/save-state';
import { SortHeader, useSortable, type SortDir } from '../../_components/use-sortable';
import sortStyles from '../../_components/use-sortable.module.css';
import { Button } from '../../../_components/button';

/** Sortable columns (Patrick, 2026-08-22: name, class, participation, ride
 *  to/from, and every group-set column — `set:<id>`). */
type RosterColKey = 'name' | 'owed' | 'class' | 'participation' | 'rideOut' | 'rideBack' | `set:${number}`;

/** Name search (Jenna, 2026-08-25): name, household, class, notes — what a leader scans the grid for. */
const rosterSearchFields = (r: RosterRow) => [r.name, r.household, PARTICIPANT_CLASS_LABEL[r.participantClass], r.notes];

/** Module scope on purpose — see the note on useSortable. */
function rosterValue(r: RosterRow, key: RosterColKey): unknown {
  switch (key) {
    case 'name':
      return r.name;
    case 'owed':
      return r.owed;
    case 'class':
      return PARTICIPANT_CLASS_LABEL[r.participantClass];
    case 'participation':
      return PARTICIPATION_LABEL[r.participation] ?? r.participation;
    case 'rideOut':
      return rideShort(r, 'out', r.carOut, r.name) || null; // blank (needs a ride) sorts last
    case 'rideBack':
      return rideShort(r, 'back', r.carBack, r.name) || null;
    default:
      return r.groupBySet[Number(key.slice(4))] ?? null;
  }
}

/** The Other-responses tab's status word (Plans/Roster-Status-Tab.md item 1). */
const OTHER_STATUS: Record<string, { label: string; variant: 'warning' | 'muted' | 'neutral' | 'success' }> = {
  yes: { label: 'Yes', variant: 'success' }, // driver-only / contributor: signed up, not attending
  waitlist: { label: 'Waitlist', variant: 'warning' },
  no: { label: 'Declined', variant: 'muted' },
  cancelled: { label: 'Removed', variant: 'muted' }
};

/** Remove is a soft, undoable step, not a ban: the family form hides a Removed
 *  person, and if the household submits again with them ticked, the sign-up
 *  RPC revives the same row (no twin). Patrick, 2026-08-24: that is fine —
 *  "if the troop is going to remove somebody for disciplinary reasons, it will
 *  be handled outside of the website workflow … talking to each other is a
 *  better option" — so the UI just says so instead of pretending otherwise. */
const REMOVE_NOTE = 'Frees their seat now. They can sign up again from the family form.';
const REMOVED_HINT = 'Removed by a leader. Put back reinstates them; the family can also sign up again from the family form.';

/** A two-line header ("Driving" over "To") — separate spans, so the accessible
 *  name still reads "Driving To" while the column stays one number wide. */
function StackedHeader({
  top,
  bottom,
  sort
}: {
  top: string;
  bottom: string;
  /** Present = sortable; the same button + aria-sort contract as SortHeader. */
  sort?: { colKey: RosterColKey; sortKey: RosterColKey | null; sortDir: SortDir; toggle: (k: RosterColKey) => void };
}) {
  const label = (
    <span className={styles.thStack}>
      <span>{top}</span> <span>{bottom}</span>
    </span>
  );
  if (!sort) {
    return (
      <th scope="col" className={styles.thCenter}>
        {label}
      </th>
    );
  }
  const active = sort.sortKey === sort.colKey;
  return (
    <th scope="col" className={styles.thCenter} aria-sort={active ? (sort.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={sortStyles.sortBtn} onClick={() => sort.toggle(sort.colKey)}>
        {label}
        {/* No idle ↕ here (Patrick: they read as stray quote marks) — the active column still shows its arrow. */}
        {active && (
          <span className={sortStyles.sortArrow} aria-hidden="true">
            {sort.sortDir === 'asc' ? '▲' : '▼'}
          </span>
        )}
      </button>
    </th>
  );
}

/** One line of facts under a job in the Edit dialog: "Sat Sep 2 · 9:00 AM–11:00 AM ·
 *  2 of 3 claimed · Bring gloves" — only the parts the slot actually has. */
function slotDetail(sl: {
  slotDate?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  description?: string | null;
  needed?: number | null;
  filled?: number;
}): string {
  return [jobWhen(sl), jobCoverage(sl), sl.description ?? ''].filter(Boolean).join(' · ');
}

const PARTICIPATION_LABEL: Record<string, string> = {
  full: 'Attend',
  driver_only: 'Drv only',
  contributor: 'Contributor'
};

/** Hover legends (Patrick, 2026-08-22: "so it's clear what the codes stand for
 *  and what values there are") — on the Class / Participation headers and on
 *  every cell, which also carries the row's own full value first. */
const CLASS_LEGEND = 'Codes: S scout · A adult · JL junior leader · Cub cub scout · W Webelos · G guest (light = youth, dark = adult)';
const PARTICIPATION_LEGEND =
  'Values: Attend — attending the event · Drv only — an adult providing a car without attending (owes nothing, no seat) · Contributor — donates items / claims a job without attending';
const classTitle = (cls: ParticipantClass) => `${PARTICIPANT_CLASS_LABEL[cls]}. ${CLASS_LEGEND}`;
const participationTitle = (p: string) => `${PARTICIPATION_LABEL[p] ?? p}. ${PARTICIPATION_LEGEND}`;

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
  slots,
  leaderQuestions = [],
  eventDate = '',
  groupSets = [],
  familyQuestionCount = 0,
  hasCarSets = true,
  guestMode = 'none',
  addCandidates = []
}: {
  /** "Someone missing?" — who a leader could add by hand; rendered under the grid. */
  addCandidates?: AddCandidate[];
  /** Every live (non-cancelled) entry; the grid itself shows status='yes'. */
  rows: RosterRow[];
  removedRows: RosterRow[];
  signupId: number;
  calendarEntryId: number;
  /** Every job on this signup — the editor's checklist; no jobs → no Jobs column.
   *  The optional facts print under each job in the Edit dialog so the editor
   *  can pick the right one (Patrick, 2026-08-22). */
  slots: {
    id: number;
    label: string;
    /** Leader-set roster code (Builder); null → derived from the label. */
    code?: string | null;
    slotDate?: string | null;
    startsAt?: string | null;
    endsAt?: string | null;
    description?: string | null;
    needed?: number | null;
    filled?: number;
  }[];
  /** Leader-only columns (Plans/Event-Logistics.md §D) — editable cells. */
  leaderQuestions?: LeaderQuestion[];
  /** For the health-form hint (a date within 12 months of the event). */
  eventDate?: string;
  /** Non-car group sets, builder order — one grid column each (item 6). */
  groupSets?: { id: number; label: string }[];
  /** Family questions on the event — zero means no Answers column (item 7). */
  familyQuestionCount?: number;
  /** Event has car sets (Drivers block on). false → no Driving/Ride columns at
   *  all and Notes gets the room (service projects: jobs + notes matter, rides
   *  don't — Patrick, 2026-08-22). */
  hasCarSets?: boolean;
  /** Guests as People: the "+N guests" column is a count-mode thing; named
   *  guests are rows of their own, so the column hides otherwise. */
  guestMode?: GuestMode;
}) {
  const showGuestCount = guestMode === 'count';
  // Attending tab = people who are coming (status yes AND participation full);
  // declines, waitlist, driver-only, contributors and removed share the other
  // tab, which keeps the Participation column (Patrick, 2026-08-22: "now that
  // the first tab is dedicated to attending, the participation column can go").
  const isAttending = (r: RosterRow) => r.status === 'yes' && r.participation === 'full';
  const mainRows = rows.filter(isAttending);
  const otherRows = [...rows.filter((r) => !isAttending(r)), ...removedRows];
  const [tab, setTab] = useState<'going' | 'other'>('going');
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
  const [payMethod, setPayMethod] = useState<PayMethod>('venmo');
  const [ackNegative, setAckNegative] = useState(false);
  const [payAmountText, setPayAmountText] = useState('');
  const payDialogRef = useRef<HTMLDialogElement>(null);
  // "Scout account balance" as the method: show what that account holds
  // (Patrick, 2026-08-22). Fetched on demand, per entry, from the full history.
  const [acctBalance, setAcctBalance] = useState<AccountFacts | null>(null);
  useEffect(() => {
    if (!payingRow || (payMethod !== 'scout_account' && payMethod !== 'scholarship')) return;
    let live = true;
    getScoutAccountBalanceForEntryAction(payingRow.id).then((r) => {
      if (live) setAcctBalance({ entryId: payingRow.id, balance: r.balance, scholarshipBalance: r.scholarshipBalance });
    });
    return () => {
      live = false;
    };
  }, [payingRow, payMethod]);
  const payFacts = payingRow && acctBalance?.entryId === payingRow.id ? acctBalance : null;
  const payNeedsAck = !!payingRow && wouldGoNegative(payMethod, payFacts, Number(payAmountText)) && !ackNegative;

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
  // Guests as People (Plans/Guests-As-People.md): a guest is a people row of
  // the host's household — the dialog offers the household's known guests as
  // one-click re-picks (the ONLY re-use path; a typed name is always a new
  // person), and an optional phone for an adult guest (carpools).
  const [guestPick, setGuestPick] = useState<number | null>(null);
  const [guestPhone, setGuestPhone] = useState('');
  const [knownGuests, setKnownGuests] = useState<HouseholdGuest[]>([]);
  const guestDialogRef = useRef<HTMLDialogElement>(null);
  // Known guests follow the chosen host — fetched on the change itself (and
  // when the dialog opens), not in an effect: the action is the external
  // system; React state only receives its answer.
  function loadKnownFor(hostId: number | '') {
    setKnownGuests([]);
    if (hostId === '') return;
    // A failed lookup leaves the typed-name path usable — never a broken dialog.
    loadGuestsForHost(Number(hostId), signupId).then((g) => setKnownGuests(g)).catch(() => setKnownGuests([]));
  }
  function pickKnownGuest(personId: number | null) {
    setGuestPick(personId);
    const g = personId != null ? knownGuests.find((k) => k.personId === personId) : null;
    if (g) {
      setGuestName(g.name);
      setGuestClass(g.cls);
      setGuestPhone(g.phone ?? '');
    } else {
      setGuestName('');
      setGuestPhone('');
    }
  }
  useEffect(() => {
    const dlg = guestDialogRef.current;
    if (!dlg) return;
    if (addingGuest && !dlg.open) dlg.showModal();
    if (!addingGuest && dlg.open) dlg.close();
  }, [addingGuest]);
  function openAddGuest() {
    setGuestName('');
    setGuestClass('webelos');
    setGuestPick(null);
    setGuestPhone('');
    const firstHost = rows.find((r) => r.hostEntryId === null)?.id ?? '';
    setGuestHost(firstHost);
    loadKnownFor(firstHost);
    setAddingGuest(true);
  }
  function saveGuest() {
    if ((guestPick == null && !guestName.trim()) || guestHost === '') return;
    start(async () => {
      setError(null);
      const res = await addGuestEntry(signupId, calendarEntryId, Number(guestHost), {
        personId: guestPick,
        name: guestName,
        cls: guestClass,
        phone: guestClass === 'adult_guest' ? guestPhone : null
      });
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

  /** The Edit dialog's draft vs the row (Save standard, 2026-08-24): the
   *  same diff saveJobs applies, computed up front so Save can be gated. */
  function claimsDiffFor(row: RosterRow) {
    const after: ClaimEdit[] = [...editClaims.entries()]
      .filter(([, v]) => v.checked)
      .map(([slotId, v]) => ({ slotId, comment: v.comment.trim() || null }));
    return diffClaimEdits(row.claimDetails, after);
  }
  const editDirty = (() => {
    if (!editingRow) return false;
    const diff = claimsDiffFor(editingRow);
    return (
      transportChanged(editingRow) ||
      editClass !== editingRow.participantClass ||
      diff.upsert.length > 0 ||
      diff.remove.length > 0
    );
  })();
  const feedback = useSavePhase();

  function saveJobs() {
    if (!editingRow) return;
    const row = editingRow;
    const diff = claimsDiffFor(row);
    feedback.start();
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
            feedback.fail();
            setError(res.error ?? 'Could not save transportation.');
            return;
          }
        }
        if (editClass !== row.participantClass) {
          const res = await setEntryClass(row.id, editClass, signupId, calendarEntryId);
          if (!res.ok) {
            feedback.fail();
            setError(res.error ?? 'Could not save the class.');
            return;
          }
        }
        for (const c of diff.upsert) {
          const res = await claimSlotFor(c.slotId, row.id, signupId, calendarEntryId, c.comment);
          if (!res.ok) {
            feedback.fail();
            setError(res.error ?? 'Could not save jobs.');
            return;
          }
        }
        for (const slotId of diff.remove) {
          const res = await unclaimSlotFor(slotId, row.id, signupId, calendarEntryId);
          if (!res.ok) {
            feedback.fail();
            setError(res.error ?? 'Could not save jobs.');
            return;
          }
        }
      } catch (err) {
        feedback.fail();
        setError(err instanceof Error ? err.message : 'Could not save jobs.');
        return;
      }
      setEditingRow(null);
      feedback.done();
      router.refresh();
    });
  }

  function openPayDialog(r: RosterRow) {
    setPayMethod('venmo');
    setAckNegative(false);
    // Default to what is still due — installments are the common case now.
    setPayAmountText(String(r.balance > 0 ? r.balance : r.owed));
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
          signupId,
          // Retry-safe: a double click or a flaky network records once.
          idempotencyKey: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined
        });
        if (!res.ok) setError(res.error ?? 'Could not record payment.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not record payment.');
      }
      setPayingRow(null);
      router.refresh();
    });
  }

  const defaultOrder = [...mainRows].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)
  );
  // null initial key: the adults-then-scouts… (kind → name) compound grouping
  // above IS the default; column sorting starts only when a header is clicked.
  const { sorted, sortKey, sortDir, toggle: toggleSort } = useSortable<RosterRow, RosterColKey>(
    defaultOrder,
    rosterValue,
    null
  );
  // One search box filters whichever tab is showing (list-search standard).
  const { q, setQ, visible: shown } = useTableSearch(sorted, rosterSearchFields);
  const term = q.trim().toLowerCase();
  const otherShown = term ? otherRows.filter((r) => rosterSearchFields(r).some((f) => (f ?? '').toLowerCase().includes(term))) : otherRows;

  const exportCsv = () => {
    // The CSV keeps the verbose wording and every status (the spreadsheets
    // downstream rely on it); only the grid is abbreviated.
    const head = [
      'Type', 'Name', 'Household', 'Status', 'Participation', 'Tier', 'Days',
      'Owed', 'Guests', 'Guest note',
      'Driving to (seats incl. driver)', 'Driving from (seats incl. driver)', 'Ride to', 'Ride from',
      ...groupSets.map((s) => s.label),
      'Balance', 'Jobs', 'Answers',
      // Leader-only columns: checkbox/number always; free text only when the
      // leader flagged it printable (Plans/Event-Logistics.md §D).
      ...printableLeader.map((q) => q.prompt),
      'Notes'
    ];
    const body = [...sorted, ...otherRows].map((r) => [
      PARTICIPANT_CLASS_LABEL[r.participantClass], r.name, r.household, r.status, r.participation, r.tierLabel ?? '',
      r.days ?? '', r.owed, r.guests, r.guestNote ?? '',
      r.drivesOut ? (r.vehicleSeatsOut ?? '') : '', r.drivesBack ? (r.vehicleSeatsBack ?? '') : '',
      rideCell(r, 'out', r.carOut), rideCell(r, 'back', r.carBack),
      ...groupSets.map((s) => r.groupBySet[s.id] ?? ''),
      r.owed === 0 ? '' : r.settled ? 'Paid' : `${r.balance} due`,
      r.claimsDisplay.join(' | '), r.answers.join(' | '),
      ...printableLeader.map((q) => r.leaderAnswers[q.id] ?? ''),
      r.notes ?? ''
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

  // Feature columns exist only when the event uses the feature (item 7).
  // Jobs are NOT columns (Patrick, 2026-08-25: "a mess on the rummage sale") —
  // the Job coverage list above the grid names the claimants; the codes still
  // label the Edit dialog's checklist.
  const jobCodes = resolveJobCodes(slots);
  const showAnswers = familyQuestionCount > 0;
  // Name, Class, [Guests], [Driving×2, Ride×2], Notes, Fee, Balance, actions
  const colCount = 5 + (showGuestCount ? 1 : 0) + (hasCarSets ? 4 : 0) + groupSets.length + (showAnswers ? 1 : 0) + leaderQuestions.length + 1;
  const printableLeader = printableLeaderQuestions(leaderQuestions);
  const [leaderDraft, setLeaderDraft] = useState<Record<string, string>>({});
  const saveLeader = (r: RosterRow, q: LeaderQuestion, value: string | null) =>
    start(async () => {
      setError(null);
      const res = await setLeaderAnswer(r.id, q.id, value, signupId, calendarEntryId);
      if (!res.ok) setError(res.error ?? 'Could not save.');
      else router.refresh();
    });
  const leaderCell = (r: RosterRow, q: LeaderQuestion) => {
    const applies = q.appliesTo === 'both' || (q.appliesTo === 'scouts') === isYouthClass(r.participantClass);
    if (!applies || r.status === 'cancelled') return <td key={q.id} className={styles.cellMuted}>—</td>;
    const current = r.leaderAnswers[q.id] ?? '';
    const key = `${r.id}:${q.id}`;
    const hint =
      LEADER_PRESETS.find((p) => p.prompt === q.prompt)?.hint === 'health_form_date' && !current && healthFormLikelyCurrent(r.healthFormDate, eventDate)
        ? `form dated ${fmtDate(r.healthFormDate)}`
        : null;
    if (isCheckboxColumn(q)) {
      const yes = (q.choices ?? [])[0];
      return (
        <td key={q.id}>
          <input
            type="checkbox"
            checked={current === yes}
            disabled={pending}
            aria-label={`${q.prompt} — ${r.name}`}
            onChange={(e) => saveLeader(r, q, e.target.checked ? yes : null)}
          />
          {hint && <span className={styles.evCat}>{hint}</span>}
        </td>
      );
    }
    if (q.inputType === 'choice') {
      return (
        <td key={q.id}>
          <select
            value={current}
            disabled={pending}
            aria-label={`${q.prompt} — ${r.name}`}
            onChange={(e) => saveLeader(r, q, e.target.value || null)}
          >
            <option value="">—</option>
            {(q.choices ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </td>
      );
    }
    const draft = leaderDraft[key] ?? current;
    return (
      <td key={q.id}>
        <input
          type={q.inputType === 'number' ? 'number' : 'text'}
          value={draft}
          disabled={pending}
          aria-label={`${q.prompt} — ${r.name}`}
          onChange={(e) => setLeaderDraft((d) => ({ ...d, [key]: e.target.value }))}
          onBlur={() => {
            if (draft !== current) saveLeader(r, q, draft || null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </td>
    );
  };

  return (
    <>
    <section className={styles.panel}>
      <SaveFeedback phase={feedback.phase} />
      <div className={styles.panelHead}>
        <TabStrip
          ariaLabel="Roster views"
          activeKey={tab}
          items={[
            { key: 'going', label: 'Attending', count: mainRows.length, onSelect: () => setTab('going') },
            { key: 'other', label: 'Other responses', count: otherRows.length, onSelect: () => setTab('other') }
          ]}
        />
        <SearchField value={q} onChange={setQ} label="Search the roster" />
        <div>
          <Button variant="primary" onClick={exportCsv}>
            Export CSV
          </Button>
        </div>
      </div>
      {error && <p className={styles.err}>{error}</p>}

      {tab === 'other' ? (
        <OtherResponses
          rows={otherShown}
          pending={pending}
          onRestore={(r) =>
            start(async () => {
              setError(null);
              const res = await restoreEntry(r.id, signupId, calendarEntryId);
              if (!res.ok) setError(res.error ?? 'Could not restore.');
              router.refresh();
            })
          }
          onRemove={(r) =>
            start(async () => {
              setError(null);
              const res = await cancelEntry(r.id, signupId, calendarEntryId);
              if (!res.ok) setError(res.error ?? 'Could not remove.');
              router.refresh();
            })
          }
          onDelete={(r) =>
            start(async () => {
              setError(null);
              const res = await deleteEntryPermanently(r.id, signupId, calendarEntryId);
              if (!res.ok) setError(res.error ?? 'Could not delete.');
              router.refresh();
            })
          }
        />
      ) : (
      <table className={styles.table}>
        <thead>
          <tr>
            <SortHeader label="Name" colKey="name" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} idleArrow={false} />
            <SortHeader label="Class" colKey="class" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} idleArrow={false} title={CLASS_LEGEND} />
            {showGuestCount && <th scope="col">Guests</th>}
            {hasCarSets && (
              <>
                <StackedHeader top="Driving" bottom="To" />
                <StackedHeader top="Driving" bottom="From" />
                <StackedHeader top="Ride" bottom="To" sort={{ colKey: 'rideOut', sortKey, sortDir, toggle: toggleSort }} />
                <StackedHeader top="Ride" bottom="From" sort={{ colKey: 'rideBack', sortKey, sortDir, toggle: toggleSort }} />
              </>
            )}
            {groupSets.map((s) => (
              <SortHeader key={s.id} label={s.label} colKey={`set:${s.id}`} sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} idleArrow={false} />
            ))}
            {showAnswers && <th scope="col">Answers</th>}
            {leaderQuestions.map((q) => {
              // Two-word leader headers stack ("Health" over "form") — Patrick, 2026-08-22.
              const label = leaderColumnHeader(q.prompt);
              const space = label.indexOf(' ');
              const title = `${q.prompt} — leader-only column, families never see it`;
              return space > 0 ? (
                <th key={q.id} scope="col" title={title}>
                  <span className={styles.thStack}>
                    <span>{label.slice(0, space)}</span> <span>{label.slice(space + 1)}</span>
                  </span>
                </th>
              ) : (
                <th key={q.id} scope="col" title={title}>
                  {label}
                </th>
              );
            })}
            <th scope="col">Notes</th>
            <SortHeader label="Fee" colKey="owed" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} idleArrow={false} />
            <th scope="col">Balance</th>
            <th scope="col" className={styles.actionsCol} />
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id}>
              <td className={styles.nowrap}>
                <span className={styles.evTitle}>{r.name}</span>
              </td>
              <td className={styles.nowrap} title={classTitle(r.participantClass)}>
                <ClassPill cls={r.participantClass} />
                {r.hostEntryId !== null && (
                  <span className={styles.guestOf}>
                    guest of {rows.find((h) => h.id === r.hostEntryId)?.name ?? '—'}
                  </span>
                )}
              </td>
              {showGuestCount && (
                <td className={styles.nowrap}>
                  {r.guests > 0 ? `+${r.guests}${r.guestNote ? ` (${r.guestNote})` : ''}` : '—'}
                </td>
              )}
              {/* Seats INCLUDING the driver — the number alone; the header says it's driving. */}
              {hasCarSets && (
                <>
                  <td className={styles.cellTight} title={r.drivesOut ? `Driving there · ${r.vehicleSeatsOut} seats incl. driver` : undefined}>
                    {r.drivesOut ? r.vehicleSeatsOut : ''}
                  </td>
                  <td className={styles.cellTight} title={r.drivesBack ? `Driving back · ${r.vehicleSeatsBack} seats incl. driver` : undefined}>
                    {r.drivesBack ? r.vehicleSeatsBack : ''}
                  </td>
                </>
              )}
              {hasCarSets && (['out', 'back'] as Leg[]).map((leg) => {
                const travels = r.status === 'yes' && r.participation !== 'contributor';
                const car = leg === 'out' ? r.carOut : r.carBack;
                // Full wording ("Needs a ride", "Driving · 4 seats") stays on hover.
                const full = travels ? rideCell(r, leg, car) : '—';
                return (
                  <td key={leg} className={`${styles.cellTight} ${styles.cellMuted}`} title={full}>
                    {travels ? rideShort(r, leg, car, r.name) : '—'}
                  </td>
                );
              })}
              {groupSets.map((s) => (
                <td key={s.id} className={`${styles.nowrap} ${styles.cellMuted}`}>
                  {r.groupBySet[s.id] ?? ''}
                </td>
              ))}
              {showAnswers && <td className={styles.cellMuted}>{r.answers.join(' · ') || '—'}</td>}
              {leaderQuestions.map((q) => leaderCell(r, q))}
              {/* One line with hover when the grid is dense; the full note when
                  there are no transport columns to make room for. */}
              <td className={`${styles.cellMuted}${hasCarSets ? ` ${styles.noteCell}` : ''}`} title={r.notes ?? undefined}>
                {r.notes || '—'}
              </td>
              <td className={styles.nowrap}>
                {r.owed > 0 ? `$${r.owed}` : '—'}
                {r.days ? <span className={styles.evCat}>{r.days} days</span> : null}
              </td>
              <td className={styles.nowrap}>
                {/* Derived, never a tick: owed − every linked payment (+ refunds).
                    Record here; void / refund / credit on the Money tab. */}
                {r.owed === 0 ? (
                  '—'
                ) : r.settled ? (
                  <Badge variant="success">{r.balance < 0 ? `Paid · over $${-r.balance}` : 'Paid'}</Badge>
                ) : (
                  <>
                    <Badge variant={r.paid > 0 ? 'warning' : 'muted'}>${r.balance} due</Badge>{' '}
                    <button
                      type="button"
                      className={styles.rowEdit}
                      disabled={pending}
                      aria-label={`Record payment — ${r.name}`}
                      onClick={() => openPayDialog(r)}
                    >
                      Record
                    </button>
                  </>
                )}
              </td>
              <td className={`${styles.nowrap} ${styles.actionsCol}`}>
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
                    <span className={styles.cellMuted} style={{ display: 'block', whiteSpace: 'normal', maxWidth: '22ch', marginTop: 4 }}>
                      {REMOVE_NOTE}
                    </span>
                  </>
                ) : (
                  <button
                    type="button"
                    className={styles.rowDel}
                    disabled={pending}
                    title={REMOVE_NOTE}
                    onClick={() => setConfirming(r.id)}
                  >
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
          {mainRows.length === 0 && (
            <tr>
              <td colSpan={colCount} className={styles.empty}>
                {otherRows.length > 0 ? 'Nobody is attending yet — see Other responses.' : 'Nobody has signed up yet.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
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
              {/* Transportation only when the event has car sets — data-driven like the grid (Patrick, 2026-08-22). */}
              {hasCarSets && editingRow.participation !== 'contributor' && editingRow.status !== 'cancelled' && (
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
              {/* Jobs only when the event defines any (item 7 — no placeholder text). */}
              {slots.length > 0 && <p className={`adminLabel ${styles.jobsHeading}`}>Jobs &amp; commitments</p>}
              {slots.length === 0 ? null : (
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
                          {sl.label} ({jobCodes.get(sl.id)})
                          {slotDetail(sl) && <span className={styles.evCat}>{slotDetail(sl)}</span>}
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
              <SaveButton
                dirty={editDirty}
                pending={pending}
                onClick={saveJobs}
              />
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
                Brought by
                <select
                  value={guestHost}
                  onChange={(e) => {
                    const next = e.target.value ? Number(e.target.value) : '';
                    setGuestHost(next);
                    pickKnownGuest(null);
                    loadKnownFor(next);
                  }}
                  aria-label="Brought by"
                  autoFocus
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
              {knownGuests.length > 0 && (
                <label className={`adminLabel ${styles.payField}`}>
                  Someone they have brought before
                  <select
                    value={guestPick ?? ''}
                    onChange={(e) => pickKnownGuest(e.target.value ? Number(e.target.value) : null)}
                    aria-label="Someone they have brought before"
                  >
                    <option value="">Type a new name below…</option>
                    {knownGuests.map((g) => (
                      <option key={g.personId} value={g.personId}>
                        {g.name} again ({PARTICIPANT_CLASS_LABEL[g.cls]})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className={`adminLabel ${styles.payField}`}>
                Guest name
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  aria-label="Guest name"
                  placeholder="e.g. Sam Lee"
                  maxLength={80}
                  disabled={guestPick != null}
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
              {guestClass === 'adult_guest' && (
                <label className={`adminLabel ${styles.payField}`}>
                  Phone (optional, for carpools)
                  <input
                    type="tel"
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value)}
                    aria-label="Phone (optional, for carpools)"
                    placeholder="e.g. 414-555-0100"
                    maxLength={40}
                  />
                </label>
              )}
            </DialogBody>
            <DialogActions>
              <button type="button" className={styles.rowEdit} onClick={() => setAddingGuest(false)} disabled={pending}>
                Cancel
              </button>
              <Button
                variant="primary"
                disabled={pending || (guestPick == null && !guestName.trim()) || guestHost === ''}
                onClick={saveGuest}
              >
                {pending ? 'Adding…' : 'Add guest'}
              </Button>
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
                <select
                  value={payMethod}
                  onChange={(e) => {
                    setPayMethod(e.target.value as PayMethod);
                    setAckNegative(false);
                  }}
                >
                  {(Object.keys(PAY_METHOD_LABEL) as PayMethod[]).map((m) => (
                    <option key={m} value={m}>
                      {PAY_METHOD_LABEL[m]}
                    </option>
                  ))}
                </select>
              </label>
              <PayGuard
                method={payMethod}
                facts={payFacts}
                loading={payFacts == null}
                amount={Number(payAmountText)}
                acknowledged={ackNegative}
                onAcknowledge={setAckNegative}
                onUseScholarship={() => {
                  setPayMethod('scholarship');
                  setAckNegative(false);
                }}
              />
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
              <Button variant="primary" disabled={pending || payNeedsAck} onClick={confirmPayment}>
                Record payment
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </section>
    <AddPerson
      candidates={addCandidates}
      signupId={signupId}
      calendarEntryId={calendarEntryId}
      onAddGuest={openAddGuest}
      guestDisabled={pending || rows.length === 0}
    />
    </>
  );
}

/** The Other-responses tab (Plans/Roster-Status-Tab.md item 1): declines,
 *  waitlist and removed people together, out of the way of the 99% case.
 *  A removed person comes back from here; a decline or waitlister can be
 *  taken off the list. Rendered inside RosterTable's panel, sharing its
 *  pending state and error banner. */
function OtherResponses({
  rows,
  pending,
  onRestore,
  onRemove,
  onDelete
}: {
  rows: RosterRow[];
  pending: boolean;
  onRestore: (r: RosterRow) => void;
  onRemove: (r: RosterRow) => void;
  /** Hard delete — Removed rows only (Patrick, 2026-08-23); two-click confirm
   *  like Remove, since there is no undo past this point. */
  onDelete: (r: RosterRow) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const order = { waitlist: 0, no: 1, cancelled: 2 } as Record<string, number>;
  const sorted = [...rows].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.name.localeCompare(b.name));
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Class</th>
          <th scope="col">Status</th>
          <th scope="col" title={PARTICIPATION_LEGEND}>Participation</th>
          <th scope="col">Household</th>
          <th scope="col">Notes</th>
          <th scope="col" />
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => {
          const st = OTHER_STATUS[r.status] ?? { label: r.status, variant: 'neutral' as const };
          return (
            <tr key={r.id} className={r.status === 'waitlist' ? styles.waitRow : undefined}>
              <td className={styles.nowrap}>
                <span className={styles.evTitle}>{r.name}</span>
              </td>
              <td className={styles.nowrap} title={classTitle(r.participantClass)}>
                <ClassPill cls={r.participantClass} />
              </td>
              <td className={styles.nowrap} title={r.status === 'cancelled' ? REMOVED_HINT : undefined}>
                <Badge variant={st.variant}>{st.label}</Badge>
              </td>
              <td className={`${styles.nowrap} ${styles.cellMuted}`} title={participationTitle(r.participation)}>
                {PARTICIPATION_LABEL[r.participation] ?? r.participation}
              </td>
              <td className={styles.cellMuted}>{r.household}</td>
              <td className={`${styles.cellMuted} ${styles.noteCell}`} title={r.notes ?? undefined}>
                {r.notes || '—'}
              </td>
              <td className={styles.nowrap}>
                {r.status === 'cancelled' ? (
                  confirmDelete === r.id ? (
                    <>
                      <Button
                        variant="danger"
                        disabled={pending}
                        onClick={() => {
                          setConfirmDelete(null);
                          onDelete(r);
                        }}
                      >
                        Confirm delete
                      </Button>{' '}
                      <button type="button" className={styles.rowEdit} onClick={() => setConfirmDelete(null)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className={styles.rowEdit} disabled={pending} onClick={() => onRestore(r)}>
                        Put back
                      </button>{' '}
                      <button
                        type="button"
                        className={styles.rowDel}
                        disabled={pending}
                        title="Erase this row from the database — claims, answers and placements go with it. No undo."
                        onClick={() => setConfirmDelete(r.id)}
                      >
                        Delete permanently
                      </button>
                    </>
                  )
                ) : (
                  <button type="button" className={styles.rowDel} disabled={pending} title={REMOVE_NOTE} onClick={() => onRemove(r)}>
                    Remove
                  </button>
                )}
              </td>
            </tr>
          );
        })}
        {sorted.length === 0 && (
          <tr>
            <td colSpan={7} className={styles.empty}>
              No declines, waitlist or removals.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
