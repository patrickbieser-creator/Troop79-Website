import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { openHealthFile, sealHealthFile, type HealthStorage } from '@/lib/health-files';
import {
  TRIP_DAYS_AFTER,
  addDays,
  inTripWindow,
  healthNeeds,
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
  /** Which way in (lib/health-access): their own family, the named list, or an adult on the same trip. */
  via: 'family' | 'named' | 'trip';
  /** The trip (calendar entry) that let them in, when via is 'trip'. */
  eventId?: number | null;
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
    via: viewer.via,
    // The trip that let them in, or the trip a named leader was printing for.
    event_id: viewer.eventId ?? null
  });
  if (error) throw new Error(`health access log: ${error.message}`);
}

/** A leader opened one person's record page (what the family told us, contacts, the document list). Logged
 *  like a file: the caller shows nothing when this throws. */
export async function logHealthRecordOpen(personId: number, viewer: HealthViewer, deps: HealthDeps): Promise<void> {
  await log(deps, viewer, { person_id: personId, kind: 'record', page: null, id: null }, 'view');
}

/** A changed document set is no longer "Reviewed, complete": it gets looked at again. */
async function clearReview(sb: SupabaseClient, personId: number): Promise<void> {
  const { error } = await sb.from('health_reviews').delete().eq('person_id', personId);
  if (error) throw new Error(error.message);
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
  await clearReview(sb, input.personId);
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
  await clearReview(deps.supabase, Number(row.person_id));
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

/* ── The leader side (release 2) ─────────────────────────────────────────────────────────────────────────────── */

/** An event whose attendees' records an adult may open. */
export interface HealthTrip {
  signupId: number;
  /** calendar_entries.id: what the access log records. */
  eventId: number;
  title: string;
  entryDate: string;
  endDate: string | null;
  /** The sign-up asks for Part C (summer camp, treks). */
  needsPartC: boolean;
  /** Everyone going (status yes): scouts, adults and guests. */
  attendeeIds: number[];
}

interface SignupRow {
  id: number;
  calendar_entry_id: number;
  needs_ahmr_c: boolean;
  calendar_entries: { title: string; entry_date: string; end_date: string | null };
}

async function tripsFor(sb: SupabaseClient, signups: SignupRow[]): Promise<HealthTrip[]> {
  if (signups.length === 0) return [];
  const { data, error } = await sb.from('signup_entries').select('event_signup_id, person_id').in('event_signup_id', signups.map((s) => s.id)).eq('status', 'yes').not('person_id', 'is', null);
  if (error) throw new Error(error.message);
  const going = new Map<number, number[]>();
  for (const e of (data ?? []) as { event_signup_id: number; person_id: number }[]) going.set(Number(e.event_signup_id), [...(going.get(Number(e.event_signup_id)) ?? []), Number(e.person_id)]);
  return signups
    .map((s) => ({
      signupId: Number(s.id),
      eventId: Number(s.calendar_entry_id),
      title: s.calendar_entries.title,
      entryDate: s.calendar_entries.entry_date,
      endDate: s.calendar_entries.end_date,
      needsPartC: s.needs_ahmr_c === true,
      attendeeIds: [...new Set(going.get(Number(s.id)) ?? [])]
    }))
    .sort((a, b) => (a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1 : a.signupId - b.signupId));
}

const SIGNUP_COLS = 'id, calendar_entry_id, needs_ahmr_c, calendar_entries!inner(title, entry_date, end_date)';

/**
 * The trips this ADULT is attending that are inside their window today (7 days before the start to 2 days after
 * the end). Computed on every request from the sign-up: there is no grant to remember or revoke (answer 1).
 */
export async function loadTripsForAdult(sb: SupabaseClient, personId: number, today: string): Promise<HealthTrip[]> {
  // Going on the trip, not only driving to it; and an adult by the roster, never by what the sign-up row says.
  if (await isYouthOnRoster(sb, personId)) return [];
  const { data: mine, error } = await sb.from('signup_entries').select('event_signup_id').eq('person_id', personId).eq('status', 'yes').eq('participation', 'full');
  if (error) throw new Error(error.message);
  const ids = [...new Set(((mine ?? []) as { event_signup_id: number }[]).map((e) => Number(e.event_signup_id)))];
  if (ids.length === 0) return [];
  const { data, error: sigError } = await sb.from('event_signups').select(SIGNUP_COLS).in('id', ids);
  if (sigError) throw new Error(sigError.message);
  const open = ((data ?? []) as unknown as SignupRow[]).filter((s) => inTripWindow(s.calendar_entries.entry_date, s.calendar_entries.end_date, today));
  return tripsFor(sb, open);
}

/** Every event with a sign-up that hasn't ended more than two days ago, out to `daysAhead`: what a named leader
 *  picks from. */
export async function loadUpcomingTrips(sb: SupabaseClient, today: string, daysAhead = 90): Promise<HealthTrip[]> {
  const { data, error } = await sb
    .from('event_signups')
    .select(SIGNUP_COLS)
    .gte('calendar_entries.entry_date', addDays(today, -30))
    .lte('calendar_entries.entry_date', addDays(today, daysAhead));
  if (error) throw new Error(error.message);
  const live = ((data ?? []) as unknown as SignupRow[]).filter((s) => addDays(s.calendar_entries.end_date || s.calendar_entries.entry_date, TRIP_DAYS_AFTER) >= today);
  return tripsFor(sb, live);
}

export async function isHealthViewer(sb: SupabaseClient, personId: number): Promise<boolean> {
  const { data, error } = await sb.from('health_viewers').select('person_id').eq('person_id', personId).maybeSingle();
  if (error) throw new Error(error.message);
  return data != null;
}

export interface HealthViewerRow {
  personId: number;
  name: string;
  grantedAt: string;
}

export async function listHealthViewers(sb: SupabaseClient): Promise<HealthViewerRow[]> {
  const { data, error } = await sb.from('health_viewers').select('person_id, granted_at');
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { person_id: number; granted_at: string }[];
  const { data: people } = rows.length ? await sb.from('people').select('id, display_name').in('id', rows.map((r) => r.person_id)) : { data: [] };
  const nameOf = new Map(((people ?? []) as { id: number; display_name: string }[]).map((p) => [Number(p.id), p.display_name]));
  return rows
    .map((r) => ({ personId: Number(r.person_id), name: nameOf.get(Number(r.person_id)) ?? `#${r.person_id}`, grantedAt: r.granted_at }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Adds an adult to the named list. Scouts are never added (answer 7). */
export async function grantHealthViewer(sb: SupabaseClient, personId: number, grantedBy: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const [{ data: person }, youth] = await Promise.all([
    sb.from('people').select('id, merged_into_person_id, guest_host_household_id').eq('id', personId).maybeSingle(),
    isYouthOnRoster(sb, personId)
  ]);
  const p = person as { merged_into_person_id: number | null; guest_host_household_id: number | null } | null;
  // A merged-away record and a sign-up guest are not people who can sign in.
  if (!p || p.merged_into_person_id != null || p.guest_host_household_id != null) return { ok: false, error: 'That person isn’t on the roster.' };
  if (youth) return { ok: false, error: 'Scouts can’t open health records.' };
  const { error } = await sb.from('health_viewers').upsert({ person_id: personId, granted_by_person_id: grantedBy }, { onConflict: 'person_id', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** Takes an adult off the named list. The last name can't be removed: someone must be able to add the next. */
export async function revokeHealthViewer(sb: SupabaseClient, personId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  // One locked statement in the database: two removals at once can't both pass the "not the last" check.
  const { data, error } = await sb.rpc('health_revoke_viewer', { p_person_id: personId });
  if (error) throw new Error(error.message);
  if (data === 'last') return { ok: false, error: 'Add someone else first: the list can’t be left empty.' };
  if (data === 'absent') return { ok: false, error: 'That person is already off the list.' };
  return { ok: true };
}

export interface HealthReview {
  personId: number;
  byName: string;
  at: string;
}

export async function listHealthReviews(sb: SupabaseClient, personIds: number[]): Promise<Map<number, HealthReview>> {
  if (personIds.length === 0) return new Map();
  const { data, error } = await sb.from('health_reviews').select('person_id, reviewed_by_name, reviewed_at').in('person_id', personIds);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as { person_id: number; reviewed_by_name: string; reviewed_at: string }[]).map((r) => [Number(r.person_id), { personId: Number(r.person_id), byName: r.reviewed_by_name, at: r.reviewed_at }]));
}

/** "Reviewed, complete" on or off for one person. */
export async function setHealthReviewed(sb: SupabaseClient, personId: number, on: boolean, by: { personId: number; name: string }): Promise<void> {
  const { error } = on
    ? await sb.from('health_reviews').upsert({ person_id: personId, reviewed_by_person_id: by.personId, reviewed_by_name: by.name.slice(0, 120) || 'A leader', reviewed_at: new Date().toISOString() }, { onConflict: 'person_id' })
    : await sb.from('health_reviews').delete().eq('person_id', personId);
  if (error) throw new Error(error.message);
}

/** The whole log, newest first: for the named list only. */
export async function healthLogRecent(sb: SupabaseClient, limit = 200): Promise<(HealthLogLine & { personName: string })[]> {
  const { data, error } = await sb.from('health_access_log').select('at, viewer_name, person_id, kind, page, action, via').order('at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { at: string; viewer_name: string; person_id: number; kind: string; page: number | null; action: string; via: string }[];
  const ids = [...new Set(rows.map((r) => Number(r.person_id)))];
  const { data: people } = ids.length ? await sb.from('people').select('id, display_name').in('id', ids) : { data: [] };
  const nameOf = new Map(((people ?? []) as { id: number; display_name: string }[]).map((p) => [Number(p.id), p.display_name]));
  return rows.map((r) => ({ at: r.at, viewerName: r.viewer_name, personId: Number(r.person_id), personName: nameOf.get(Number(r.person_id)) ?? 'Someone no longer on the roster', kind: r.kind, page: r.page, action: r.action, via: r.via }));
}

/** Everything one signed-in adult may open, resolved per request by lib/health-access. */
export interface HealthAccess {
  me: { personId: number; name: string };
  /** Themselves and their children. */
  family: number[];
  /** On the health_viewers list. */
  named: boolean;
  /** Events they are attending that are inside their window today. */
  trips: HealthTrip[];
}

/** How this adult may open that person's records, or null when they may not. Family first, then the named
 *  list, then a trip: the log records the narrowest reason that applies. */
export function healthViewerFor(access: HealthAccess, personId: number): HealthViewer | null {
  const base = { personId: access.me.personId, name: access.me.name };
  if (access.family.includes(personId)) return { ...base, via: 'family' };
  if (access.named) return { ...base, via: 'named' };
  const trip = access.trips.find((t) => t.attendeeIds.includes(personId));
  return trip ? { ...base, via: 'trip', eventId: trip.eventId } : null;
}

/**
 * A current scout or a Webelos: a minor, who never opens health records whatever their session says (answer 7).
 * Asked of the roster, not of the sign-in or a sign-up row: `person_kind` on an entry is typed by the family.
 * An aged-out scout (an inactive scout row, now an adult) is not one.
 */
export async function isYouthOnRoster(sb: SupabaseClient, personId: number): Promise<boolean> {
  const { data, error } = await sb.from('scouts').select('active, is_webelos').eq('person_id', personId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { active: boolean; is_webelos: boolean }[]).some((s) => s.active === true || s.is_webelos === true);
}

/* ── The binder and reminders (release 3) ────────────────────────────────────────────────────────────────────── */

export interface PrintedPage {
  kind: HealthKind;
  page: number;
  contentType: string;
  /** null when the file is gone from storage or fails to open: the binder says so instead of skipping it. */
  bytes: Buffer | null;
  expiresOn: string | null;
}

/**
 * Every page on file for one person, opened for the binder. ONE 'print' line is written to the access log first
 * (who, whose, which trip); if that fails nothing is read.
 */
export async function openHealthPagesForPrint(personId: number, viewer: HealthViewer, deps: HealthDeps): Promise<PrintedPage[]> {
  await log(deps, viewer, { person_id: personId, kind: 'record', page: null, id: null }, 'print');
  const { data, error } = await deps.supabase.from('health_documents').select(COLS).eq('person_id', personId).order('kind').order('page');
  if (error) throw new Error(error.message);
  const out: PrintedPage[] = [];
  for (const row of (data ?? []) as unknown as Row[]) {
    let bytes: Buffer | null = null;
    try {
      const blob = await deps.storage.get(row.object_path);
      bytes = blob ? openHealthFile(row.object_path, blob, row.key_version, row.wrapped_key) : null;
    } catch (e) {
      console.error('[health] a file failed to open for the binder:', row.id, e instanceof Error ? e.message : e);
    }
    out.push({ kind: row.kind, page: row.page, contentType: row.content_type, bytes, expiresOn: row.expires_on });
  }
  return out;
}

/** One upcoming trip by its sign-up id, or null: what a named leader's link names. */
export async function loadUpcomingTrip(sb: SupabaseClient, signupId: number, today: string): Promise<HealthTrip | null> {
  if (!Number.isInteger(signupId) || signupId <= 0) return null;
  return (await loadUpcomingTrips(sb, today)).find((t) => t.signupId === signupId) ?? null;
}

export interface HealthReminderGroup {
  /** One family's addresses: a scout's parents, or the adult themselves. */
  to: string[];
  people: { name: string; needs: string[] }[];
}

/**
 * Who to remind before a trip, and about what: every attendee with a file missing or run out, grouped by the
 * addresses that answer for them so each family gets ONE email that names only its own people. `emailsFor` gives
 * the addresses for one person (lib/email-recipients for a scout's parents; the adult's own for an adult).
 */
export async function buildHealthReminders(
  sb: SupabaseClient,
  trip: HealthTrip,
  today: string,
  emailsFor: (personId: number) => Promise<string[]>,
  fmt: (iso: string) => string
): Promise<{ groups: HealthReminderGroup[]; noEmail: string[] }> {
  const ids = trip.attendeeIds;
  if (ids.length === 0) return { groups: [], noEmail: [] };
  const [{ data: people, error }, pages] = await Promise.all([sb.from('people').select('id, display_name, guest_host_household_id').in('id', ids), listHealthPages(sb, ids)]);
  if (error) throw new Error(error.message);
  const byKey = new Map<string, HealthReminderGroup>();
  const noEmail: string[] = [];
  const rows = ((people ?? []) as { id: number; display_name: string; guest_host_household_id: number | null }[]).sort((a, b) => a.display_name.localeCompare(b.display_name));
  for (const p of rows) {
    // A sign-up guest has no account to upload to: their host family is asked in person, not by this email.
    if (p.guest_host_household_id != null) continue;
    const needs = healthNeeds(pages.filter((x) => x.personId === Number(p.id)), { needsPartC: trip.needsPartC, today, asOf: trip.endDate ?? trip.entryDate }, fmt);
    if (needs.length === 0) continue;
    const to = [...new Set((await emailsFor(Number(p.id))).map((e) => e.trim().toLowerCase()).filter(Boolean))].sort();
    if (to.length === 0) {
      noEmail.push(p.display_name);
      continue;
    }
    const key = to.join(',');
    const group = byKey.get(key) ?? { to, people: [] };
    group.people.push({ name: p.display_name, needs });
    byKey.set(key, group);
  }
  return { groups: [...byKey.values()], noEmail };
}
