import { describe, it, expect } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * ONE taxonomy (Patrick, 2026-08-21: "One taxonomy for both, please"):
 * calendar_categories is the vocabulary for events, photo albums, news
 * articles (article_categories) and — optionally — library resources. The
 * old tags/article_tags are gone. Requires local Supabase.
 */
describe('one taxonomy — schema (db)', () => {
  it('CalendarCategories_CarryAGeneratedSlug_ThatTracksTheLabel', async () => {
    const admin = adminClient();
    const label = 'ZZVITEST Taxonomy Probe / One';
    try {
      const ins = await admin.from('calendar_categories').insert({ label, color: '#6d7580', sort_order: 9990 });
      expect(ins.error).toBeNull();
      const { data } = await admin.from('calendar_categories').select('slug').eq('label', label).single();
      expect(data?.slug).toBe('zzvitest-taxonomy-probe-one');
      const up = await admin.from('calendar_categories').update({ label: label + ' Two' }).eq('label', label);
      expect(up.error).toBeNull();
      const { data: after } = await admin.from('calendar_categories').select('slug').eq('label', label + ' Two').single();
      expect(after?.slug).toBe('zzvitest-taxonomy-probe-one-two');
    } finally {
      await admin.from('calendar_categories').delete().like('label', 'ZZVITEST Taxonomy Probe%');
    }
  });

  it('ArticleCategories_LinksArticlesToCategories_RenamesCascade_AndDeleteIsBlockedWhileInUse', async () => {
    const admin = adminClient();
    const label = 'ZZVITEST Taxonomy Cat';
    let articleId: number | null = null;
    try {
      await admin.from('calendar_categories').insert({ label, color: '#6d7580', sort_order: 9991 });
      const { data: art, error: artErr } = await admin
        .from('articles')
        .insert({
          slug: 'zzvitest-taxonomy-article',
          title: 'ZZVITEST',
          type: 'news',
          author_name: 'vitest',
          author_role: 'leader',
          body: ''
        })
        .select('id')
        .single();
      expect(artErr).toBeNull();
      articleId = art!.id;
      const link = await admin.from('article_categories').insert({ article_id: articleId, category_label: label });
      expect(link.error).toBeNull();

      // delete of an in-use category is refused (restrict)
      const del = await admin.from('calendar_categories').delete().eq('label', label);
      expect(del.error).not.toBeNull();

      // rename cascades to the join row
      await admin.from('calendar_categories').update({ label: label + ' Renamed' }).eq('label', label);
      const { data: rows } = await admin.from('article_categories').select('category_label').eq('article_id', articleId);
      expect(rows?.[0]?.category_label).toBe(label + ' Renamed');
    } finally {
      if (articleId) await admin.from('articles').delete().eq('id', articleId);
      await admin.from('calendar_categories').delete().like('label', 'ZZVITEST Taxonomy Cat%');
    }
  });

  it('TagsTables_AreGone', async () => {
    const admin = adminClient();
    const { error } = await admin.from('tags').select('id').limit(1);
    expect(error).not.toBeNull();
  });

  it('LibraryResources_CanCarryACategory', async () => {
    const admin = adminClient();
    const { error } = await admin.from('library_resources').select('id, category_label').limit(1);
    expect(error).toBeNull();
  });
});
