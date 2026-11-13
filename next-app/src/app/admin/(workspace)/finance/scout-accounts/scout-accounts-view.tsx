'use client';

/*
 * Money › Scout Accounts (2026-11-12; Jenna's spec): the holder list beside one holder's ledger — the Money tab's
 * ledger + person panel with the widths inverted (the list is narrow, the ledger wide).
 *
 *   list    every holder by name, chips for Webelos / inactive / adult, the Scholarship Fund pinned last;
 *           All · Active · Inactive · Adults (the fund stays under every filter); search; footer total ties to the
 *           Financial Ledger's "Scout & scholarship accounts" card
 *   panel   ?person=<personId> or ?account=scholarship (the first holder when the URL names none): balance line,
 *           Date | What | Amount | Balance newest first, voided rows struck with their reason, initials on each row;
 *           "Open in Financial Ledger" (where a row is edited or voided) and, for a departed scout with money,
 *           "Move to troop fund…"
 */
import { useEffect, useId, useMemo, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { fmtDate } from '@/lib/format-date';
import {
  accountMoney,
  canMoveToTroop,
  filterHolders,
  HOLDER_CHIP,
  holderCounts,
  type HolderFilter,
  type HolderRow
} from '@/lib/scout-accounts';
import { getScoutAccountHistoryAction, moveScoutAccountToTroopAction, type AccountHistory } from './actions';
import { SearchField, useTableSearch } from '../../_components/search-field';
import { SegmentedControl } from '../../_components/segmented-control';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../_components/dialog';
import { Button } from '../../../_components/button';
import styles from './scout-accounts.module.css';

const short = (d: string) => fmtDate(d, { year: 'short' });

function Money({ n }: { n: number }) {
  return Math.round(n * 100) < 0 ? <span className={styles.neg}>{accountMoney(n)}</span> : <>{accountMoney(n)}</>;
}

function Chip({ status }: { status: HolderRow['status'] }) {
  const chip = HOLDER_CHIP[status];
  return chip ? <span className={styles.chip}>{chip}</span> : null;
}

function targetOf(row: HolderRow) {
  return row.personId == null ? ({ account: 'scholarship' } as const) : { personId: row.personId };
}

function urlFor(row: HolderRow | null): string {
  if (!row) return '';
  return row.personId == null ? '?account=scholarship' : `?person=${row.personId}`;
}

export function ScoutAccountsView({ rows, initialKey, canManage }: { rows: HolderRow[]; initialKey: string | null; canManage: boolean }) {
  const pathname = usePathname();
  const [filter, setFilter] = useState<HolderFilter>('all');
  const filtered = useMemo(() => filterHolders(rows, filter), [rows, filter]);
  const { q, setQ, visible } = useTableSearch(filtered, (r) => [r.name]);
  const counts = holderCounts(rows);

  const [selectedKey, setSelectedKey] = useState<string | null>(() =>
    rows.some((r) => r.key === initialKey) ? initialKey : (rows[0]?.key ?? null)
  );
  const selected = rows.find((r) => r.key === selectedKey) ?? null;
  function select(row: HolderRow | null) {
    setSelectedKey(row?.key ?? null);
    window.history.replaceState(null, '', `${pathname}${urlFor(row)}`);
  }

  const nameRefs = useRef(new Map<string, HTMLButtonElement>());
  function onKeyDown(e: KeyboardEvent<HTMLTableElement>) {
    if (e.key === 'Escape') return select(null);
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (visible.length === 0) return;
    const at = visible.findIndex((r) => r.key === selectedKey);
    const next = visible[Math.min(visible.length - 1, Math.max(0, at < 0 ? 0 : at + (e.key === 'ArrowDown' ? 1 : -1)))];
    select(next);
    nameRefs.current.get(next.key)?.focus();
  }

  const people = visible.filter((r) => r.status !== 'fund');
  const fund = visible.find((r) => r.status === 'fund');
  const total = Math.round(visible.reduce((n, r) => n + r.balance * 100, 0)) / 100;
  const overdrawn = people.filter((r) => Math.round(r.balance * 100) < 0).length;

  return (
    <>
      <div className={styles.toolbar}>
        <SegmentedControl
          name="scout-accounts-filter"
          label="Which accounts"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All ${counts.all}` },
            { value: 'active', label: `Active ${counts.active}` },
            { value: 'inactive', label: `Inactive ${counts.inactive}` },
            { value: 'adult', label: `Adults ${counts.adult}` }
          ]}
        />
        <SearchField value={q} onChange={setQ} label="Search scout accounts" resultCount={visible.length} totalCount={filtered.length} />
      </div>

      <div className={styles.split}>
        <div className={styles.listCol}>
          <div className={styles.tableWrap}>
            <table className={styles.table} onKeyDown={onKeyDown} aria-label="Scout accounts">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col" className={styles.num}>
                    Balance
                  </th>
                  <th scope="col">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={3} className={styles.empty}>
                      {q ? `No accounts match “${q}”.` : 'No scout account activity yet.'}
                    </td>
                  </tr>
                )}
                {visible.map((r) => {
                  const on = r.key === selectedKey;
                  const cls = [styles.row, on ? styles.rowOn : null, r.status === 'fund' ? styles.fundRow : null].filter(Boolean).join(' ');
                  return (
                    <tr key={r.key} className={cls} onClick={() => select(r)}>
                      <td>
                        <button
                          type="button"
                          className={styles.nameBtn}
                          aria-pressed={on}
                          ref={(el) => {
                            if (el) nameRefs.current.set(r.key, el);
                            else nameRefs.current.delete(r.key);
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            select(r);
                          }}
                        >
                          {r.name}
                        </button>
                        <Chip status={r.status} />
                      </td>
                      <td className={styles.num}>
                        <Money n={r.balance} />
                      </td>
                      <td className={styles.nowrap}>{r.lastOn ? short(r.lastOn) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
              {visible.length > 0 && (
                <tfoot>
                  <tr>
                    <td>
                      {people.length} {people.length === 1 ? 'account' : 'accounts'}
                      {fund ? ' + fund' : ''}
                      {overdrawn > 0 ? ` · ${overdrawn} overdrawn` : ''}
                    </td>
                    <td className={styles.num}>
                      <Money n={total} />
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className={styles.foot}>Click a name, or use ↑ ↓, to see that account&rsquo;s history.</p>
        </div>

        {selected && (
          <div className={styles.panelCol}>
            <AccountPanel key={selected.key} row={selected} canManage={canManage} onClose={() => select(null)} />
          </div>
        )}
      </div>
    </>
  );
}

function AccountPanel({ row, canManage, onClose }: { row: HolderRow; canManage: boolean; onClose: () => void }) {
  const router = useRouter();
  const [history, setHistory] = useState<AccountHistory | null>(null);
  const [reload, setReload] = useState(0);
  const [moving, setMoving] = useState(false);
  const headingId = useId();

  useEffect(() => {
    let live = true;
    getScoutAccountHistoryAction(targetOf(row))
      .then((h) => {
        if (live) setHistory(h);
      })
      .catch(() => {
        if (live) setHistory({ ok: false, error: 'Couldn’t load this account’s history. Reload the page to try again.' });
      });
    return () => {
      live = false;
    };
  }, [row, reload]);

  const ledgerHref = row.personId == null ? '/admin/finance?account=scholarship' : `/admin/finance?account=scout_account&person=${row.personId}`;
  const s = history?.ok ? history.summary : null;
  const movable = canManage && s != null && canMoveToTroop({ status: row.status, wasScout: row.wasScout, balance: s.balance }) === null;

  return (
    <section className={styles.panel} aria-labelledby={headingId} onKeyDown={(e) => e.key === 'Escape' && !moving && onClose()}>
      <div className={styles.panelHead}>
        <h2 id={headingId}>
          {row.name}
          <Chip status={row.status} />
        </h2>
        <div className={styles.headActions}>
          {movable && (
            <Button size="sm" variant="secondary" onClick={() => setMoving(true)}>
              Move to troop fund…
            </Button>
          )}
          <Button size="sm" variant="quiet" href={ledgerHref}>
            Open in Financial Ledger
          </Button>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
      </div>
      <p className={styles.status}>
        {s ? (
          <>
            Balance <strong>{accountMoney(s.balance)}</strong> · income {accountMoney(s.income)} · expenses {accountMoney(s.expenses)}
          </>
        ) : (
          ' '
        )}
      </p>

      {history === null ? (
        <p className={styles.hint} aria-busy="true">
          Loading history…
        </p>
      ) : !history.ok ? (
        <Notice>{history.error}</Notice>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table} aria-label={`${row.name} account history`}>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">What</th>
                <th scope="col" className={styles.num}>
                  Amount
                </th>
                <th scope="col" className={styles.num}>
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {history.txns.length === 0 && (
                <tr>
                  <td colSpan={4} className={styles.empty}>
                    Nothing yet.
                  </td>
                </tr>
              )}
              {history.txns.map((t) => {
                const sub = t.voidedAt
                  ? `Voided${t.voidedBy ? ` by ${t.voidedBy}` : ''}${t.voidReason ? `: “${t.voidReason}”` : ''}`
                  : [t.enteredBy ? `Recorded by ${t.enteredBy}` : null, t.bucketName ? t.memo : null].filter(Boolean).join(' · ');
                return (
                  <tr key={t.id} className={t.voidedAt ? styles.voided : undefined}>
                    <td className={styles.nowrap}>{short(t.occurredOn)}</td>
                    <td>
                      <span className={styles.what}>{t.bucketName ?? t.memo ?? t.kindLabel}</span>
                      {t.voidedAt && (
                        <>
                          {' '}
                          <Badge variant="neutral">Voided</Badge>
                        </>
                      )}
                      {sub && <span className={styles.sub}>{sub}</span>}
                    </td>
                    <td className={`${styles.num} ${styles.amount}`}>
                      <Money n={t.amount} />
                    </td>
                    <td className={styles.num}>{t.balanceAfter == null ? '—' : <Money n={t.balanceAfter} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {history?.ok && history.txns.length > 0 && <p className={styles.foot}>To change or void a row, open it in the Financial Ledger.</p>}

      {moving && s && row.personId != null && (
        <MoveDialog
          name={row.name}
          personId={row.personId}
          amount={s.balance}
          onCancel={() => setMoving(false)}
          onDone={() => {
            setMoving(false);
            setReload((n) => n + 1);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

function MoveDialog({
  name,
  personId,
  amount,
  onCancel,
  onDone
}: {
  name: string;
  personId: number;
  amount: number;
  onCancel: () => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const first = name.split(' ')[0];
  return (
    <Dialog ref={ref} aria-labelledby={titleId} onClose={onCancel}>
      <DialogHeader title={<span id={titleId}>Move {first}&rsquo;s {accountMoney(amount)} to the troop fund?</span>} />
      <DialogBody>
        <p>
          {name}&rsquo;s account goes to $0.00 and the troop&rsquo;s available funds go up by {accountMoney(amount)}. It is
          recorded today as a Transfer on their account. To undo it, void that row in the Financial Ledger.
        </p>
        {error && <Notice>{error}</Notice>}
      </DialogBody>
      <DialogActions>
        <Button disabled={pending} onClick={() => ref.current?.close()}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              try {
                const res = await moveScoutAccountToTroopAction({ personId });
                if (res.ok) onDone();
                else setError(res.error);
              } catch {
                setError('Couldn’t move the balance. Nothing was changed — try again.');
              }
            })
          }
        >
          {pending ? 'Moving…' : `Move ${accountMoney(amount)}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
