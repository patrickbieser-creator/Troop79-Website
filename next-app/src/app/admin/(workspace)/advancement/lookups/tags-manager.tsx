'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Tag } from '@/lib/supabase/types';
import { createTag, deleteTag } from './actions';
import styles from './lookups.module.css';

export function TagsManager({ tags }: { tags: Tag[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

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
      router.refresh();
    });
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
      <div className={styles.tagAddForm}>
        <input
          ref={inputRef}
          type="text"
          placeholder="New tag name…"
          disabled={isPending}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
        />
        <button type="button" className={styles.tagAddBtn} disabled={isPending} onClick={handleAdd}>
          + Add Tag
        </button>
      </div>
      {error && <div className={styles.tagError}>{error}</div>}

      <div className={styles.tagList}>
        {tags.map((t) => (
          <div key={t.id} className={styles.tagRow}>
            <span>
              {t.name}
              <span className={styles.tagSlug}>/{t.slug}</span>
            </span>
            <button
              type="button"
              className={styles.tagDeleteBtn}
              disabled={isPending}
              onClick={() => {
                if (window.confirm(`Delete "${t.name}"? It will be removed from any article that has it.`)) {
                  handleDelete(t.id, t.name);
                }
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
