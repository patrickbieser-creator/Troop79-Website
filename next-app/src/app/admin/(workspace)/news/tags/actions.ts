'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/require-role';
import { createAdminClient } from '@/lib/supabase/server';
import { slugify } from '@/lib/slugify';

interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function createTag(formData: FormData): Promise<ActionResult> {
  await requireRole(['leader']);
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Tag name is required.' };

  const supabase = createAdminClient();
  const { error } = await supabase.from('tags').insert({ name, slug: slugify(name) });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/news/tags');
  return { ok: true };
}

/** Deletes a tag. Cascades to remove it from any article that had it (article_tags FK). */
export async function deleteTag(id: number): Promise<ActionResult> {
  await requireRole(['leader']);
  const supabase = createAdminClient();
  const { error } = await supabase.from('tags').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/news/tags');
  return { ok: true };
}
