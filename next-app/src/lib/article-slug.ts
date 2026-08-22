/**
 * Article slug and byline rules (Patrick, 2026-08-22).
 *
 * THE SLUG BUG THIS FIXES. `updateArticle` regenerated the slug from the title
 * on EVERY save, so editing a published post's title silently changed its
 * public URL. Any link already shared — the Bugle, a text message, a Facebook
 * post — started 404ing, and since v1.74.0 the sitemap actively advertises
 * those URLs to Google. Nothing in the UI ever mentioned a slug, so nobody
 * could have known.
 *
 * THE RULE: a draft's slug follows its title, because nothing links to a draft
 * yet. Publishing FREEZES it. Changing a live URL is still possible, but it
 * becomes a deliberate act via the slug field rather than a side effect of
 * fixing a typo in a headline.
 *
 * Both helpers are pure so the rules are asserted without a database; the
 * uniqueness check stays in the action, where it belongs.
 */

import { slugify } from '@/lib/slugify';
import type { ArticleStatus } from '@/lib/supabase/types';

/** Bylines are names, not essays. */
const MAX_BYLINE = 120;

/**
 * Whether this article's URL is public enough that moving it would break
 * something. 'pending' is a submission awaiting review — it has no public URL
 * yet, so it is still free to follow its title.
 */
export function isSlugFrozen(status: ArticleStatus): boolean {
  return status === 'published';
}

export interface SlugInput {
  title: string;
  /** What the leader typed in the slug field, if anything. */
  manualSlug: string;
  /** The slug currently stored — empty for a new article. */
  currentSlug: string;
  status: ArticleStatus;
}

/**
 * The slug to write, before the uniqueness check.
 *
 * Precedence: an explicit slug always wins (normalized, never trusted raw),
 * then a frozen live URL, then the title.
 */
export function resolveArticleSlug({ title, manualSlug, currentSlug, status }: SlugInput): string {
  const manual = manualSlug.trim();
  if (manual) return slugify(manual);
  if (currentSlug && isSlugFrozen(status)) return currentSlug;
  return slugify(title);
}

/**
 * The byline to store.
 *
 * A blank field means "leave it alone", never "publish this anonymously" —
 * clearing an input is far more often a slip than an intention, and there is
 * no way to recover the original name once it is gone.
 */
export function resolveByline(typed: string, existing: string): string {
  const name = typed.trim();
  if (!name) return existing;
  return name.slice(0, MAX_BYLINE);
}
