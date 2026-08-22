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
import type { NewsCategory } from '@/lib/news-feed';
import styles from './news-controls.module.css';

/** Categories come from the ONE taxonomy shared with the calendar
 *  (calendar_categories, 2026-08-21) — only those with content, via
 *  loadCategoryCloud. The /tags/<slug> URL shape is kept. */
export function TagFilter({ tags, currentSlug }: { tags: NewsCategory[]; currentSlug?: string }) {
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
        <option value="">All categories</option>
        {tags.map((t) => (
          <option key={t.slug} value={t.slug}>
            {t.label}
          </option>
        ))}
      </select>
    </form>
  );
}
