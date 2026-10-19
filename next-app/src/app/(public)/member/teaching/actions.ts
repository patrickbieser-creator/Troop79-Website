'use server';

/**
 * Members › What I can teach (Phase 0b of Plans/Meeting-Requests-And-Teaching-Offers.md). The person is ALWAYS the
 * verified session (signature and revocation epoch): nothing here reads a person id from the request, and a leader
 * proxy-viewing a family can't save. Only the skills the card offers may be saved (every skill for an adult, the
 * youth-teachable ones for a Junior Leader); the set_teaching_skills RPC re-checks the youth rule and logs the change
 * unreviewed so it shows on admin home.
 */
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { centralToday } from '@/lib/dates';
import { loadTeachingProfile, saveTeachingSkills } from '@/lib/teaching-skills';

export type SaveMyTeachingResult = { ok: true; added: string[]; removed: string[] } | { ok: false; error: string };

export async function saveMyTeachingSkillsAction(skillIds: unknown): Promise<SaveMyTeachingResult> {
  const sb = createAdminClient();
  const session = await getIdentitySessionIfValid();
  if (!session || !(await isEpochCurrent(sb, session))) {
    return { ok: false, error: 'Your sign-in has expired. Sign in again to save.' };
  }
  if (!Array.isArray(skillIds) || !skillIds.every((s) => typeof s === 'string')) return { ok: false, error: 'Malformed payload' };

  const profile = await loadTeachingProfile(sb, session.personId, centralToday());
  // A scout sign-in never gets the adult list, even if their scout row is no longer active (qa-lead).
  if (profile.kind === 'none' || (profile.kind === 'adult' && session.subjectKind !== 'adult')) {
    return { ok: false, error: 'This page is for adults and Junior Leaders.' };
  }
  const offered = new Set(profile.skills.map((s) => s.id));
  const outside = (skillIds as string[]).filter((id) => !offered.has(id));
  if (outside.length) return { ok: false, error: 'That skill isn’t one you can pick here.' };
  // The card shows every skill this person may hold, so the set it sends is the whole set. A leftover adults-only row on
  // a scout (from before the youth guard) is removed by the save, and the removal is logged for leaders to see.

  const { data: me } = await sb.from('people').select('display_name').eq('id', session.personId).maybeSingle();
  const res = await saveTeachingSkills(sb, session.personId, skillIds as string[], 'member', {
    personId: session.personId,
    label: (me as { display_name: string } | null)?.display_name ?? session.displayName
  });
  if (res.ok) {
    revalidatePath('/member/teaching');
    revalidatePath('/admin/advancement/lookups');
    revalidatePath('/admin');
  }
  return res;
}
