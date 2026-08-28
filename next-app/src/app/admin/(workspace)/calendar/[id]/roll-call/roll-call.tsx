'use client';

/**
 * The Roll Call sheet: check who was there, correct quantities, see how it
 * compares to the signup.
 *
 * Built for the way attendance is actually taken — a leader with a phone at the
 * back of a room, working down a list — so checking someone is one tap, the
 * list stays put, and nothing is behind a dialog.
 *
 * One TAB per directory group (Patrick, 2026-08-24: "rebuild the roll call
 * page with the same tab pattern") — Scouts, Leaders, Adults, Inactive scouts
 * — the tabbed-workbench pattern from /admin/styleguide/admin. The four
 * sections used to stack, so the adults were a long scroll below the scouts;
 * now each is a tab whose pill is the number marked present. Panels stay
 * mounted and hide with `hidden`. Search applies to the open tab and says
 * which other tabs hold a match.
 */

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { AttendanceRow, AttendeeCandidate, CreditKind } from '@/lib/attendance-shared';
import { reconcileWithSignup } from '@/lib/attendance-shared';
import styles from './roll-call.module.css';
import { AddButton } from '../../../_components/add-button';
import { Badge } from '../../../_components/badge';
import { TabStrip } from '../../../_components/tab-strip';
import { Button } from '../../../../_components/button';

type Result = { ok: boolean; error?: string };

export type RollCallProps = Props;

interface Props {
  entryId: number;
  entryTitle: string;
  creditKind: CreditKind | null;
  creditUnit: string | null;
  countsAsActivity: boolean;
  defaultQty: number;
  hasSignup: boolean;
  candidates: AttendeeCandidate[];
  attendance: AttendanceRow[];
  onMark: (entryId: number, personId: number, qty?: number | null) => Promise<Result>;
  onUnmark: (entryId: number, personId: number) => Promise<Result>;
  onSetQty: (entryId: number, personId: number, qty: number) => Promise<Result>;
  onSeed: (entryId: number) => Promise<Result & { added?: number }>;
}

/** Tab order — the people you take roll for first come first. */
const TAB_ORDER: { key: string; label: string }[] = [
  { key: 'active_scout', label: 'Scouts' },
  { key: 'leader', label: 'Leaders' },
  { key: 'adult', label: 'Adults' },
  { key: 'inactive_scout', label: 'Inactive scouts' },
  { key: 'guest', label: 'Guests' }
];

export function RollCall({
  entryId,
  creditKind,
  creditUnit,
  countsAsActivity,
  defaultQty,
  hasSignup,
  candidates,
  attendance,
  onMark,
  onUnmark,
  onSetQty,
  onSeed
}: Props) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  /** People whose write is in flight — only THEIR control is disabled. */
  const [busy, setBusy] = useState<ReadonlySet<number>>(() => new Set());
  const [seeding, setSeeding] = useState(false);
  const [, startTransition] = useTransition();

  /*
   * Optimistic rows (Plans/Performance-Review-2026-08-27.md #6). A tap flips
   * the box at once; the server's answer arrives later. Overrides are tied
   * to the `attendance` prop they were made against, so the moment a refresh
   * delivers fresh rows they fall away without an effect — state-from-props
   * without the setState-in-effect the React compiler lint forbids.
   */
  const [optimistic, setOptimistic] = useState<{ base: AttendanceRow[]; rows: Map<number, AttendanceRow | null> }>(
    () => ({ base: attendance, rows: new Map() })
  );
  // …except for people whose write is STILL in flight: a refresh triggered by
  // an earlier tap must not un-tick a later one before its own write lands.
  const overrides = useMemo(
    () =>
      optimistic.base === attendance
        ? optimistic.rows
        : new Map([...optimistic.rows].filter(([personId]) => busy.has(personId))),
    [optimistic, attendance, busy]
  );
  function setOverride(personId: number, row: AttendanceRow | null | undefined) {
    setOptimistic((cur) => {
      const rows = new Map(cur.base === attendance ? cur.rows : [...cur.rows].filter(([id]) => busy.has(id)));
      if (row === undefined) rows.delete(personId);
      else rows.set(personId, row);
      return { base: attendance, rows };
    });
  }

  const byPerson = useMemo(() => {
    const m = new Map<number, AttendanceRow>();
    for (const a of attendance) m.set(a.personId, a);
    for (const [personId, row] of overrides) {
      if (row) m.set(personId, row);
      else m.delete(personId);
    }
    return m;
  }, [attendance, overrides]);

  // One refresh for a burst of taps, off the critical path: the workbench
  // re-render (its own ten queries) used to run after EVERY checkbox.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function scheduleRefresh() {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      router.refresh();
    }, 600);
  }

  const attended = useMemo(() => new Set(byPerson.keys()), [byPerson]);
  const { missedSignup, unexpected } = useMemo(
    () => reconcileWithSignup(candidates, attended),
    [candidates, attended]
  );

  const needle = q.trim().toLowerCase();
  const matches = (c: AttendeeCandidate) =>
    !needle || c.displayName.toLowerCase().includes(needle) || (c.scoutId ?? '').toLowerCase().includes(needle);

  // One group per directory tab, in TAB_ORDER; a group nobody is in has no
  // tab. Anyone with a tab the order doesn't know lands in "Other".
  const groups = useMemo(() => {
    const byKey = new Map<string, AttendeeCandidate[]>();
    for (const c of candidates) {
      const key = TAB_ORDER.some((t) => t.key === c.tab) ? c.tab : 'other';
      byKey.set(key, [...(byKey.get(key) ?? []), c]);
    }
    return [...TAB_ORDER, { key: 'other', label: 'Other' }]
      .filter((t) => byKey.has(t.key))
      // Alphabetical within the group (Patrick, 2026-08-25): the list flows
      // down each column before the next, so a name is found by reading down.
      .map((t) => ({
        ...t,
        people: [...byKey.get(t.key)!].sort((a, b) => a.displayName.localeCompare(b.displayName))
      }));
  }, [candidates]);

  const [tab, setTab] = useState(() => groups[0]?.key ?? 'active_scout');

  /** Write for one person, showing `next` immediately; on failure the row
   *  goes back to what the server last said and the error is shown. */
  function run(personId: number, next: AttendanceRow | null, fn: () => Promise<Result>) {
    setErr(null);
    setBusy((cur) => new Set(cur).add(personId));
    setOverride(personId, next);
    startTransition(async () => {
      const res = await fn();
      setBusy((cur) => {
        const s = new Set(cur);
        s.delete(personId);
        return s;
      });
      if (!res.ok) {
        setOverride(personId, undefined);
        setErr(res.error ?? 'That did not save.');
      } else scheduleRefresh();
    });
  }

  function toggle(c: AttendeeCandidate, on: boolean) {
    const current = byPerson.get(c.personId);
    const next: AttendanceRow | null = on
      ? { id: current?.id ?? -c.personId, personId: c.personId, qty: null, source: 'manual', note: null }
      : null;
    run(c.personId, next, () => (on ? onMark(entryId, c.personId) : onUnmark(entryId, c.personId)));
  }

  function setQty(c: AttendeeCandidate, qty: number) {
    const current = byPerson.get(c.personId);
    if (!current) return;
    run(c.personId, { ...current, qty }, () => onSetQty(entryId, c.personId, qty));
  }

  function seed() {
    setErr(null);
    setSeeding(true);
    startTransition(async () => {
      const res = await onSeed(entryId);
      setSeeding(false);
      if (!res.ok) setErr(res.error ?? 'Could not seed from the signup.');
      else router.refresh();
    });
  }

  const creditNote = creditKind
    ? `Marking someone present grants ${defaultQty} ${creditUnit ?? ''} in the ledger.`.replace(/\s+/g, ' ')
    : 'This category grants no ledger credit.';

  return (
    <>
      <div className={styles.summary}>
        <span className={styles.note}>
          {creditNote}
          {countsAsActivity
            ? ' Counts as a troop activity toward Second Class 1a and First Class 1a.'
            : ' Does not count as a troop activity — this is a meeting.'}
        </span>
        {hasSignup && (
          <AddButton onClick={seed} disabled={seeding || busy.size > 0}>
            {seeding ? 'Seeding…' : 'Mark everyone who signed up'}
          </AddButton>
        )}
      </div>

      {err && <div className={styles.error} role="alert">{err}</div>}

      {hasSignup && (missedSignup.length > 0 || unexpected.length > 0) && (
        <div className={styles.mismatch}>
          {missedSignup.length > 0 && (
            <p>
              <strong>{missedSignup.length} signed up but not marked present</strong> —{' '}
              {missedSignup.map((c) => c.displayName).join(', ')}. They may still owe for this
              event.
            </p>
          )}
          {unexpected.length > 0 && (
            <p>
              <strong>{unexpected.length} present who never signed up</strong> —{' '}
              {unexpected.map((c) => c.displayName).join(', ')}. Worth checking they were
              invoiced.
            </p>
          )}
        </div>
      )}

      <TabStrip
        ariaLabel="Who to take roll for"
        activeKey={tab}
        className={styles.tabs}
        items={groups.map((g) => ({
          key: g.key,
          label: g.label,
          count: g.people.filter((p) => attended.has(p.personId)).length,
          onSelect: () => setTab(g.key)
        }))}
      />

      <input
        type="search"
        className={styles.search}
        placeholder="Find a name…"
        aria-label="Find a person"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {groups.map((g) => {
        const people = g.people.filter(matches);
        const elsewhere = needle
          ? groups.filter((o) => o.key !== g.key && o.people.some(matches)).map((o) => o.label)
          : [];
        return (
        <section key={g.key} className={styles.group} role="tabpanel" aria-label={g.label} hidden={tab !== g.key}>
          <h2 className={styles.groupHead}>
            {g.label}
            <span className={styles.groupCount}>
              {g.people.filter((p) => attended.has(p.personId)).length} / {g.people.length} present
            </span>
          </h2>
          {people.length === 0 && (
            <p className={styles.empty}>
              Nobody on this tab matches that search.
              {elsewhere.length > 0 && (
                <>
                  {' '}Try{' '}
                  {elsewhere.map((label, i) => (
                    <span key={label}>
                      {i > 0 && ', '}
                      <Button variant="quiet" size="sm" onClick={() => setTab(groups.find((o) => o.label === label)!.key)}>
                        {label}
                      </Button>
                    </span>
                  ))}
                  .
                </>
              )}
            </p>
          )}
          <ul className={styles.list}>
            {people.map((c) => {
              const row = byPerson.get(c.personId);
              const isHere = row !== undefined;
              return (
                <li key={c.personId} className={isHere ? styles.rowOn : styles.row}>
                  <label className={styles.name}>
                    <input
                      type="checkbox"
                      checked={isHere}
                      disabled={seeding || busy.has(c.personId)}
                      onChange={(e) => toggle(c, e.target.checked)}
                    />
                    <span>{c.displayName}</span>
                    {c.signedUp && <Badge variant="info">signed up</Badge>}
                    {row?.source === 'import' && <Badge variant="muted">historical</Badge>}
                  </label>
                  {isHere && creditKind && creditUnit && creditUnit !== 'each' && (
                    <span className={styles.qty}>
                      <input
                        type="number"
                        min={0}
                        step={creditUnit === 'hours' ? 0.5 : 1}
                        value={row?.qty ?? defaultQty}
                        disabled={seeding || busy.has(c.personId)}
                        aria-label={`${creditUnit} for ${c.displayName}`}
                        onChange={(e) => setQty(c, Number(e.target.value))}
                      />
                      {creditUnit}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
        );
      })}
    </>
  );
}
