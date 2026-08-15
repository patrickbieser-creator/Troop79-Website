/**
 * Renders the stored typography tokens as a `:root` custom-property block.
 *
 * Server Component. Mounted in the public layout and the admin workspace layout
 * so the live editor preview and the published page agree — the same reason
 * ArticleBody itself is shared.
 *
 * `tokensToCss` re-validates every value before it is emitted, so this cannot
 * become an injection point even if a row were written by some path that
 * skipped the form. Anything that fails is dropped and the stylesheet's own
 * fallback applies.
 */

import { tokensToCss } from '@/lib/article-tokens';
import { loadArticleTokens } from '@/lib/article-tokens-server';

export async function ArticleStyleTokens() {
  const css = tokensToCss(await loadArticleTokens());
  if (!css) return null;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
