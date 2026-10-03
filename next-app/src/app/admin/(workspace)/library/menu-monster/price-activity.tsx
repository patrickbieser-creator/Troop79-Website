'use client';

/**
 * Scout-reported prices, the leader side (Plans/Menu-Monster-Scout-Workspace.md,
 * "Phase 2 design"; approved design: concept-e admin.html).
 *
 *  - Needs attention: prices a scout reported outside the ±50% band (or against
 *    a package with no yield). Apply puts the price in the book with the
 *    scout's credit; Dismiss keeps the current one. The status line carries
 *    Undo after an Apply (a revert); a Dismissed price stays dismissed.
 *  - Packages waiting (release C): packages scouts added that fell outside the
 *    band (or had nothing to compare with). Per unit shows the package against
 *    the cheapest live package of its ingredient. Approve puts it in the book;
 *    Reject deletes it, or retires it when a menu still names it.
 *  - Price changes: the 50 most recent changes, newest first. An applied row
 *    can be reverted from its ⋯ menu while the package still carries that
 *    price; once a later change moved it, Revert is greyed and a help badge
 *    says why.
 *
 * The decisions are server actions gated by library.moderate (actions.ts);
 * this panel only sends the row id.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../_components/button';
import { HelpBadge } from '../../../_components/help-badge';
import { ActionsMenu } from '../../_components/actions-menu';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { fmtDate } from '@/lib/format-date';
import type { HeldPrice, PriceChange } from '@/lib/menu-monster/price-history';
import type { HeldPackage } from '@/lib/menu-monster/scout-packages-store';
import { applyHeldPrice, approveHeldPackage, dismissHeldPrice, rejectHeldPackage, revertPriceChange, type PriceDecisionResult } from './actions';
import styles from './menu-monster.module.css';

/** Always cents: a $4.00 → $4.50 change must not read as "$4 → $4.50". */
const money = (n: number) => `$${n.toFixed(2)}`;

function pct(p: number | null): string {
  if (p == null) return 'Not comparable';
  const n = Math.round(Math.abs(p) * 100);
  return `${p < 0 ? '−' : '+'}${n}%`;
}

type Line = { kind: 'ok'; text: string; undoId?: string } | { kind: 'error'; text: string };

export function PriceActivity({ held, heldPackages = [], changes }: { held: HeldPrice[]; heldPackages?: HeldPackage[]; changes: PriceChange[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [line, setLine] = useState<Line | null>(null);

  function run(
    action: () => Promise<PriceDecisionResult>,
    okText: string,
    opts: { undoable?: boolean } = {}
  ) {
    setLine(null);
    start(async () => {
      const res = await action();
      if (!res.ok) {
        setLine({ kind: 'error', text: res.error ?? 'Something went wrong.' });
        return;
      }
      setLine({ kind: 'ok', text: okText, ...(opts.undoable && res.historyId ? { undoId: res.historyId } : {}) });
      router.refresh();
    });
  }

  return (
    <div className={styles.activity}>
      {line?.kind === 'error' && <Notice>{line.text}</Notice>}
      {line?.kind === 'ok' && (
        <Notice variant="success">
          {line.text}
          {line.undoId && (
            <>
              {' '}
              <Button
                variant="quiet"
                disabled={pending}
                onClick={() => run(() => revertPriceChange(line.undoId!), 'Undone. The old price is back.')}
              >
                Undo
              </Button>
            </>
          )}
        </Notice>
      )}

      <section className={styles.activitySection} aria-labelledby="mm-held-title">
        <div className={styles.activityHead}>
          <h2 id="mm-held-title" className={styles.activityTitle}>
            Needs attention
          </h2>
          {held.length > 0 && <Badge variant="warning">{held.length}</Badge>}
          <HelpBadge id="menu-monster.held" />
        </div>
        {held.length === 0 ? (
          <p className={styles.emptyLine}>Nothing is waiting on you.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Package</th>
                  <th>Reported by</th>
                  <th>Menu</th>
                  <th className={styles.numCell}>Price</th>
                  <th className={styles.numCell}>Per unit</th>
                  <th className={styles.actionsCell}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {held.map((h) => (
                  <tr key={h.id}>
                    <td>{h.packageName}</td>
                    <td>{h.reporter}</td>
                    <td className={h.menuName ? undefined : styles.muted}>{h.menuName ?? '—'}</td>
                    <td className={styles.numCell}>{`${money(h.currentPrice)} → ${money(h.proposedPrice)}`}</td>
                    <td className={styles.numCell}>{pct(h.unitChangePct)}</td>
                    <td className={styles.actionsCell}>
                      <span className={styles.rowActions}>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={pending}
                          onClick={() => run(() => applyHeldPrice(h.id), `Applied ${money(h.proposedPrice)} for “${h.packageName}”.`, { undoable: true })}
                        >
                          Apply
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={pending}
                          onClick={() => run(() => dismissHeldPrice(h.id), `Dismissed ${h.reporter}’s price for “${h.packageName}”. The current price stays.`)}
                        >
                          Dismiss
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {heldPackages.length > 0 && (
        <section className={styles.activitySection} aria-labelledby="mm-held-pkg-title">
          <div className={styles.activityHead}>
            <h2 id="mm-held-pkg-title" className={styles.activityTitle}>
              Packages waiting
            </h2>
            <Badge variant="warning">{heldPackages.length}</Badge>
            <HelpBadge id="menu-monster.held-package" />
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Package</th>
                  <th>Added by</th>
                  <th className={styles.numCell}>Price</th>
                  <th className={styles.numCell}>Per unit</th>
                  <th className={styles.actionsCell}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {heldPackages.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.ingredientName}: {p.name}
                      {p.store ? ` (${p.store})` : ''}
                      <span className={styles.muted}>
                        {' '}
                        · {p.size} {p.unitMany}
                      </span>
                    </td>
                    <td>{p.addedBy}</td>
                    <td className={styles.numCell}>{money(p.price)}</td>
                    <td className={styles.numCell}>
                      {money(p.unitPrice)}
                      {p.cheapestUnitPrice != null ? ` (${pct((p.unitPrice - p.cheapestUnitPrice) / p.cheapestUnitPrice)} vs ${money(p.cheapestUnitPrice)})` : ' (nothing to compare)'}
                    </td>
                    <td className={styles.actionsCell}>
                      <span className={styles.rowActions}>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={pending}
                          onClick={() => run(() => approveHeldPackage(p.id), `Approved “${p.name}” for ${p.ingredientName}. It’s in the price book.`)}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={pending}
                          onClick={() => run(() => rejectHeldPackage(p.id), `Rejected ${p.addedBy}’s “${p.name}”.`)}
                        >
                          Reject
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className={styles.activitySection} aria-labelledby="mm-changes-title">
        <div className={styles.activityHead}>
          <h2 id="mm-changes-title" className={styles.activityTitle}>
            Price changes
          </h2>
        </div>
        {changes.length === 0 ? (
          <p className={styles.emptyLine}>No price changes yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Package</th>
                  <th>Reported by</th>
                  <th>When</th>
                  <th className={styles.numCell}>Old → new</th>
                  <th>Status</th>
                  <th className={styles.actionsCell}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.id}>
                    <td>{c.packageName}</td>
                    <td>{c.reporter}</td>
                    <td>{fmtDate(c.createdAt)}</td>
                    <td className={styles.numCell}>{`${money(c.oldPrice)} → ${money(c.newPrice)}`}</td>
                    <td>{c.status === 'reverted' ? <Badge variant="muted">Reverted</Badge> : <Badge variant="success">Applied</Badge>}</td>
                    <td className={styles.actionsCell}>
                      {c.status === 'applied' && (
                        <span className={styles.rowActions}>
                          {!c.canRevert && <HelpBadge id="menu-monster.superseded" />}
                          <ActionsMenu
                            ariaLabel={`More for ${c.packageName}`}
                            placeholder="⋯"
                            disabled={pending}
                            options={[
                              { value: 'revert', label: `Revert to ${money(c.oldPrice)}`, disabled: !c.canRevert }
                            ]}
                            onAction={() =>
                              run(() => revertPriceChange(c.id), `Reverted “${c.packageName}” to ${money(c.oldPrice)}.`)
                            }
                          />
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
