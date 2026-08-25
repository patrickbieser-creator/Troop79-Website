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

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { AttendanceRow, AttendeeCandidate, CreditKind } from '@/lib/attendance-shared';
import { reconcileWithSignup } from '@/lib/attendance-shared';
import styles from './roll-call.module.css';
import { AddButton } from '../../../_components/add-button';
import { Badge } from '../../../_components/badge';
import { TabStrip } from '../../../_components/tab-strip';

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
  { key: 'inactive_scout', label: 'Inactive scouts' }
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
  const [busy, setBusy] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  const byPerson = useMemo(() => {
    const m = new Map<number, AttendanceRow>();
    for (const a of attendance) m.set(a.personId, a);
    return m;
  }, [attendance]);

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
      .map((t) => ({ ...t, people: byKey.get(t.key)! }));
  }, [candidates]);

  const [tab, setTab] = useState(() => groups[0]?.key ?? 'active_scout');

  function run(personId: number, fn: () => Promise<Result>) {
    setErr(null);
    setBusy(personId);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (!res.ok) setErr(res.error ?? 'That did not save.');
      else router.refresh();
    });
  }

  function toggle(c: AttendeeCandidate, on: boolean) {
    run(c.personId, () =>
      on ? onMark(entryId, c.personId) : onUnmark(entryId, c.personId)
    );
  }

  function seed() {
    setErr(null);
    setBusy(-1);
    startTransition(async () => {
      const res = await onSeed(entryId);
      setBusy(null);
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
        <span className={styles.count}>
          <strong>{attended.size}</strong> present
        </span>
        <span className={styles.note}>
          {creditNote}
          {countsAsActivity
            ? ' Counts as a troop activity toward Second Class 1a and First Class 1a.'
            : ' Does not count as a troop activity — this is a meeting.'}
        </span>
        {hasSignup && (
          <AddButton onClick={seed} disabled={busy !== null}>
            {busy === -1 ? 'Seeding…' : 'Mark everyone who signed up'}
          </AddButton>
        )}
      </div>

      {err && <div className={styles.error}>{err}</div>}

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
                      <button type="button" className={styles.linkBtn} onClick={() => setTab(groups.find((o) => o.label === label)!.key)}>
                        {label}
                      </button>
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
                      disabled={busy !== null}
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
                        disabled={busy !== null}
                        aria-label={`${creditUnit} for ${c.displayName}`}
                        onChange={(e) =>
                          run(c.personId, () =>
                            onSetQty(entryId, c.personId, Number(e.target.value))
                          )
                        }
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
