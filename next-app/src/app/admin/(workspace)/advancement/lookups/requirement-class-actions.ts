'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';

/**
 * Requirement classes lookup (Plans/Requirement-Classification.md step 2): add, edit, retire / restore, delete. The
 * same leaders who edit Req codes and Teach minutes (roster.manage). A class's code never changes; a class that any
 * requirement uses can't be deleted (the database refuses and says how many), only retired: a retired class stays on
 * the requirements that have it and can't be added to more.
 */
type Result = { ok: boolean; error?: string };

async function guard(): Promise<Result | null> {
  try {
    await requireCapability('roster.manage');
    return null;
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
}

function refresh() {
  updateTag('advancement-catalog');
  revalidatePath('/admin/advancement/lookups');
  revalidatePath('/planner', 'layout');
}

const text = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

export async function createRequirementClass(fd: FormData): Promise<Result> {
  const refused = await guard();
  if (refused) return refused;
  const code = text(fd, 'code').toUpperCase();
  const name = text(fd, 'name');
  const description = text(fd, 'description');
  if (!/^[A-Z]$/.test(code)) return { ok: false, error: 'The code is one letter, A to Z.' };
  if (!name) return { ok: false, error: 'Give the class a name.' };
  const supabase = createAdminClient();
  const { data: last } = await supabase.from('requirement_classes').select('sort_order').order('sort_order', { ascending: false }).limit(1);
  const sortOrder = ((last?.[0]?.sort_order as number | undefined) ?? 0) + 10;
  const { error } = await supabase.from('requirement_classes').insert({ code, name, description, sort_order: sortOrder });
  if (error) {
    if (error.code === '23505') return { ok: false, error: `${code} is already a class.` };
    return { ok: false, error: error.message };
  }
  await recordAudit({ area: 'advancement', action: 'create', entityType: 'requirement_class', entityId: code, summary: `Added requirement class ${code} ${name}` });
  refresh();
  return { ok: true };
}

export async function updateRequirementClass(fd: FormData): Promise<Result> {
  const refused = await guard();
  if (refused) return refused;
  const code = text(fd, 'code');
  const name = text(fd, 'name');
  const description = text(fd, 'description');
  if (!name) return { ok: false, error: 'Give the class a name.' };
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('requirement_classes').update({ name, description }).eq('code', code).select('code');
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: 'That class no longer exists. Reload the page.' };
  await recordAudit({ area: 'advancement', action: 'update', entityType: 'requirement_class', entityId: code, summary: `Edited requirement class ${code} ${name}` });
  refresh();
  return { ok: true };
}

export async function setRequirementClassRetired(fd: FormData): Promise<Result> {
  const refused = await guard();
  if (refused) return refused;
  const code = text(fd, 'code');
  const retired = text(fd, 'retired') === 'true';
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('requirement_classes')
    .update({ retired_at: retired ? new Date().toISOString() : null })
    .eq('code', code)
    .select('code');
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: 'That class no longer exists. Reload the page.' };
  await recordAudit({ area: 'advancement', action: 'update', entityType: 'requirement_class', entityId: code, summary: `${retired ? 'Retired' : 'Restored'} requirement class ${code}` });
  refresh();
  return { ok: true };
}

export async function deleteRequirementClass(fd: FormData): Promise<Result> {
  const refused = await guard();
  if (refused) return refused;
  const code = text(fd, 'code');
  const supabase = createAdminClient();
  const { error } = await supabase.from('requirement_classes').delete().eq('code', code);
  // The database's guard names how many requirements use it ("Class Q is in use by 3 requirements. Retire it instead.").
  if (error) return { ok: false, error: error.message };
  await recordAudit({ area: 'advancement', action: 'delete', entityType: 'requirement_class', entityId: code, summary: `Deleted requirement class ${code}` });
  refresh();
  return { ok: true };
}
