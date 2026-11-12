'use client';

/*
 * The Money tab (Plans/Event-Logistics.md §C; redesigned as "Ledger with a person panel",
 * Plans/Event-Money-Ledger-Redesign.md, 2026-11-12). Everything here is derived from financial_transactions +
 * signup_entry_balances; each click writes one row through its own Server Action with an idempotency key.
 *
 *   title row   Bucket ▾ (the event's bucket, in a popover) · + Add expense (jumps to the expense row)
 *   band        income of expected, who has paid, by method · Still due · Expenses · To reimburse · Net
 *   ledger      one read-only row per person; the selected one opens the panel beside it (?person=<entryId>,
 *               the first person when the URL names none — Patrick, 2026-11-12)
 *   panel       what they owe, record a payment / refund / credit, history with Void
 *   below       Expenses & reimbursements, Deposit schedule & deadlines (unchanged)
 */
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { EventMoneyData } from '../../../finance/actions';
import { milestoneStanding, summarizeEventMoney, type Milestone } from '@/lib/event-money';
import type { Bucket } from '@/lib/buckets';
import { EventBucketControl } from '../../../finance/event-bucket-control';
import { Notice } from '../../../_components/notice';
import { Button } from '../../../../_components/button';
import { MoneySummaryBand } from './money-summary-band';
import { MoneyLedger } from './money-ledger';
import { PersonMoneyPanel, type Act } from './person-money-panel';
import { MoneyExpenses, EXPENSE_FIRST_FIELD_ID, EXPENSE_SECTION_ID } from './money-expenses';
import { MoneyMilestones } from './money-milestones';
import styles from './money.module.css';

export function MoneyPanel({
  signupId,
  calendarEntryId,
  data,
  buckets,
  adults,
  today
}: {
  signupId: number;
  calendarEntryId: number;
  data: EventMoneyData;
  buckets: Bucket[];
  adults: { personId: number; name: string }[];
  today: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /** The expense and milestone rows' runner: one action, its error above the sections, then a refresh. */
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      try {
        const res = await fn();
        if (!res.ok) setError(res.error ?? 'Could not save.');
        else after?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save.');
      }
      router.refresh();
    });
  /** The person panel's runner: it shows its own error beside the control that failed. */
  const act: Act = (fn) =>
    new Promise((resolve) =>
      start(async () => {
        let res: { ok: boolean; error?: string };
        try {
          res = await fn();
        } catch (err) {
          res = { ok: false, error: err instanceof Error ? err.message : 'Could not save.' };
        }
        router.refresh();
        resolve(res);
      })
    );
  const task = (fn: (report: { error: (m: string) => void; note: (m: string) => void }) => Promise<void>) =>
    start(async () => {
      setError(null);
      await fn({ error: setError, note: setNote });
    });

  const milestones: Milestone[] = data.milestones;
  const totals = useMemo(
    () =>
      summarizeEventMoney(
        data.people.map((p) => ({ entryId: p.entryId, owed: p.owed, paid: p.paid, balance: p.balance })),
        [
          ...data.people.flatMap((p) =>
            p.transactions.map((t) => ({
              id: t.id,
              occurredOn: t.occurredOn,
              amount: t.amount,
              kind: t.kind,
              method: t.method,
              memo: t.memo,
              voidedAt: t.voidedAt,
              signupEntryId: p.entryId,
              personId: p.personId
            }))
          ),
          ...data.expenses.map((e) => ({
            id: e.id,
            occurredOn: e.occurredOn,
            amount: e.amount,
            kind: e.kind,
            method: e.method,
            memo: e.memo,
            voidedAt: e.voidedAt,
            signupEntryId: null,
            personId: null
          }))
        ],
        data.reimbursements.filter((r) => r.status === 'submitted' || r.status === 'approved')
      ),
    [data]
  );
  const standings = useMemo(
    () =>
      new Map(
        data.people.map((p) => [p.entryId, milestoneStanding({ owed: p.owed, paid: p.paid, isScout: p.isScout }, milestones, today)])
      ),
    [data.people, milestones, today]
  );
  const behind = data.people
    .filter((p) => p.status === 'yes' && standings.get(p.entryId)?.standing === 'behind')
    .map((p) => {
      const s = standings.get(p.entryId)!;
      return { entryId: p.entryId, name: p.name, shortBy: s.shortBy, dueByToday: s.dueByToday };
    });

  // ── The selected person: ?person=<entryId>, else the first in the list ───────────────────────────────────────
  const fromUrl = Number(search.get('person'));
  const [selectedId, setSelectedId] = useState<number | null>(() =>
    data.people.some((p) => p.entryId === fromUrl) ? fromUrl : (data.people[0]?.entryId ?? null)
  );
  const selected = data.people.find((p) => p.entryId === selectedId) ?? null;
  function select(entryId: number | null) {
    setSelectedId(entryId);
    // Keep the rest of the URL (the workbench's ?view=money); no navigation, so nothing re-renders on the server.
    const params = new URLSearchParams(search.toString());
    if (entryId == null) params.delete('person');
    else params.set('person', String(entryId));
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
  }

  // ── Bucket popover ────────────────────────────────────────────────────────────────────────────────────────────
  const [bucketOpen, setBucketOpen] = useState(false);
  const bucketRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!bucketOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (bucketRef.current && !bucketRef.current.contains(e.target as Node)) setBucketOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBucketOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [bucketOpen]);
  const bucketName = buckets.find((b) => b.id === data.bucketId)?.name ?? 'None';

  function jumpToExpenses() {
    document.getElementById(EXPENSE_SECTION_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById(EXPENSE_FIRST_FIELD_ID)?.focus({ preventScroll: true });
  }

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.bucketWrap} ref={bucketRef}>
          <button type="button" className={styles.bucketBtn} aria-expanded={bucketOpen} onClick={() => setBucketOpen((o) => !o)}>
            Bucket <strong>{bucketName}</strong> ▾
          </button>
          {bucketOpen && (
            <div className={styles.bucketPop}>
              {/* The event's bucket (Plans/Buckets-Lookup.md): the tab shows every row in it, plus the event's own. */}
              <EventBucketControl calendarEntryId={calendarEntryId} bucketId={data.bucketId} buckets={buckets} />
            </div>
          )}
        </div>
        <Button size="sm" variant="quiet" onClick={jumpToExpenses}>
          + Add expense
        </Button>
      </div>

      <MoneySummaryBand totals={totals} people={data.people} />

      {error && <Notice>{error}</Notice>}
      {note && <Notice variant="success">{note}</Notice>}

      <div className={styles.split}>
        <div className={styles.ledgerCol}>
          {data.people.length === 0 ? (
            <p className={styles.hint}>Nobody has signed up yet.</p>
          ) : (
            <MoneyLedger
              people={data.people}
              standings={standings}
              hasSchedule={milestones.some((m) => m.kind === 'payment')}
              selectedId={selectedId}
              onSelect={select}
            />
          )}
        </div>
        {selected && (
          <div className={styles.panelCol}>
            <PersonMoneyPanel
              key={selected.entryId}
              person={selected}
              signupId={signupId}
              today={today}
              busy={pending}
              act={act}
              onClose={() => select(null)}
            />
          </div>
        )}
      </div>

      <MoneyExpenses
        signupId={signupId}
        calendarEntryId={calendarEntryId}
        data={data}
        adults={adults}
        today={today}
        pending={pending}
        run={run}
      />
      <MoneyMilestones
        signupId={signupId}
        calendarEntryId={calendarEntryId}
        milestones={milestones}
        behind={behind}
        pending={pending}
        run={run}
        task={task}
      />
    </>
  );
}
