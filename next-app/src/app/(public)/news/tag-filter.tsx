'use client';

/**
 * Tag filter as a dropdown (Patrick, 2026-08-16).
 *
 * Was a row of pills spanning the full width — with a dozen-plus tags that is
 * a wall of chips above the actual news, and it wrapped badly on a phone. A
 * select collapses it to one control that fits on the section-header line.
 *
 * Navigation happens on change rather than behind a Go button: this is a
 * filter, and a filter that needs two interactions gets used half as often.
 * Progressive enhancement is deliberate — without JS the select still submits
 * via the wrapping form.
 */

import { useRouter } from 'next/navigation';
import type { Tag } from '@/lib/supabase/types';
import styles from './news-controls.module.css';

export function TagFilter({ tags, currentSlug }: { tags: Tag[]; currentSlug?: string }) {
  const router = useRouter();

  return (
    <form
      className={styles.tagFilter}
      action="/tags"
      onSubmit={(e) => e.preventDefault()}
    >
      <label className={styles.tagFilterLabel} htmlFor="tag-filter">
        Filter
      </label>
      <select
        id="tag-filter"
        name="tag"
        className={styles.tagSelect}
        defaultValue={currentSlug ?? ''}
        onChange={(e) => {
          const slug = e.target.value;
          router.push(slug ? `/tags/${slug}` : '/news');
        }}
      >
        <option value="">All topics</option>
        {tags.map((t) => (
          <option key={t.id} value={t.slug}>
            {t.name}
          </option>
        ))}
      </select>
    </form>
  );
}
