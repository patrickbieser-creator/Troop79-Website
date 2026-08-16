import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';
import type { Article, Media, Tag } from '@/lib/supabase/types';
import { ArticleEditor } from './article-editor';

export default async function ArticleEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Was reading the leader cookie directly, which bounced an identity actor
  // to /admin/login even when they held news.write (Phase C, 2026-08-16).
  const session = await requireCapability('news.write');

  const supabase = createAdminClient();
  const { data: tags } = await supabase.from('tags').select('*').order('name');

  if (id === 'new') {
    return (
      <ArticleEditor
        article={null}
        selectedTagIds={[]}
        heroMedia={null}
        allTags={(tags ?? []) as Tag[]}
        sessionName={session.label}
      />
    );
  }

  const articleId = Number(id);
  if (!Number.isFinite(articleId)) notFound();

  const { data: article, error } = await supabase
    .from('articles')
    .select('*, article_tags(tag_id), hero_media:hero_media_id(*)')
    .eq('id', articleId)
    .single();
  if (error || !article) notFound();

  const { article_tags, hero_media, ...articleFields } = article as Article & {
    article_tags: { tag_id: number }[];
    hero_media: Media | null;
  };
  const selectedTagIds = article_tags.map((t) => t.tag_id);

  return (
    <ArticleEditor
      article={articleFields as Article}
      selectedTagIds={selectedTagIds}
      heroMedia={hero_media}
      allTags={(tags ?? []) as Tag[]}
      sessionName={session.label}
    />
  );
}
