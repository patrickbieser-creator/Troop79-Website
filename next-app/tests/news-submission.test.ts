import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { adminClient } from './helpers/admin-client';
import { loadNewsIndex, loadArticleBySlug } from '../src/lib/news-feed';

/**
 * Public story submission (Plans/Unified-Identity-And-Capabilities.md Phase C).
 *
 * The Server Action itself needs a cookie, which this suite has no way to
 * mock (D-049's boundary). What IS testable, and what actually carries the
 * security model, is the two properties below:
 *
 *   1. A 'pending' article is invisible on every public news surface.
 *   2. The submit action writes the status as a LITERAL, never from formData —
 *      so a forged `status=published` in the POST body cannot publish, and a
 *      future refactor that drops a permission check can at worst create a
 *      row nobody sees.
 *
 * (2) is asserted against the source because that is where the property
 * lives. It is the reason review-as-a-filter is safer than a news.publish
 * capability, so it deserves a guard that fails loudly.
 */

describe('news submission', () => {
  let articleIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (articleIds.length > 0) await admin.from('articles').delete().in('id', articleIds);
    articleIds = [];
  });

  async function makeArticle(status: 'pending' | 'draft' | 'published') {
    const admin = adminClient();
    const { data, error } = await admin
      .from('articles')
      .insert({
        slug: `test-submission-probe-${status}-${Date.now()}`,
        title: '[TEST] Submission Probe',
        type: 'news',
        body: 'probe',
        status,
        featured: false,
        author_name: '[TEST] Probe Author',
        author_role: 'scout',
        ...(status === 'published' ? { published_at: new Date().toISOString() } : {})
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: articles insert failed: ${error?.message}`);
    articleIds.push(data.id as number);
    return data.id as number;
  }

  it('PendingArticle_IsAbsentFromThePublicNewsIndex_WhenAwaitingReview', async () => {
    const id = await makeArticle('pending');
    const { rows } = await loadNewsIndex(1, false);
    expect(rows.map((r) => r.id)).not.toContain(id);
  });

  it('PendingArticle_IsAbsentFromTheArchive_Too', async () => {
    // The archive is a second public surface with its own query — a status
    // filter missing there would be just as visible and easier to overlook.
    const id = await makeArticle('pending');
    const { rows } = await loadNewsIndex(1, true);
    expect(rows.map((r) => r.id)).not.toContain(id);
  });

  it('PendingArticle_IsNotReachableByItsPermalink_WhenAwaitingReview', async () => {
    // Same class as the calendar's /events/[id] case: a slug is guessable, so
    // the detail loader has to refuse rather than render. It does because
    // every public reader goes through the articles_public VIEW, which
    // filters status — one choke point rather than a filter per caller.
    const admin = adminClient();
    const id = await makeArticle('pending');
    const { data } = await admin.from('articles').select('slug').eq('id', id).single();
    expect(await loadArticleBySlug((data as { slug: string }).slug)).toBeNull();
  });

  it('PublishedArticle_IsPresent_OnTheSameIndex', async () => {
    const id = await makeArticle('published');
    const { rows } = await loadNewsIndex(1, false);
    expect(rows.map((r) => r.id)).toContain(id);
  });

  it('PendingStatus_IsAcceptedByTheSchema_ForArticlesOnly', async () => {
    // Guards the asymmetry: articles gained 'pending', calendar_entries
    // deliberately did not (no public proposal surface for events).
    const admin = adminClient();
    const { error } = await admin
      .from('calendar_entries')
      .insert({
        entry_date: '2099-08-08',
        title: '[TEST] Should Not Accept Pending',
        category: 'Troop Meeting',
        status: 'pending'
      });
    expect(error).not.toBeNull();
  });

  it('SubmitAction_WritesStatusAsALiteral_NeverFromFormData', () => {
    const src = readFileSync('src/app/(public)/news/submit/actions.ts', 'utf8');
    expect(src).toContain("status: 'pending'");
    // The failure this prevents: someone "helpfully" making status editable.
    expect(src).not.toMatch(/status:\s*(String\()?formData\.get/);
    expect(src).not.toMatch(/formData\.get\(['"]status['"]\)/);
  });

  it('SubmitAction_RequiresAVerifiedPerson_NotJustTheTroopPassword', () => {
    const src = readFileSync('src/app/(public)/news/submit/actions.ts', 'utf8');
    // Proposing is baseline — but baseline means "we know who you are",
    // because the story publishes under their name.
    expect(src).toContain('getIdentitySessionIfValid');
    expect(src).toContain('isEpochCurrent');
    // ...and NOT a capability, which would make proposing a granted privilege.
    expect(src).not.toContain('requireCapability');
  });
});
