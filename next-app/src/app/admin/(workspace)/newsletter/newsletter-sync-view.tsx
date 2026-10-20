'use client';

/**
 * EmailOctopus sync screen: what a sync would change, then one Sync now. Sync
 * is a one-click action (not a form), greyed only when there is nothing to do.
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
  syncAction: () => Promise<NewsletterSyncResult>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<NewsletterSyncResult | null>(null);

  if (!preview.ok) {
    return (
      <FormPanel title="Sync">
        <Notice variant="error">{preview.error}</Notice>
      </FormPanel>
    );
  }
  const { plan, listSize } = preview;
  const changes = plan.add.length + plan.rename.length + plan.markUnsubscribed.length;

  function sync() {
    startTransition(async () => {
      setResult(await syncAction());
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
          <Button variant="primary" onClick={sync} disabled={isPending || changes === 0} title={changes === 0 ? 'Nothing to sync' : undefined}>
            {isPending ? 'Syncing…' : changes === 0 ? 'In sync' : `Sync now (${changes})`}
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

      <Section title="To add" count={plan.add.length}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
            </tr>
          </thead>
          <tbody>
            {plan.add.map((a) => (
              <tr key={a.email}>
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
