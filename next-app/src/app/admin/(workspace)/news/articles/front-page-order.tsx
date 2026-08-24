'use client';

/**
 * "Front page order" (Patrick, 2026-08-21): drag the featured stories and
 * promoted events into the order they should appear on the home page; the
 * first is the hero. Anything not in the list follows by date. Built on the
 * shared SortableList (arrows + drag and drop); Save writes featured/
 * featured_order through saveFrontPageOrder.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SortableList, type SortableItem } from '../../_components/sortable-list';
import { Notice } from '../../_components/notice';
import { SaveButton, SaveFeedback, useSavedSnapshot, useSavePhase } from '../../_components/save-state';
import { saveFrontPageOrder } from './actions';
import styles from './articles.module.css';

export interface FrontPageItem extends SortableItem {
  kind: 'article' | 'event';
  id: number;
}

export function FrontPageOrder({ ordered, available }: { ordered: FrontPageItem[]; available: FrontPageItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState<FrontPageItem[]>(ordered);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Save standard (2026-08-24): dirty = the order differs from what is saved.
  const { dirty, markSaved } = useSavedSnapshot(items.map((i) => `${i.kind}:${i.id}`).join(','));
  const feedback = useSavePhase();

  function change(next: FrontPageItem[]) {
    setItems(next);
  }

  function save() {
    setErr(null);
    feedback.start();
    start(async () => {
      const res = await saveFrontPageOrder(items.map((i) => ({ kind: i.kind, id: i.id })));
      if (!res.ok) {
        feedback.fail();
        setErr(res.error ?? 'Could not save the order.');
        return;
      }
      markSaved();
      feedback.done();
      router.refresh();
    });
  }

  return (
    <section className={styles.frontPagePanel} aria-label="Front page order">
      <div className={styles.frontPageHead}>
        <h2 className={styles.frontPageTitle}>Front page order</h2>
        <div className={styles.frontPageActions}>
          <SaveButton
            className={styles.frontPageSave}
            dirty={dirty}
            pending={pending}
            dirtyLabel="Save order"
            onClick={save}
          />
          <SaveFeedback phase={feedback.phase} />
        </div>
      </div>
      <p className={styles.frontPageHint}>
        Drag to arrange (or use the arrows). The first item is the home page hero; the rest follow
        in this order, then everything else newest-first. Add a story or promoted event from the
        list below; remove one to let it fall back into date order.
      </p>
      {err && <Notice variant="error">{err}</Notice>}
      <SortableList
        items={items}
        onChange={change}
        available={available}
        addLabel="Add to front page"
        emptyLabel="Nothing pinned — the home page runs newest-first."
      />
    </section>
  );
}
