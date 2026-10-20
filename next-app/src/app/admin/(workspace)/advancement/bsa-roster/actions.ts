'use server';

/**
 * BSA Roster check (lib/bsa-roster.ts). Checking a roster is read-only;
 * Save writes the five people.bsa_* registration columns for the people the
 * roster matched, and nothing else. The uploaded file is parsed in memory and
 * never stored.
 */
import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { fmtDate } from '@/lib/format-date';
import { buildRosterReport, parseBsaRosterCsv, RosterCsvError, type RosterReport } from '@/lib/bsa-roster';
import { latestRosterAsOf, loadRosterPeople, saveRegistrations } from '@/lib/bsa-roster-db';

export type RosterCheckResult = { ok: true; report: RosterReport } | { ok: false; error: string };
export type RosterSaveResult = { ok: true; saved: number } | { ok: false; error: string };

/** A troop roster is ~10 KB; anything this big is the wrong file. */
const MAX_BYTES = 1024 * 1024;

async function reportFrom(formData: FormData): Promise<RosterCheckResult> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose the Roster Report CSV from my.scouting.org.' };
  if (file.size > MAX_BYTES) return { ok: false, error: 'That file is larger than a troop roster should be.' };
  try {
    const roster = parseBsaRosterCsv(await file.text());
    return { ok: true, report: buildRosterReport(roster, await loadRosterPeople(createAdminClient())) };
  } catch (e) {
    if (e instanceof RosterCsvError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function checkBsaRosterAction(formData: FormData): Promise<RosterCheckResult> {
  await requireCapability('roster.manage');
  return reportFrom(formData);
}

export async function saveBsaRegistrationsAction(formData: FormData): Promise<RosterSaveResult> {
  await requireCapability('roster.manage');
  const checked = await reportFrom(formData);
  if (!checked.ok) return checked;
  const { registrations, asOf } = checked.report;
  const sb = createAdminClient();
  const newest = await latestRosterAsOf(sb);
  if (newest && (!asOf || asOf < newest)) {
    return { ok: false, error: `This roster is older than the one already saved (${fmtDate(newest)}). Export a new one from my.scouting.org.` };
  }
  const saved = await saveRegistrations(sb, registrations);
  await recordAudit({
    area: 'roster',
    action: 'update',
    entityType: 'bsa_roster',
    entityId: asOf,
    summary: `Saved BSA registrations for ${saved} people from the roster of ${asOf ? fmtDate(asOf) : 'an unknown date'}`,
    subjects: registrations.map((r) => r.personId)
  });
  revalidatePath('/admin/advancement/bsa-roster');
  revalidatePath('/member');
  revalidatePath('/member/registration');
  return { ok: true, saved };
}
