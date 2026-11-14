import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { openHealthFile, sealHealthFile, type HealthStorage } from '@/lib/health-files';
import {
  effectiveOn,
  expiresOn,
  healthFileProblem,
  isHealthKind,
  signedDateProblem,
  sniffHealthType,
  validPage,
  type HealthKind,
  type HealthPage
} from '@/lib/health-records';

/**
 * Health records: saving, removing and opening a family's documents (Plans/Health-Forms.md). The database and the
 * storage are injected, so the tests run against the real local database with storage in memory.
 *
 * Rules that ride with it:
 *   - The caller has already decided WHO may act (lib/health-access); every function here still takes the viewer
 *     so the access log names them.
 *   - Upload order: store the ciphertext, then write the row; if the row fails, delete the object.
 *   - A replaced or removed page's ciphertext is deleted at once.
 *   - Opening a file writes its access-log row FIRST and refuses when that fails.
 */

export interface HealthDeps {
  supabase: SupabaseClient;
  storage: HealthStorage;
  /** Central-time calendar day. */
  today: () => string;
}

export interface HealthViewer {
  personId: number;
  name: string;
  /** Which way in (lib/health-access): this release only 'family'. */
  via: 'family' | 'named' | 'trip';
}

const COLS = 'id, person_id, kind, page, object_path, key_version, wrapped_key, content_type, bytes, uploaded_at, effective_on, expires_on';

interface Row {
  id: string;
  person_id: number;
  kind: HealthKind;
  page: number;
  object_path: string;
  key_version: number;
  wrapped_key: string;
  content_type: string;
  bytes: number;
  uploaded_at: string;
  effective_on: string | null;
  expires_on: string | null;
}

const pageOf = (r: Row): HealthPage => ({
  id: r.id,
  personId: Number(r.person_id),
  kind: r.kind,
  page: r.page,
  contentType: r.content_type,
  uploadedAt: r.uploaded_at,
  effectiveOn: r.effective_on,
  expiresOn: r.expires_on
});

async function log(deps: HealthDeps, viewer: HealthViewer, row: { person_id: number; kind: string; page: number | null; id: string | null }, action: string): Promise<void> {
  const { error } = await deps.supabase.from('health_access_log').insert({
    viewer_person_id: viewer.personId,
    viewer_name: viewer.name.slice(0, 120) || 'Someone',
    person_id: row.person_id,
    kind: row.kind,
    page: row.page,
    document_id: row.id,
    action,
    via: viewer.via
  });
  if (error) throw new Error(`health access log: ${error.message}`);
}

/** Every page on file for these people, by person, document and page. */
export async function listHealthPages(sb: SupabaseClient, personIds: number[]): Promise<HealthPage[]> {
  if (personIds.length === 0) return [];
  const { data, error } = await sb.from('health_documents').select(COLS).in('person_id', personIds).order('person_id').order('kind').order('page');
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Row[]).map(pageOf);
}

export type SaveResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Saves one page: a new one, or a replacement for the page already in that slot. For a dated document the two
 * signature dates (either may be blank) set when the 12 months start, for every page of that document.
 */
export async function saveHealthPage(
  input: { personId: number; kind: string; page: number; bytes: Uint8Array; parentSigned?: string | null; doctorSigned?: string | null },
  viewer: HealthViewer,
  deps: HealthDeps
): Promise<SaveResult> {
  if (!isHealthKind(input.kind) || !validPage(input.kind, input.page)) return { ok: false, error: 'That page can’t be added here.' };
  const problem = healthFileProblem(input.bytes);
  if (problem) return { ok: false, error: problem };
  const today = deps.today();
  const dateProblem = signedDateProblem(input.parentSigned, today) ?? signedDateProblem(input.doctorSigned, today);
  if (dateProblem) return { ok: false, error: dateProblem };
  const sb = deps.supabase;

  const { data: old, error: oldError } = await sb.from('health_documents').select(COLS).eq('person_id', input.personId).eq('kind', input.kind).eq('page', input.page).maybeSingle();
  if (oldError) throw new Error(oldError.message);
  const before = (old as unknown as Row | null) ?? null;

  // Logged before anything is stored: a write that then fails leaves a log line for something that didn't happen,
  // never a stored file with no line.
  await log(deps, viewer, { person_id: input.personId, kind: input.kind, page: input.page, id: before?.id ?? null }, before ? 'replace' : 'upload');

  const effective = effectiveOn(input.parentSigned, input.doctorSigned);
  const objectPath = randomUUID();
  const sealed = sealHealthFile(objectPath, input.bytes);
  await deps.storage.put(objectPath, sealed.blob);

  const fields = {
    object_path: objectPath,
    key_version: sealed.keyVersion,
    wrapped_key: sealed.wrappedKey,
    content_type: sniffHealthType(input.bytes)!,
    bytes: input.bytes.length,
    uploaded_by_person_id: viewer.personId,
    uploaded_at: new Date().toISOString(),
    ...(effective ? { effective_on: effective, expires_on: expiresOn(effective) } : {})
  };
  const write = before
    ? sb.from('health_documents').update(fields).eq('id', before.id).select('id').single()
    : sb.from('health_documents').insert({ person_id: input.personId, kind: input.kind, page: input.page, ...fields }).select('id').single();
  const { data: saved, error: writeError } = await write;
  if (writeError || !saved) {
    // The row is the only way back to the object: without it the ciphertext must not stay.
    await deps.storage.delete(objectPath).catch(() => undefined);
    if (writeError?.code === '23505') return { ok: false, error: 'That page was just added from another screen. Reload and try again.' };
    throw new Error(writeError?.message ?? 'health document write failed');
  }
  const id = String((saved as { id: string }).id);
  // The old ciphertext goes at once; a storage hiccup here leaves an orphan for the sweep, never a readable file.
  if (before) await deps.storage.delete(before.object_path).catch((e) => console.error('[health] old object not deleted:', e instanceof Error ? e.message : e));
  if (effective) {
    const { error } = await sb.from('health_documents').update({ effective_on: effective, expires_on: expiresOn(effective) }).eq('person_id', input.personId).eq('kind', input.kind);
    if (error) throw new Error(error.message);
  }
  return { ok: true, id };
}

/** Sets when a dated document's 12 months start, for every page of it. */
export async function saveHealthDates(
  input: { personId: number; kind: string; parentSigned?: string | null; doctorSigned?: string | null },
  deps: HealthDeps
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isHealthKind(input.kind)) return { ok: false, error: 'That document can’t be dated.' };
  const today = deps.today();
  const dateProblem = signedDateProblem(input.parentSigned, today) ?? signedDateProblem(input.doctorSigned, today);
  if (dateProblem) return { ok: false, error: dateProblem };
  const effective = effectiveOn(input.parentSigned, input.doctorSigned);
  if (!effective) return { ok: false, error: 'Pick the date on the form.' };
  const { data, error } = await deps.supabase
    .from('health_documents')
    .update({ effective_on: effective, expires_on: expiresOn(effective) })
    .eq('person_id', input.personId)
    .eq('kind', input.kind)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) return { ok: false, error: 'Add a page first, then its dates.' };
  return { ok: true };
}

/** Removes one page: the row and its ciphertext. `personIds` is who the caller may act for. */
export async function removeHealthPage(id: string, personIds: readonly number[], viewer: HealthViewer, deps: HealthDeps): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await rowFor(deps.supabase, id);
  if (!row || !personIds.includes(Number(row.person_id))) return { ok: false, error: 'That page is already gone.' };
  // Log, then the object, then the row: a failure part-way leaves a row that still points at something or nothing,
  // never a readable object without a row.
  await log(deps, viewer, row, 'delete');
  await deps.storage.delete(row.object_path);
  const { error } = await deps.supabase.from('health_documents').delete().eq('id', row.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function rowFor(sb: SupabaseClient, id: string): Promise<Row | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { data, error } = await sb.from('health_documents').select(COLS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as Row | null) ?? null;
}

/** Whose page this is, so the caller can decide access BEFORE anything is read. */
export async function healthPageOwner(sb: SupabaseClient, id: string): Promise<{ personId: number; kind: HealthKind; page: number; contentType: string } | null> {
  const row = await rowFor(sb, id);
  return row ? { personId: Number(row.person_id), kind: row.kind, page: row.page, contentType: row.content_type } : null;
}

export type OpenResult = { ok: true; bytes: Buffer; contentType: string; filename: string } | { ok: false; status: 404 | 500 };

/**
 * Opens one page for someone the caller has already authorized. The access-log row is written first; if it can't
 * be written nothing is read. A missing object or a failed tag check answers without a byte of the file.
 */
export async function openHealthPage(id: string, viewer: HealthViewer, action: 'view' | 'download', deps: HealthDeps): Promise<OpenResult> {
  const row = await rowFor(deps.supabase, id);
  if (!row) return { ok: false, status: 404 };
  await log(deps, viewer, row, action);
  const blob = await deps.storage.get(row.object_path);
  if (!blob) return { ok: false, status: 404 };
  try {
    const bytes = openHealthFile(row.object_path, blob, row.key_version, row.wrapped_key);
    const ext = row.content_type === 'application/pdf' ? 'pdf' : row.content_type === 'image/png' ? 'png' : 'jpg';
    return { ok: true, bytes, contentType: row.content_type, filename: `${row.kind}-page-${row.page}.${ext}` };
  } catch (e) {
    console.error('[health] a file failed to open:', row.id, e instanceof Error ? e.message : e);
    return { ok: false, status: 500 };
  }
}

export interface HealthLogLine {
  at: string;
  viewerName: string;
  personId: number;
  kind: string;
  page: number | null;
  action: string;
  via: string;
}

/** Who opened these people's records, newest first: what a family sees under "Who opened these". */
export async function healthOpensFor(sb: SupabaseClient, personIds: number[], limit = 50): Promise<HealthLogLine[]> {
  if (personIds.length === 0) return [];
  const { data, error } = await sb
    .from('health_access_log')
    .select('at, viewer_name, person_id, kind, page, action, via')
    .in('person_id', personIds)
    .in('action', ['view', 'download', 'print'])
    .order('at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { at: string; viewer_name: string; person_id: number; kind: string; page: number | null; action: string; via: string }[]).map((r) => ({
    at: r.at,
    viewerName: r.viewer_name,
    personId: Number(r.person_id),
    kind: r.kind,
    page: r.page,
    action: r.action,
    via: r.via
  }));
}
