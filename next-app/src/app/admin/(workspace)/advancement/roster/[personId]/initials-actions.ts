'use server';

/**
 * Sign-off initials on the person record (Plans/Sign-Off-Initials.md): add,
 * rename, retire and restore a person's leaders.code. Each is one RPC (lock,
 * checks and writes in one transaction); this layer checks roster.manage,
 * translates the RPC's own refusals (SQLSTATE T7901) into the message the
 * form shows, and writes the person's history row. Anything else is a bug and
 * gets a generic message, never the raw database error.
 */
import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { expirePeopleLists } from '@/lib/people-lists';
import { initialsShapeProblem } from '@/lib/sign-off-initials';

export interface InitialsResult {
  ok: boolean;
  error?: string;
}

const GENERIC = 'Couldn’t save the initials. Try again.';

/** Server actions take whatever the client sends: a real person id and a string code, or nothing is written. */
function badInput(personId: unknown, code?: unknown): string | null {
  if (!Number.isSafeInteger(personId) || (personId as number) <= 0) return 'Pick a person.';
  if (code !== undefined && typeof code !== 'string') return 'Type the initials.';
  return null;
}

async function guard(): Promise<string | null> {
  try {
    await requireCapability('roster.manage');
    return null;
  } catch {
    return 'Not authenticated';
  }
}

function refusal(error: { code?: string; message: string } | null): string | null {
  if (!error) return null;
  if (error.code === 'T7901') return error.message;
  console.error('sign-off initials RPC failed:', error.code ?? 'unknown');
  return GENERIC;
}

function revalidateAll(personId: number) {
  expirePeopleLists();
  revalidatePath(`/admin/advancement/roster/${personId}`);
  revalidatePath('/admin/advancement/fast-entry');
  revalidatePath('/admin/advancement/ledger');
  revalidatePath('/admin/advancement/audits');
}

export async function addInitials(personId: number, code: string): Promise<InitialsResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const bad = badInput(personId, code);
  if (bad) return { ok: false, error: bad };
  const shape = initialsShapeProblem(code);
  if (shape) return { ok: false, error: shape };

  const { data, error } = await createAdminClient().rpc('add_leader_initials', {
    p_person_id: personId,
    p_code: code.trim()
  });
  const problem = refusal(error);
  if (problem) return { ok: false, error: problem };
  const added = (data as { code: string }).code;
  await recordAudit({
    area: 'roster',
    action: 'update',
    entityType: 'person',
    entityId: personId,
    summary: 'Added sign-off initials',
    details: [{ field: 'Sign-off initials', from: '—', to: added }]
  });
  revalidateAll(personId);
  return { ok: true };
}

export async function renameInitials(personId: number, code: string): Promise<InitialsResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const bad = badInput(personId, code);
  if (bad) return { ok: false, error: bad };
  const shape = initialsShapeProblem(code);
  if (shape) return { ok: false, error: shape };

  const { data, error } = await createAdminClient().rpc('rename_leader_initials', {
    p_person_id: personId,
    p_new_code: code.trim()
  });
  const problem = refusal(error);
  if (problem) return { ok: false, error: problem };
  const r = data as { from: string; to: string; entries: number };
  if (r.from !== r.to) {
    await recordAudit({
      area: 'roster',
      action: 'update',
      entityType: 'person',
      entityId: personId,
      summary: `Renamed sign-off initials (${r.entries} ledger ${r.entries === 1 ? 'entry' : 'entries'} rewritten)`,
      details: [{ field: 'Sign-off initials', from: r.from, to: r.to }]
    });
  }
  revalidateAll(personId);
  return { ok: true };
}

export async function setInitialsRetired(personId: number, retired: boolean): Promise<InitialsResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const bad = badInput(personId);
  if (bad) return { ok: false, error: bad };

  const { data, error } = await createAdminClient().rpc('set_leader_initials_retired', {
    p_person_id: personId,
    p_retired: retired === true
  });
  const problem = refusal(error);
  if (problem) return { ok: false, error: problem };
  const code = (data as { code: string }).code;
  await recordAudit({
    area: 'roster',
    action: 'update',
    entityType: 'person',
    entityId: personId,
    summary: retired ? 'Retired sign-off initials' : 'Restored sign-off initials',
    details: [
      { field: 'Sign-off initials', from: retired ? code : `${code} (retired)`, to: retired ? `${code} (retired)` : code }
    ]
  });
  revalidateAll(personId);
  return { ok: true };
}
