import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';
import type { Article, Media } from '@/lib/supabase/types';
import { ArticleEditor, type CategoryOption } from './article-editor';

export default async function ArticleEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Was reading the leader cookie directly, which bounced an identity actor
  // to /admin/login even when they held news.write (Phase C, 2026-08-16).
  const session = await requireCapability('news.write');

  const supabase = createAdminClient();
  // The ONE taxonomy (2026-08-21): news picks from Calendar Categories.
  const { data: cats } = await supabase
    .from('calendar_categories')
    .select('label, color')
    .order('sort_order', { ascending: true });
  const allCategories = (cats ?? []) as CategoryOption[];

  if (id === 'new') {
    return (
      <ArticleEditor
        article={null}
        selectedCategories={[]}
        heroMedia={null}
        allCategories={allCategories}
        sessionName={session.label}
      />
    );
  }

  const articleId = Number(id);
  if (!Number.isFinite(articleId)) notFound();

  const { data: article, error } = await supabase
    .from('articles')
    .select('*, article_categories(category_label), hero_media:hero_media_id(*)')
    .eq('id', articleId)
    .single();
  if (error || !article) notFound();

  const { article_categories, hero_media, ...articleFields } = article as Article & {
    article_categories: { category_label: string }[];
    hero_media: Media | null;
  };
  const selectedCategories = (article_categories ?? []).map((c) => c.category_label);

  return (
    <ArticleEditor
      article={articleFields as Article}
      selectedCategories={selectedCategories}
      heroMedia={hero_media}
      allCategories={allCategories}
      sessionName={session.label}
    />
  );
}
