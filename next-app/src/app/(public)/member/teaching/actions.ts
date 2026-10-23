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
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadTeachingKind, loadTeachingProfile, saveTeachingSkills } from '@/lib/teaching-skills';
import { recordAuditAs } from '@/lib/audit';
import { boardName } from '@/lib/meeting-board-shared';
import {
  addMemberInterests,
  cleanPicks,
  describeInterests,
  interestShort,
  INTEREST_SEARCH_MAX,
  loadMyInterests,
  removeInterest,
  searchInterestCatalog,
  type InterestHit
} from '@/lib/teaching-interests';

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

// ── B10d: "Also enjoy teaching" (teaching_interests; Plans/Build-A-Plan.md "B10 spec") ─────────────────────────────

/** The verified session's person, when this page is theirs to use (adults and Junior Leaders). */
async function interestOwner(): Promise<{ ok: true; sb: SupabaseClient; personId: number; label: string; subjectKind: string } | { ok: false; error: string }> {
  const sb = createAdminClient();
  const session = await getIdentitySessionIfValid();
  if (!session || !(await isEpochCurrent(sb, session))) return { ok: false, error: 'Your sign-in has expired. Sign in again to save.' };
  const kind = await loadTeachingKind(sb, session.personId, centralToday());
  if (kind === 'none' || (kind === 'adult' && session.subjectKind !== 'adult')) return { ok: false, error: 'This page is for adults and Junior Leaders.' };
  const { data: me } = await sb.from('people').select('display_name').eq('id', session.personId).maybeSingle();
  return { ok: true, sb, personId: session.personId, label: (me as { display_name: string } | null)?.display_name ?? session.displayName, subjectKind: session.subjectKind };
}

export async function searchMyInterestsAction(q: unknown): Promise<{ ok: true; rows: InterestHit[] } | { ok: false; error: string }> {
  if (typeof q !== 'string') return { ok: false, error: 'Malformed request' };
  const me = await interestOwner();
  if (!me.ok) return me;
  const text = q.trim().slice(0, INTEREST_SEARCH_MAX);
  if (!text) return { ok: true, rows: [] };
  try {
    return { ok: true, rows: await searchInterestCatalog(me.sb, text) };
  } catch {
    return { ok: false, error: 'The search didn’t work. Try again.' };
  }
}

export async function addMyInterestsAction(picks: unknown): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const clean = cleanPicks(picks);
  if (!clean) return { ok: false, error: 'Malformed request' };
  if (!clean.length) return { ok: false, error: 'Pick something first.' };
  const me = await interestOwner();
  if (!me.ok) return me;
  const res = await addMemberInterests(me.sb, me.personId, clean);
  if (!res.ok) return res;
  const words = await describeInterests(me.sb, clean.map((p) => p.key)).catch(() => new Map());
  await recordAuditAs(me.sb, { personId: me.personId, label: me.label }, {
    area: 'meeting',
    action: 'interest.add',
    entityType: 'person',
    entityId: me.personId,
    summary: `${boardName(me.label) || 'Someone'} would enjoy teaching ${clean.map((p) => (words.get(p.key) ? interestShort(words.get(p.key)!) : p.key)).join(', ')}`
  });
  revalidatePath('/member/teaching');
  return { ok: true, saved: clean.length };
}

export async function removeMyInterestAction(id: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(id) || (id as number) <= 0) return { ok: false, error: 'Malformed request' };
  const me = await interestOwner();
  if (!me.ok) return me;
  const key = await removeInterest(me.sb, me.personId, id as number).catch(() => null);
  if (!key) return { ok: false, error: 'That’s already gone.' };
  const w = (await describeInterests(me.sb, [key]).catch(() => new Map())).get(key);
  await recordAuditAs(me.sb, { personId: me.personId, label: me.label }, {
    area: 'meeting',
    action: 'interest.remove',
    entityType: 'person',
    entityId: me.personId,
    summary: `${boardName(me.label) || 'Someone'} removed ${w ? interestShort(w) : key} from what they’d enjoy teaching`
  });
  revalidatePath('/member/teaching');
  return { ok: true };
}

/**
 * "Add to what I can teach" on an interest whose requirement has a skill: the signed-in set_teaching_skills path
 * (saveTeachingSkills, source 'member', logged unreviewed for leaders), with the person's whole held set plus this one.
 */
export async function addInterestToSkillsAction(id: unknown): Promise<SaveMyTeachingResult> {
  if (!Number.isInteger(id) || (id as number) <= 0) return { ok: false, error: 'Malformed request' };
  const me = await interestOwner();
  if (!me.ok) return me;
  const mine = await loadMyInterests(me.sb, me.personId);
  const item = mine.find((i) => i.id === id);
  if (!item?.skillId) return { ok: false, error: 'That one isn’t tied to a skill.' };
  const profile = await loadTeachingProfile(me.sb, me.personId, centralToday());
  const skill = profile.skills.find((s) => s.id === item.skillId);
  if (!skill) return { ok: false, error: 'That skill isn’t one you can pick here.' };
  if (skill.held) return { ok: true, added: [], removed: [] };
  const held = profile.skills.filter((s) => s.held).map((s) => s.id);
  const res = await saveTeachingSkills(me.sb, me.personId, [...held, skill.id], 'member', { personId: me.personId, label: me.label });
  if (res.ok) {
    revalidatePath('/member/teaching');
    revalidatePath('/admin/advancement/lookups');
    revalidatePath('/admin');
  }
  return res;
}
