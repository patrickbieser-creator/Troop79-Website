import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';
import { buildPagesTree, SITE_PAGE_COLUMNS, type SitePage } from '@/lib/site-pages-tree';
import { PageEditor } from './page-editor';
import { NewPageForm } from './new-page-form';

export default async function PageEditPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ parent?: string }>;
}) {
  const { id } = await params;
  await requireCapability('news.write');
  const supabase = createAdminClient();

  if (id === 'new') {
    const { parent } = await searchParams;
    const { data } = await supabase.from('site_pages').select('id, parent_id, title, path, sort_order');
    const options = buildPagesTree(data ?? []).map(({ row, depth }) => ({
      id: row.id,
      path: row.path,
      label: `${'— '.repeat(depth)}${row.title}`
    }));
    const wanted = Number(parent);
    return <NewPageForm parents={options} initialParentId={options.some((o) => o.id === wanted) ? wanted : null} />;
  }

  const pageId = Number(id);
  if (!Number.isFinite(pageId)) notFound();

  const { data: page } = await supabase.from('site_pages').select(SITE_PAGE_COLUMNS).eq('id', pageId).maybeSingle();
  if (!page) notFound();
  const row = page as SitePage;

  let parentLabel: string | null = null;
  if (row.parent_id !== null) {
    const { data: parent } = await supabase.from('site_pages').select('title').eq('id', row.parent_id).maybeSingle();
    parentLabel = parent?.title ?? null;
  }

  return <PageEditor page={row} parentLabel={parentLabel} />;
}
