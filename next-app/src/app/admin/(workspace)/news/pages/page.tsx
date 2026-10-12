/**
 * /admin/news/pages — the Pages tree (Plans/Content-Managed-Pages.md). The copy of the public site's static
 * pages (Join, About, and any child page) as an indented list: parent → children, status, one quiet Edit.
 * Server Component; the table is a client component only for the reorder arrows.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';
import { buildPagesTree } from '@/lib/site-pages-tree';
import { PageTitle } from '../../_components/page-title';
import { PagesTable, type PageRowVM } from './pages-table';

export const metadata = {
  title: 'Pages — Troop 79 Admin'
};

export default async function PagesAdminPage() {
  await requireCapability('news.write');

  const { data } = await createAdminClient()
    .from('site_pages')
    .select('id, parent_id, slug, path, title, status, sort_order, updated_at');
  const rows = (data ?? []) as (PageRowVM & { sort_order: number; parent_id: number | null })[];
  const tree = buildPagesTree(rows);

  // First/last among their own siblings, so the arrows that can't do anything are greyed (not hidden).
  const siblings = (parent: number | null) => tree.filter((n) => n.row.parent_id === parent).map((n) => n.row.id);
  const nodes = tree.map(({ row, depth }) => {
    const group = siblings(row.parent_id);
    return { row, depth, first: group[0] === row.id, last: group[group.length - 1] === row.id };
  });

  return (
    <>
      <PageTitle
        back={null}
        title="Pages"
        sub="The words on Join, About and any other page of the public site. Edit one and save to put the change live."
      />
      <PagesTable nodes={nodes} />
    </>
  );
}
