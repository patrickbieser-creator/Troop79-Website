'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Tag } from '@/lib/supabase/types';
import { createTag, deleteTag } from './actions';
import { useLookupTable } from './use-lookup-table';
import styles from './lookups.module.css';
import { AddButton } from '../../_components/add-button';

export function TagsManager({ tags }: { tags: Tag[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useLookupTable(tags, (tag) => `${tag.name} ${tag.slug}`, { alwaysSearch: true });

  function handleAdd() {
    const name = inputRef.current?.value.trim();
    if (!name) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('name', name);
      const res = await createTag(fd);
      if (!res.ok) {
        setError(res.error ?? 'Could not add tag.');
        return;
      }
      if (inputRef.current) inputRef.current.value = '';
      setAdding(false);
      router.refresh();
    });
  }

  function cancelAdd() {
    if (inputRef.current) inputRef.current.value = '';
    setError(null);
    setAdding(false);
  }

  function handleDelete(id: number, name: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteTag(id);
      if (!res.ok) {
        setError(res.error ?? `Could not delete "${name}".`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <div className={styles.cardToolbar}>
        {t.searchEl}
        <AddButton onClick={() => setAdding(true)}>+ Add Tag</AddButton>
      </div>

      {adding && (
        <div className={styles.addPanel}>
          <input
            ref={inputRef}
            type="text"
            className={`${styles.editInput} ${styles.inputMax220}`}
            placeholder="New tag name…"
            autoFocus
            disabled={isPending}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') {
                e.preventDefault();
                cancelAdd();
              }
            }}
          />
          <div className={styles.addPanelActions}>
            <button type="button" className={styles.editBtn} onClick={cancelAdd} disabled={isPending}>
              Cancel
            </button>
            <AddButton onClick={handleAdd} disabled={isPending}>
              Add Tag
            </AddButton>
          </div>
        </div>
      )}

      {error && <div className={styles.tagError}>{error}</div>}

      <div className={t.scrollClass}>
        <div className={styles.tagList}>
          {t.rows.map((row) => (
            <div key={row.id} className={styles.tagRow}>
              <span>
                {row.name}
                <span className={styles.tagSlug}>/{row.slug}</span>
              </span>
              <button
                type="button"
                className={styles.tagDeleteBtn}
                disabled={isPending}
                onClick={() => {
                  if (
                    window.confirm(`Delete "${row.name}"? It will be removed from any article that has it.`)
                  ) {
                    handleDelete(row.id, row.name);
                  }
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>
      {t.footerEl}
    </>
  );
}
