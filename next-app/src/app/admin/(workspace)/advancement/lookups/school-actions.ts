'use server';

/**
 * Schools (Plans/Person-Record-One-Save.md "Schools"; lib/schools.ts). Leaders only: every action needs
 * roster.manage, writes with the service role (schools has RLS on with no policies) and lands in the
 * roster audit trail. Families never call these — their "+ Add" goes into a change request, resolved by
 * approveChangeRequest through the same ensureSchoolWith.
 *
 *   addSchool       the combobox's "+ Add …": an exact (case-insensitive) match returns the existing row
 *   listSchools     every school, hidden ones too (the pickers hide them, except a scout's current one)
 *   renameSchool    Lookups › Schools: name and short name
 *   mergeSchool     repoint every scout from the loser to the survivor, then delete the loser
 *   setSchoolActive hide / unhide
 *   deleteSchool    refused while any scout uses it
 */
import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import {
  SCHOOL_NAME_MAX,
  SCHOOL_SHORT_NAME_MAX,
  cleanSchoolName,
  ensureSchoolWith,
  findSchoolByName,
  listSchoolsWith,
  type School
} from '@/lib/schools';

interface Result {
  ok: boolean;
  error?: string;
}

function revalidate() {
  revalidatePath('/admin/advancement/lookups');
  revalidatePath('/admin/advancement/roster');
  revalidatePath('/profile');
}

async function guard(): Promise<Result | null> {
  try {
    await requireCapability('roster.manage');
    return null;
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
}

async function loadOne(id: number): Promise<School | null> {
  const { data } = await createAdminClient().from('schools').select('id, name, short_name, active').eq('id', id).maybeSingle();
  return (data as School | null) ?? null;
}

async function scoutsUsing(id: number): Promise<number> {
  const { count } = await createAdminClient().from('scouts').select('id', { count: 'exact', head: true }).eq('school_id', id);
  return count ?? 0;
}

const GENERIC_FAIL = 'Couldn’t save that change to the school. Try again.';

/** Never hand a raw database error to the page; log its code for us instead. */
function failed(what: string, error: { code?: string }): Result {
  console.error(`school ${what} failed:`, error.code ?? 'unknown');
  return { ok: false, error: GENERIC_FAIL };
}

export async function addSchool(name: string): Promise<Result & { school?: School }> {
  const denied = await guard();
  if (denied) return denied;
  const res = await ensureSchoolWith(createAdminClient(), name);
  if (!res.ok) return res;
  if (res.created || res.unhidden) {
    await recordAudit({
      area: 'roster',
      action: res.created ? 'create' : 'update',
      entityType: 'school',
      entityId: res.school.id,
      summary: res.created ? `Added school "${res.school.name}"` : `Unhid school "${res.school.name}" (added again)`
    });
    revalidate();
  }
  return { ok: true, school: res.school };
}

export async function listSchools(): Promise<School[]> {
  if (await guard()) return [];
  return listSchoolsWith(createAdminClient());
}

export async function renameSchool(id: number, rawName: string, rawShort: string | null): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const name = cleanSchoolName(rawName);
  const shortName = cleanSchoolName(rawShort ?? '') || null;
  if (!name) return { ok: false, error: 'A school needs a name.' };
  if (name.length > SCHOOL_NAME_MAX) return { ok: false, error: `A school name can be at most ${SCHOOL_NAME_MAX} characters.` };
  if (shortName && shortName.length > SCHOOL_SHORT_NAME_MAX) {
    return { ok: false, error: `A short name can be at most ${SCHOOL_SHORT_NAME_MAX} characters.` };
  }
  const sb = createAdminClient();
  const was = await loadOne(id);
  if (!was) return { ok: false, error: 'School not found.' };
  const clash = findSchoolByName(await listSchoolsWith(sb), name);
  if (clash && clash.id !== id) {
    return { ok: false, error: `There is already a school called "${clash.name}". To combine them, use Merge.` };
  }
  const { error } = await sb.from('schools').update({ name, short_name: shortName }).eq('id', id);
  if (error) return failed('rename', error);

  const details = [];
  if (was.name !== name) details.push({ field: 'Name', from: was.name, to: name });
  if ((was.short_name ?? null) !== shortName) details.push({ field: 'Short name', from: was.short_name ?? '—', to: shortName ?? '—' });
  await recordAudit({ area: 'roster', action: 'update', entityType: 'school', entityId: id, summary: `Renamed school "${was.name}"`, details });
  revalidate();
  return { ok: true };
}

export async function mergeSchool(loserId: number, survivorId: number): Promise<Result & { moved?: number }> {
  const denied = await guard();
  if (denied) return denied;
  if (loserId === survivorId) return { ok: false, error: 'Pick a different school to merge into.' };
  const [loser, survivor] = await Promise.all([loadOne(loserId), loadOne(survivorId)]);
  if (!loser || !survivor) return { ok: false, error: 'School not found.' };

  const sb = createAdminClient();
  const { data: moved, error: moveErr } = await sb.from('scouts').update({ school_id: survivorId }).eq('school_id', loserId).select('id');
  if (moveErr) return failed('merge', moveErr);
  // Two writes, not one transaction: if the delete fails the scouts have already moved, which
  // leaves an unused school behind (harmless, and Delete then works) rather than a half-moved one.
  const { error } = await sb.from('schools').delete().eq('id', loserId);
  if (error) return failed('merge', error);

  const count = moved?.length ?? 0;
  await recordAudit({
    area: 'roster',
    action: 'merge',
    entityType: 'school',
    entityId: survivorId,
    summary: `Merged school "${loser.name}" into "${survivor.name}" (${count} scout${count === 1 ? '' : 's'} moved)`,
    details: { merged_school_id: loserId, scouts: (moved ?? []).map((r) => (r as { id: string }).id) }
  });
  revalidate();
  return { ok: true, moved: count };
}

export async function setSchoolActive(id: number, active: boolean): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const was = await loadOne(id);
  if (!was) return { ok: false, error: 'School not found.' };
  const { error } = await createAdminClient().from('schools').update({ active }).eq('id', id);
  if (error) return failed('update', error);
  await recordAudit({
    area: 'roster',
    action: 'update',
    entityType: 'school',
    entityId: id,
    summary: `${active ? 'Unhid' : 'Hid'} school "${was.name}"`,
    details: [{ field: 'Offered in pickers', from: was.active ? 'Yes' : 'No', to: active ? 'Yes' : 'No' }]
  });
  revalidate();
  return { ok: true };
}

export async function deleteSchool(id: number): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const was = await loadOne(id);
  if (!was) return { ok: false, error: 'School not found.' };
  const using = await scoutsUsing(id);
  if (using > 0) {
    return {
      ok: false,
      error: `Can't delete "${was.name}": ${using} scout${using === 1 ? '' : 's'} still use${using === 1 ? 's' : ''} it. Merge it into another school, or hide it.`
    };
  }
  const { error } = await createAdminClient().from('schools').delete().eq('id', id);
  if (error) return { ok: false, error: error.code === '23503' ? `Can't delete "${was.name}": a scout still uses it.` : GENERIC_FAIL };
  await recordAudit({ area: 'roster', action: 'delete', entityType: 'school', entityId: id, summary: `Deleted school "${was.name}"` });
  revalidate();
  return { ok: true };
}
