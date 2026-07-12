import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import type { Article, Media, Tag } from '@/lib/supabase/types';
import { ArticleEditor } from './article-editor';

export default async function ArticleEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jar = await cookies();
  const session = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  if (!session) redirect('/admin/login');

  const supabase = createAdminClient();
  const { data: tags } = await supabase.from('tags').select('*').order('name');

  if (id === 'new') {
    return (
      <ArticleEditor
        article={null}
        selectedTagIds={[]}
        heroMedia={null}
        allTags={(tags ?? []) as Tag[]}
        sessionRole={session.role}
        sessionName={session.leader}
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

  const canEdit = session.role === 'leader' || article.author_name === session.leader;
  if (!canEdit) redirect('/admin/news/articles');

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
      sessionRole={session.role}
      sessionName={session.leader}
    />
  );
}
