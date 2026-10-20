'use client';

/**
 * EmailOctopus sync screen: what a sync would change, then one Sync now. Sync
 * is a one-click action (not a form), greyed only when there is nothing to do.
 * Nobody is added to the list unless their box is ticked (Patrick, 2026-10-20);
 * name updates and recorded unsubscribes always go.
 */
import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { FormPanel } from '../../_components/form-panel';
import { Button } from '../../_components/button';
import { Notice } from '../_components/notice';
import type { NewsletterPreview, NewsletterSyncResult } from './actions';
import styles from './newsletter.module.css';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function NewsletterSyncView({
  preview,
  syncAction
}: {
  preview: NewsletterPreview;
  syncAction: (addEmails: string[]) => Promise<NewsletterSyncResult>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<NewsletterSyncResult | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());

  if (!preview.ok) {
    return (
      <FormPanel title="Sync">
        <Notice variant="error">{preview.error}</Notice>
      </FormPanel>
    );
  }
  const { plan, listSize } = preview;
  const toAdd = plan.add.filter((a) => picked.has(a.email));
  const changes = toAdd.length + plan.rename.length + plan.markUnsubscribed.length;
  const nothingPending = plan.add.length + plan.rename.length + plan.markUnsubscribed.length === 0;
  const allPicked = plan.add.length > 0 && toAdd.length === plan.add.length;

  function toggle(email: string) {
    setPicked((was) => {
      const next = new Set(was);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  function sync() {
    startTransition(async () => {
      setResult(await syncAction(toAdd.map((a) => a.email)));
      setPicked(new Set());
      router.refresh();
    });
  }

  return (
    <div className={styles.stack}>
      <FormPanel title="Sync">
        <p className={styles.summary}>
          {plural(listSize, 'contact')} on the list. {plural(plan.unchanged, 'address', 'addresses')} already match People
          {plan.onListOnly ? `; ${plan.onListOnly} on the list aren’t in People and are left alone` : ''}.
        </p>
        <div className={styles.syncRow}>
          <Button
            variant="primary"
            onClick={sync}
            disabled={isPending || changes === 0}
            title={changes === 0 ? (nothingPending ? 'Nothing to sync' : 'Tick the people to add first') : undefined}
          >
            {isPending ? 'Syncing…' : nothingPending ? 'In sync' : `Sync now (${changes})`}
          </Button>
          {result?.ok && (
            <span className={styles.done}>
              Added {result.added}, updated {result.renamed} {result.renamed === 1 ? 'name' : 'names'}, recorded {result.unsubscribed}{' '}
              {result.unsubscribed === 1 ? 'unsubscribe' : 'unsubscribes'}.
            </span>
          )}
        </div>
        {result && !result.ok && <Notice variant="error">{result.error}</Notice>}
        {result?.ok && result.failures.length > 0 && (
          <Notice variant="warning">
            {plural(result.failures.length, 'address', 'addresses')} failed: {result.failures.join('; ')}
          </Notice>
        )}
      </FormPanel>

      <Section title="To add" count={plan.add.length} sub="Tick everyone you want added. Nobody is added without a tick.">
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.pickCell}>
                <input
                  type="checkbox"
                  aria-label="Add everyone"
                  checked={allPicked}
                  disabled={isPending}
                  onChange={() => setPicked(allPicked ? new Set() : new Set(plan.add.map((a) => a.email)))}
                />
              </th>
              <th>Email</th>
              <th>Name</th>
            </tr>
          </thead>
          <tbody>
            {plan.add.map((a) => (
              <tr key={a.email}>
                <td className={styles.pickCell}>
                  <input
                    type="checkbox"
                    aria-label={`Add ${a.email}`}
                    checked={picked.has(a.email)}
                    disabled={isPending}
                    onChange={() => toggle(a.email)}
                  />
                </td>
                <td>{a.email}</td>
                <td>
                  {a.firstName} {a.lastName}
                  {a.personIds.length > 1 ? ` (shared by ${a.personIds.length} people)` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Name updates" count={plan.rename.length}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Email</th>
              <th>On the list</th>
              <th>In People</th>
            </tr>
          </thead>
          <tbody>
            {plan.rename.map((r) => (
              <tr key={r.email}>
                <td>{r.email}</td>
                <td>{`${r.wasFirst} ${r.wasLast}`.trim() || '—'}</td>
                <td>
                  {r.firstName} {r.lastName}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Unsubscribed in EmailOctopus" count={plan.markUnsubscribed.length} sub="Recorded here so no sync adds them back.">
        <ul className={styles.list}>
          {plan.markUnsubscribed.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, count, sub, children }: { title: string; count: number; sub?: string; children: ReactNode }) {
  return (
    <FormPanel title={`${title} (${count})`} note={count ? sub : undefined}>
      {count === 0 ? <p className={styles.none}>None.</p> : children}
    </FormPanel>
  );
}
