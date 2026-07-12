import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import type { Tag } from '@/lib/supabase/types';
import { TagsManager } from './tags-manager';
import styles from './tags.module.css';

export default async function TagsPage() {
  const jar = await cookies();
  const session = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  if (!session) redirect('/admin/login');
  if (session.role !== 'leader') redirect('/admin/news/articles');

  const supabase = createAdminClient();
  const { data: tags } = await supabase.from('tags').select('*').order('name');

  return (
    <>
      <div className={styles.pageTitle}>
        <div>
          <h1>Tags</h1>
          <p>The controlled vocabulary scouts pick from when drafting articles. Leader-managed only.</p>
        </div>
      </div>
      <TagsManager tags={(tags ?? []) as Tag[]} />
    </>
  );
}
