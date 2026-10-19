'use client';

/**
 * Recent teaching-skill changes (Phase 0b of Plans/Meeting-Requests-And-Teaching-Offers.md). Every add or remove, from
 * the member page or from this screen, lands here. Nothing waits for approval: Undo reverses one change (and is
 * logged), Mark reviewed clears it from the admin-home count. "To look at" = member changes not yet reviewed or undone.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SegmentedControl } from '../../_components/segmented-control';
import { Badge } from '../../_components/badge';
import { Button } from '../../../_components/button';
import { fmtDateTime } from '@/lib/format-date';
import type { TeachingSkillChangeRow } from '@/lib/teaching-skills';
import styles from './lookups.module.css';

type ActionResult = { ok: boolean; error?: string; message?: string };

const FROM: Record<TeachingSkillChangeRow['source'], string> = { member: 'Member page', admin: 'Admin', undo: 'Undo' };

export function TeachingChanges({
  toReview,
  all,
  onUndo,
  onMarkReviewed
}: {
  toReview: TeachingSkillChangeRow[];
  all: TeachingSkillChangeRow[];
  onUndo: (id: number) => Promise<ActionResult>;
  onMarkReviewed: (id: number) => Promise<ActionResult>;
}) {
  const [filter, setFilter] = useState<'review' | 'all'>(toReview.length ? 'review' : 'all');
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<{ id: number; text: string; bad: boolean } | null>(null);
  const [, start] = useTransition();
  const router = useRouter();
  const rows = filter === 'review' ? toReview : all;

  function run(id: number, act: (id: number) => Promise<ActionResult>, done: string) {
    setBusy(id);
    setNote(null);
    start(async () => {
      const res = await act(id);
      setBusy(null);
      setNote({ id, text: res.ok ? (res.message ?? done) : (res.error ?? 'Not saved'), bad: !res.ok });
      if (res.ok) router.refresh();
    });
  }

  return (
    <>
      <div className={styles.cardToolbar}>
        <SegmentedControl
          name="teaching-changes-filter"
          label="Which changes"
          value={filter}
          options={[
            { value: 'review', label: `To look at (${toReview.length})` },
            { value: 'all', label: 'All' }
          ]}
          onChange={setFilter}
        />
      </div>
      <p role="status" aria-live="polite" className={note?.bad ? styles.rowError : styles.cardSub}>
        {note?.text ?? ''}
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>When</th>
            <th>Whose skills</th>
            <th>Change</th>
            <th>From</th>
            <th className={styles.cellRight} aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className={styles.emptyCell}>
                {filter === 'review' ? 'Nothing to look at.' : 'No teaching-skill changes yet.'}
              </td>
            </tr>
          ) : (
            rows.map((c) => (
              <tr key={c.id}>
                <td>{fmtDateTime(c.changedAt)}</td>
                <td>
                  {c.personName}
                  {c.personSub && <div className={styles.personSub}>{c.personSub}</div>}
                </td>
                <td>
                  {c.action === 'added' ? 'Added' : 'Removed'} {c.skillName}
                </td>
                <td>
                  {FROM[c.source]}
                  {c.byOther && c.byLabel ? `, by ${c.byLabel}` : ''}
                </td>
                <td className={styles.cellRight}>
                  {c.reverted ? (
                    <Badge variant="muted">Undone</Badge>
                  ) : c.source === 'undo' ? null : (
                    <span className={styles.rowActions}>
                      <Button variant="quiet" size="sm" disabled={busy === c.id} onClick={() => run(c.id, onUndo, 'Undone.')}>
                        Undo
                      </Button>
                      {c.reviewed ? (
                        <Badge variant="success">Reviewed</Badge>
                      ) : (
                        <Button variant="quiet" size="sm" disabled={busy === c.id} onClick={() => run(c.id, onMarkReviewed, 'Marked reviewed.')}>
                          Mark reviewed
                        </Button>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}
