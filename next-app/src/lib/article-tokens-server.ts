/**
 * Server side of the article typography tokens.
 *
 * Split from `lib/article-tokens.ts` because the admin editor is a Client
 * Component and must not pull the service-role client into the browser bundle —
 * the same split as calendar.ts / calendar-shared.ts and attendance.ts /
 * attendance-shared.ts.
 */

import { cache } from 'react';
import { createAdminClient } from '@/lib/supabase/server';
import type { TokenValues } from '@/lib/article-tokens';

/**
 * Stored token values.
 *
 * Returns {} on error rather than throwing: a styling table that fails to load
 * should leave the prose looking like the stylesheet says, not take down every
 * article page. This is the one place a swallowed error is the right call —
 * the fallback is complete and correct by construction.
 */
export const loadArticleTokens = cache(async function loadArticleTokens(): Promise<TokenValues> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('article_style_tokens').select('token, value');
  if (error || !data) return {};
  const out: TokenValues = {};
  for (const row of data as { token: string; value: string }[]) {
    out[row.token] = row.value;
  }
  return out;
});
