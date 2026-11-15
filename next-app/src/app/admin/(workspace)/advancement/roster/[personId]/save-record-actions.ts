'use server';

/**
 * One form, one Save (Plans/Person-Record-One-Save.md, step 3).
 *
 * savePersonRecord re-reads the saved record, diffs the posted draft against it
 * (record-draft.ts — the same code the page uses for its dirty state), and hands the
 * whole change to save_person_record: one database transaction, so everything lands or
 * nothing does. previewPersonRecordSave runs the same writes and rolls them back, to
 * name the family links a save would also add or end.
 *
 * LEADER-ONLY (roster.manage). The database's own refusals (SQLSTATE T7901 from the
 * initials RPCs, T7902 from save_person_record) carry a message meant for the form;
 * anything else is a bug and gets a generic message, never the raw database error.
 */
import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { expirePeopleLists } from '@/lib/people-lists';
import { loadPersonRecord } from './load-person-record';
import { diffDraft, draftProblems, type RecordDraft } from './record-draft';
import type { FamilyRow, PersonRecord } from './record-types';

export interface LinkChange {
  person_id: number;
  person_name: string;
  related_person_id: number;
  related_name: string;
  type: string;
  change: 'added' | 'removed';
}

export type SaveRecordResult =
  | { ok: true; links: LinkChange[] }
  | { ok: false; error: string; problems?: { fieldId: string; message: string }[] };

const GENERIC = 'Couldn’t save the record. Nothing was changed. Try again.';

type Db = ReturnType<typeof createAdminClient>;

async function guard(): Promise<boolean> {
  try {
    await requireCapability('roster.manage');
    return true;
  } catch {
    return false;
  }
}

async function schoolNames(supabase: Db, record: PersonRecord, draft: RecordDraft): Promise<Map<string, string>> {
  const ids = [record.scout?.school_id, draft.scout?.school_id]
    .map((v) => (v == null || v === '' ? null : Number(v)))
    .filter((v): v is number => v != null && Number.isSafeInteger(v));
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const { data } = await (supabase as unknown as { from: (t: string) => ReturnType<Db['from']> })
    .from('schools')
    .select('id, name')
    .in('id', ids);
  for (const r of (data ?? []) as unknown as { id: number; name: string }[]) names.set(String(r.id), r.name);
  return names;
}

/** The draft's shape is checked before anything is read from it — a server action takes whatever is posted. */
function wellFormed(draft: unknown): draft is RecordDraft {
  if (!draft || typeof draft !== 'object') return false;
  const d = draft as Record<string, unknown>;
  return (
    typeof d.f === 'object' &&
    d.f != null &&
    Array.isArray(d.emails) &&
    typeof d.primary === 'string' &&
    typeof d.householdId === 'string' &&
    typeof d.family === 'object' &&
    d.family != null &&
    Array.isArray(d.roles) &&
    Array.isArray(d.addMembers) &&
    typeof d.initials === 'string' &&
    typeof d.active === 'boolean' &&
    typeof d.reason === 'string'
  );
}

async function prepare(personId: number, draft: unknown) {
  if (!Number.isSafeInteger(personId) || personId <= 0 || !wellFormed(draft)) return { error: 'Nothing to save.' } as const;
  const res = await loadPersonRecord(personId);
  if (res.kind !== 'found') return { error: 'That person is no longer on the roster.' } as const;
  const record = res.record;
  const supabase = createAdminClient();
  const schools = await schoolNames(supabase, record, draft);
  const households = new Map(record.households.map((h) => [String(h.id), h.label]));
  const diff = diffDraft(record, draft, {
    schoolName: (id) => schools.get(id) ?? `school ${id}`,
    householdLabel: (id) => households.get(id) ?? `household ${id}`
  });
  return { record, diff, supabase } as const;
}

function refusal(error: { code?: string; message: string }): string {
  if (error.code === 'T7901' || error.code === 'T7902') return error.message;
  console.error('save_person_record failed:', error.code ?? 'unknown');
  return GENERIC;
}

export async function savePersonRecord(personId: number, draft: RecordDraft): Promise<SaveRecordResult> {
  if (!(await guard())) return { ok: false, error: 'Not authenticated' };
  const prep = await prepare(personId, draft);
  if ('error' in prep) return { ok: false, error: prep.error ?? GENERIC };
  const { record, diff, supabase } = prep;

  const problems = draftProblems(draft, record);
  if (problems.length > 0) {
    return { ok: false, error: `Can’t save yet: ${problems[0].message}`, problems };
  }
  if (diff.changed.length === 0) return { ok: true, links: [] };

  const actor = await resolveAdminActor().catch(() => null);
  const { data, error } = await supabase.rpc('save_person_record' as never, {
    p: {
      ...diff.payload,
      person_id: personId,
      actor_person_id: actor?.personId ?? null,
      actor_label: actor?.label ?? 'system',
      details: diff.details
    }
  } as never);
  if (error) return { ok: false, error: refusal(error) };

  expirePeopleLists();
  for (const path of [
    `/admin/advancement/roster/${personId}`,
    '/admin/advancement/roster',
    '/admin/advancement/lookups',
    '/admin/advancement/dashboard',
    '/admin/advancement/fast-entry',
    '/admin/advancement/ledger',
    '/advancement'
  ]) {
    revalidatePath(path);
  }
  return { ok: true, links: ((data as { links?: LinkChange[] } | null)?.links ?? []) as LinkChange[] };
}

export interface PreviewResult {
  /** Links the save adds or ends that the leader did not set themselves. */
  also: LinkChange[];
  problem?: string;
}

/** What else a save would do to family links — the "Saving will also …" line. */
export async function previewPersonRecordSave(personId: number, draft: RecordDraft): Promise<PreviewResult> {
  if (!(await guard())) return { also: [] };
  const prep = await prepare(personId, draft);
  if ('error' in prep) return { also: [] };
  const { diff, supabase } = prep;
  if (!diff.payload.household && !diff.payload.relationships) return { also: [] };

  const { data, error } = await supabase.rpc('preview_person_record' as never, {
    p: { ...diff.payload, person_id: personId }
  } as never);
  if (error) return { also: [] };
  const out = data as { links?: LinkChange[]; problem?: string } | null;
  const explicit = new Set(diff.explicitPairs);
  const also = (out?.links ?? []).filter((l) => {
    const mine = l.person_id === personId || l.related_person_id === personId;
    const other = l.person_id === personId ? l.related_person_id : l.person_id;
    return !(mine && explicit.has(other));
  });
  return { also, problem: out?.problem };
}

/** "+ Person to household": people on the roster matching a name, with what the Family list needs. */
export async function searchFamilyCandidates(q: string): Promise<Omit<FamilyRow, 'links' | 'inHousehold'>[]> {
  if (!(await guard())) return [];
  const term = typeof q === 'string' ? q.trim() : '';
  if (term.length < 2) return [];
  const { data } = await createAdminClient()
    .from('person_directory')
    .select('person_id, display_name, tab, active')
    .ilike('display_name', `%${term.replace(/[%_]/g, '')}%`)
    .order('display_name')
    .limit(12);
  return ((data ?? []) as { person_id: number; display_name: string; tab: string; active: boolean }[]).map((r) => ({
    personId: Number(r.person_id),
    name: r.display_name,
    kind: r.tab === 'leader' ? 'leader' : r.tab === 'adult' ? 'adult' : 'scout',
    youth: r.tab === 'active_scout' || r.tab === 'inactive_scout' || r.tab === 'webelos',
    active: r.active
  }));
}
