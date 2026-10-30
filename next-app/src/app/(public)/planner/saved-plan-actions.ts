'use server';

/**
 * Saved meeting plans (Patrick, 2026-10-29): save this meeting's criteria under a name and a date, load one onto this
 * meeting (replacing its focus, planner-added requirements and night badges), rename or re-date one, delete one. The
 * planning team's (seed), like every focus change; gated before the database is touched, on one of the meetings the
 * planner offers. Each returns the board's stamp, as This week's writes do.
 */
import { revalidatePath } from 'next/cache';
import { loadBoardStamp } from '@/lib/meeting-board';
import { plannerSeeder } from '@/lib/meeting-planner-seeder';
import { PLANNER_WEEKS } from '@/lib/this-week';
import { cleanPlanName, isIsoDate } from '@/lib/saved-plans-shared';
import { deleteSavedPlan, insertSavedPlan, loadSavedPlan, updateSavedPlan } from '@/lib/saved-plans';

export type SavedPlanResult = { ok: true; stamp: string } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const NAME = 'Give the plan a name (80 characters at most).';
const DATE = 'Pick a date.';

const gate = (entryId: unknown) => plannerSeeder(entryId, { within: PLANNER_WEEKS, right: 'seed' });
type Gate = Extract<Awaited<ReturnType<typeof gate>>, { ok: true }>;
const done = async (s: Gate): Promise<SavedPlanResult> => {
  revalidatePath('/planner');
  return { ok: true, stamp: await loadBoardStamp(s.sb, s.meeting.entryId) };
};

export async function twSavePlanAction(input: { entryId: number; name: string; planDate: string }): Promise<({ id: number } & SavedPlanResult) | { ok: false; error: string }> {
  const s = await gate(input?.entryId);
  if (!s.ok) return s;
  const name = cleanPlanName(input.name);
  if (!name) return fail(NAME);
  if (!isIsoDate(input.planDate)) return fail(DATE);
  const res = await insertSavedPlan(s.sb, { entryId: s.meeting.entryId, name, planDate: input.planDate, actorPersonId: s.actorPersonId });
  if (!res.ok) return res;
  const d = await done(s);
  return d.ok ? { ...d, id: res.id } : d;
}

export async function twLoadPlanAction(input: { entryId: number; planId: number }): Promise<SavedPlanResult> {
  if (!Number.isInteger(input?.planId)) return fail('Malformed request');
  const s = await gate(input.entryId);
  if (!s.ok) return s;
  const res = await loadSavedPlan(s.sb, s.meeting.entryId, input.planId, s.actorPersonId);
  return res.ok ? done(s) : res;
}

export async function twUpdatePlanAction(input: { entryId: number; planId: number; name: string; planDate: string }): Promise<SavedPlanResult> {
  if (!Number.isInteger(input?.planId)) return fail('Malformed request');
  const s = await gate(input.entryId);
  if (!s.ok) return s;
  const name = cleanPlanName(input.name);
  if (!name) return fail(NAME);
  if (!isIsoDate(input.planDate)) return fail(DATE);
  const res = await updateSavedPlan(s.sb, input.planId, { name, planDate: input.planDate });
  return res.ok ? done(s) : res;
}

export async function twDeletePlanAction(input: { entryId: number; planId: number }): Promise<SavedPlanResult> {
  if (!Number.isInteger(input?.planId)) return fail('Malformed request');
  const s = await gate(input.entryId);
  if (!s.ok) return s;
  const res = await deleteSavedPlan(s.sb, input.planId);
  return res.ok ? done(s) : res;
}
