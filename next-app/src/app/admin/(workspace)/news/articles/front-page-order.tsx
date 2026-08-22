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
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { saveFrontPageOrder } from './actions';
import styles from './articles.module.css';

export interface FrontPageItem extends SortableItem {
  kind: 'article' | 'event';
  id: number;
}

export function FrontPageOrder({ ordered, available }: { ordered: FrontPageItem[]; available: FrontPageItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState<FrontPageItem[]>(ordered);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  function change(next: FrontPageItem[]) {
    setItems(next);
    setDirty(true);
    setSaved(false);
  }

  function save() {
    setErr(null);
    start(async () => {
      const res = await saveFrontPageOrder(items.map((i) => ({ kind: i.kind, id: i.id })));
      if (!res.ok) {
        setErr(res.error ?? 'Could not save the order.');
        return;
      }
      setDirty(false);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <section className={styles.frontPagePanel} aria-label="Front page order">
      <div className={styles.frontPageHead}>
        <h2 className={styles.frontPageTitle}>Front page order</h2>
        <div className={styles.frontPageActions}>
          {saved && !dirty && <Badge variant="success">Saved</Badge>}
          <button
            type="button"
            className={styles.frontPageSave}
            disabled={!dirty || pending}
            onClick={save}
          >
            {pending ? 'Saving…' : 'Save order'}
          </button>
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
