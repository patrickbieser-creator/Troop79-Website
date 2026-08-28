import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Cache-invalidation scope guard (Plans/Performance-Review-2026-08-27.md #8/#9).
 *
 * `revalidatePath` on a dynamic route only refreshes the client router cache,
 * which admin screens rely on — so most of the 37 sites are fine and stay.
 * Two things did hurt and must not come back:
 *
 * 1. `revalidatePath('/', 'layout')` throws away every cached page on the
 *    site. Only the two site-wide settings saves (article typography, SEO
 *    settings — rare, and they DO change every page) may do that; a patrol
 *    change or a signup must not.
 * 2. `/events` is the one ISR page. The public signup actions used to purge it
 *    on every submit and cancel, though the list shows no signup data.
 *
 * And the two layout-level reads that every public page pays for must stay
 * behind the tagged cache, with the saves that change them expiring the tag.
 */
const SRC = join(__dirname, '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => p.slice(SRC.length + 1).replace(/\\/g, '/');

describe('revalidation scope', () => {
  it('OnlyTheSiteWideSettingsSaves_PurgeTheWholeLayout', () => {
    const sites = walk(join(SRC, 'app'))
      .filter((p) => readFileSync(p, 'utf8').includes("revalidatePath('/', 'layout')"))
      .map(rel);
    expect(sites).toEqual(['app/admin/(workspace)/advancement/lookups/actions.ts']);
    const src = readFileSync(join(SRC, 'app/admin/(workspace)/advancement/lookups/actions.ts'), 'utf8');
    expect(src.split("revalidatePath('/', 'layout')").length - 1).toBe(2);
  });

  it('PublicSignupActions_DoNotPurgeTheEventsList', () => {
    const src = readFileSync(join(SRC, 'app/(public)/events/[id]/actions.ts'), 'utf8');
    expect(src).not.toContain("revalidatePath('/events')");
  });

  it('LayoutReads_AreTagCached_AndTheirSavesExpireTheTag', () => {
    const settings = readFileSync(join(SRC, 'lib/site-settings.ts'), 'utf8');
    const tokens = readFileSync(join(SRC, 'lib/article-tokens-server.ts'), 'utf8');
    expect(settings).toMatch(/unstable_cache\([\s\S]*tags: \['site-settings'\]/);
    expect(tokens).toMatch(/unstable_cache\([\s\S]*tags: \['article-tokens'\]/);

    const actions = readFileSync(join(SRC, 'app/admin/(workspace)/advancement/lookups/actions.ts'), 'utf8');
    const body = (name: string) => {
      const start = actions.indexOf(`export async function ${name}(`);
      const end = actions.indexOf('\nexport async function', start + 1);
      return actions.slice(start, end === -1 ? undefined : end);
    };
    expect(body('saveArticleTokens')).toContain("updateTag('article-tokens')");
    expect(body('saveSiteText')).toContain("updateTag('site-settings')");
    expect(body('saveSeoSettings')).toContain("updateTag('site-settings')");
  });

  it('AdvancementCatalogIsTagCached_AndItsLookupsSavesExpireTheTag', () => {
    // Plans/Performance-Review-2026-08-27.md #11/#16: ranks, rank_requirements,
    // merit_badges and merit_badge_requirements only change via a Lookups save
    // — every writer of those tables must expire the one shared tag or the
    // Agenda tab / Ledger / Dashboard would keep serving a stale catalog.
    const catalog = readFileSync(join(SRC, 'lib/advancement-catalog.ts'), 'utf8');
    expect(catalog).toMatch(/unstable_cache\([\s\S]*tags: \['advancement-catalog'\]/);

    const actions = readFileSync(join(SRC, 'app/admin/(workspace)/advancement/lookups/actions.ts'), 'utf8');
    const body = (name: string) => {
      const start = actions.indexOf(`export async function ${name}(`);
      const end = actions.indexOf('\nexport async function', start + 1);
      return actions.slice(start, end === -1 ? undefined : end);
    };
    for (const fn of ['updateMeritBadge', 'createSkill', 'updateSkill', 'deleteSkill', 'updateReqCode']) {
      expect(body(fn)).toContain("updateTag('advancement-catalog')");
    }
  });
});
