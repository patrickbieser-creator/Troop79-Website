'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { loadCalendarCategories } from '@/lib/calendar';
import {
  calendarEntryDependents,
  planCalendarEntryMerge,
  executeCalendarEntryMerge,
  type CalendarEntryDependents,
  type CalendarEntryMergePlan
} from '@/lib/calendar-admin';

type ActionResult = { ok: boolean; error?: string };

function revalidateCalendar(entryId?: number) {
  revalidatePath('/admin/calendar');
  revalidatePath('/events');
  revalidatePath('/calendar.ics');
  if (entryId) {
    revalidatePath(`/admin/calendar/${entryId}`);
    revalidatePath(`/events/${entryId}`);
  }
}

/**
 * The story layer — `details_md`, edited in the workbench's split pane and
 * rendered publicly through ArticleBody (the same renderer the news editor
 * previews against).
 *
 * Leader-only, like every other write on this screen (Patrick, 2026-08-14).
 * Calendar entries are not a scout drafting surface the way News posts are —
 * which is also why the workbench no longer needs a panel-level role split.
 */
export async function updateEntryStory(fd: FormData): Promise<ActionResult> {
  await requireCapability('calendar.write');
  const id = Number(fd.get('id'));
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Missing entry.' };
  const body = String(fd.get('details_md') ?? '');

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('calendar_entries')
    .update({ details_md: body.trim() || null })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateCalendar(id);
  return { ok: true };
}

function fieldsFromForm(fd: FormData) {
  const entryDate = String(fd.get('entry_date') ?? '').trim();
  const endDate = String(fd.get('end_date') ?? '').trim();
  const dayNote = String(fd.get('day_note') ?? '').trim();
  const category = String(fd.get('category') ?? '').trim();
  const title = String(fd.get('title') ?? '').trim();
  const description = String(fd.get('description') ?? '').trim();
  const location = String(fd.get('location') ?? '').trim();
  const startTime = String(fd.get('start_time') ?? '').trim();
  const endTime = String(fd.get('end_time') ?? '').trim();
  // News promotion (Plans/Event-News-Promotion.md) — replaces article_id.
  const showOnHomepage = String(fd.get('show_on_homepage') ?? '') === '1';
  const heroMediaIdRaw = String(fd.get('hero_media_id') ?? '').trim();

  return {
    entry_date: entryDate,
    end_date: endDate || null,
    day_note: dayNote || null,
    category,
    title,
    description: description || null,
    location: location || null,
    start_time: startTime || null,
    end_time: endTime || null,
    // Default ON: troop events are the common case; unchecking is the
    // explicit act for an outside opportunity.
    on_calendar: String(fd.get('on_calendar') ?? '1') === '1',
    // Independent of on_calendar (20260816170000): 'draft' stages an entry
    // whose details are still moving, invisible on every public surface.
    // Defaults to published so the existing "save and it's live" flow is
    // unchanged for anyone who ignores the control.
    status: String(fd.get('status') ?? 'published') === 'draft' ? 'draft' : 'published',
    show_on_homepage: showOnHomepage,
    // Promotion sub-fields are cleared when the opt-in is off, so stale
    // windows/excerpts can't linger invisibly and spring back later.
    featured: showOnHomepage && String(fd.get('featured') ?? '') === '1',
    promo_start: showOnHomepage ? String(fd.get('promo_start') ?? '').trim() || null : null,
    promo_end: showOnHomepage ? String(fd.get('promo_end') ?? '').trim() || null : null,
    excerpt: showOnHomepage ? String(fd.get('excerpt') ?? '').trim() || null : null,
    hero_media_id: showOnHomepage && heroMediaIdRaw ? Number(heroMediaIdRaw) : null,
    auto_archive_at: String(fd.get('auto_archive_at') ?? '').trim() || null
  };
}

/* ── deep clone ──────────────────────────────────────────────────────────────
 *
 * Cloning is the PRIMARY way a new entry gets created (Patrick, 2026-08-14):
 * "find a meeting that most closely resembles what we want to do at a future
 * meeting and then clone most of all the detail, then clean it up". Bulk entry
 * is over; almost every entry from here needs thought, and the fastest route to
 * a thoughtful entry is last time's entry.
 *
 * So this is not a shallow row copy — it carries every LAYER: the write-up, the
 * agenda's shape, and the signup's whole structure (jobs, price tiers,
 * questions, resources). What it never carries is PEOPLE: no claims, no
 * entries, no payments, no assigned scouts or leaders. A cloned event starts
 * empty of humans.
 *
 * Two rules make the copy land on the new date correctly:
 *
 *   1. Date-relative fields SHIFT by the same number of days, so the pattern
 *      survives. A three-day campout stays three days; a deadline set ten days
 *      before the event stays ten days before it. Copying them verbatim would
 *      produce a signup whose deadline had already passed.
 *   2. The cloned signup starts CLOSED. A clone is by definition not yet
 *      reviewed — it still says "Devil's Lake" in the details — and families
 *      must not be able to sign up for it until a leader opens it.
 */

/** Whole days between two ISO dates, using noon UTC to dodge DST edges. */
function dayDelta(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T12:00:00Z`).getTime();
  const b = new Date(`${toISO}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Shift an ISO date (yyyy-mm-dd) by N days, preserving null. */
function shiftDate(iso: string | null, days: number): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Shift a timestamptz by N days, preserving null AND time of day. */
function shiftStamp(ts: string | null, days: number): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/** Strip the identity/audit columns a copied row must not carry over. */
function stripRow<T extends Record<string, unknown>>(row: T, ...alsoDrop: string[]): Partial<T> {
  const out: Record<string, unknown> = { ...row };
  for (const k of ['id', 'created_at', 'updated_at', ...alsoDrop]) delete out[k];
  return out as Partial<T>;
}

export async function cloneCalendarEntry(
  fd: FormData
): Promise<{ ok: boolean; error?: string; id?: number }> {
  const session = await requireCapability('calendar.write');
  const sourceId = Number(fd.get('source_id'));
  const newDate = String(fd.get('entry_date') ?? '').trim();
  if (!Number.isInteger(sourceId) || sourceId <= 0) return { ok: false, error: 'Missing source entry.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return { ok: false, error: 'Pick a date for the copy.' };

  const supabase = createAdminClient();

  const { data: source, error: srcErr } = await supabase
    .from('calendar_entries')
    .select('*')
    .eq('id', sourceId)
    .maybeSingle();
  if (srcErr) return { ok: false, error: srcErr.message };
  if (!source) return { ok: false, error: 'That entry no longer exists.' };

  const shift = dayDelta(source.entry_date as string, newDate);

  // ── the entry itself ──
  const { data: created, error: entryErr } = await supabase
    .from('calendar_entries')
    .insert({
      ...stripRow(source as Record<string, unknown>),
      // The copy belongs to whoever made it, not to whoever wrote the original
      // — the clone is a new entry that someone chose to create today.
      author_name: session.label,
      entry_date: newDate,
      end_date: shiftDate(source.end_date as string | null, shift),
      promo_start: shiftDate(source.promo_start as string | null, shift),
      promo_end: shiftDate(source.promo_end as string | null, shift),
      auto_archive_at: shiftDate(source.auto_archive_at as string | null, shift)
    })
    .select('id')
    .single();
  if (entryErr || !created) return { ok: false, error: entryErr?.message ?? 'Could not create the copy.' };
  const newId = created.id as number;

  /*
   * Layers are copied best-effort from here on. The entry already exists and is
   * usable; failing the whole clone because one price tier tripped a constraint
   * would leave the leader worse off than a partial copy they can see and fix.
   * Any layer that fails is named in the returned error while the new entry id
   * is still handed back, so the workbench opens on it either way.
   */
  const problems: string[] = [];

  // ── resources ──
  const { data: resources } = await supabase
    .from('event_resources')
    .select('*')
    .eq('calendar_entry_id', sourceId);
  if (resources?.length) {
    const { error } = await supabase
      .from('event_resources')
      .insert(resources.map((r) => ({ ...stripRow(r), calendar_entry_id: newId })));
    if (error) problems.push('resources');
  }

  // ── agenda layer: structure only, every person cleared ──
  const { data: meeting } = await supabase
    .from('meetings')
    .select('*')
    .eq('calendar_entry_id', sourceId)
    .is('archived_at', null)
    .maybeSingle();
  if (meeting) {
    const { data: newMeeting, error } = await supabase
      .from('meetings')
      .insert({
        ...stripRow(meeting as Record<string, unknown>),
        calendar_entry_id: newId,
        meeting_date: newDate,
        // Never inherit "published": a cloned agenda has not been reviewed.
        status: 'draft',
        archived_at: null
      })
      .select('id')
      .single();
    if (error || !newMeeting) {
      problems.push('agenda');
    } else {
      const { data: sessions } = await supabase
        .from('meeting_sessions')
        .select('*')
        .eq('meeting_id', meeting.id);
      if (sessions?.length) {
        const { error: sErr } = await supabase.from('meeting_sessions').insert(
          sessions.map((s) => ({
            ...stripRow(s),
            meeting_id: newMeeting.id,
            // Every person is re-assigned deliberately. A stale name published
            // on next month's agenda is worse than a blank one.
            leader_name: null,
            contact_name: null,
            contact_phone: null,
            scouts: null
          }))
        );
        if (sErr) problems.push('agenda items');
      }
    }
  }

  // ── signup layer: the whole structure, none of the people, and closed ──
  const { data: signup } = await supabase
    .from('event_signups')
    .select('*')
    .eq('calendar_entry_id', sourceId)
    .maybeSingle();
  if (signup) {
    const { data: newSignup, error } = await supabase
      .from('event_signups')
      .insert({
        ...stripRow(signup as Record<string, unknown>),
        calendar_entry_id: newId,
        status: 'closed',
        deadline: shiftStamp(signup.deadline as string, shift) ?? signup.deadline
      })
      .select('id')
      .single();
    if (error || !newSignup) {
      problems.push('signup');
    } else {
      for (const table of ['event_prices', 'signup_slots', 'signup_questions'] as const) {
        const { data: rows } = await supabase
          .from(table)
          .select('*')
          .eq('event_signup_id', signup.id);
        if (!rows?.length) continue;
        const { error: cErr } = await supabase.from(table).insert(
          rows.map((r) => ({
            ...stripRow(r),
            event_signup_id: newSignup.id,
            // A shift's own date moves with the event; its time of day does not.
            ...(table === 'signup_slots'
              ? { slot_date: shiftDate((r as { slot_date: string | null }).slot_date, shift) }
              : {})
          }))
        );
        if (cErr) problems.push(table.replace('_', ' '));
      }
    }
  }

  revalidateCalendar(newId);
  return problems.length
    ? { ok: true, id: newId, error: `Copied, but these did not come across: ${problems.join(', ')}.` }
    : { ok: true, id: newId };
}

export async function createCalendarEntry(fd: FormData): Promise<ActionResult> {
  const session = await requireCapability('calendar.write');
  const fields = fieldsFromForm(fd);
  if (!fields.entry_date) return { ok: false, error: 'Date is required.' };
  if (!fields.category) return { ok: false, error: 'Category is required.' };
  if (!fields.title) return { ok: false, error: 'Title is required.' };

  const supabase = createAdminClient();
  // Attribution is stamped at creation and never touched again — an edit does
  // not reassign authorship, same as News.
  const { error } = await supabase
    .from('calendar_entries')
    .insert({ ...fields, author_name: session.label });
  if (error) return { ok: false, error: error.message };
  revalidateCalendar();
  return { ok: true };
}

/**
 * Flip an entry's homepage promotion straight from the list, the way News flips
 * Featured from its list.
 *
 * Deliberately NOT routed through fieldsFromForm/updateCalendarEntry: that path
 * clears promo_start/promo_end/excerpt/hero whenever the opt-in is off, which is
 * right when a human is looking at those fields and wrong for a one-click
 * toggle. Turning promotion off from here parks the window rather than
 * destroying it, so turning it back on restores what was set up.
 */
export async function setEntryPromoted(id: number, on: boolean): Promise<ActionResult> {
  await requireCapability('calendar.write');
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Missing entry.' };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('calendar_entries')
    .update({ show_on_homepage: on, ...(on ? {} : { featured: false }) })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateCalendar(id);
  revalidatePath('/');
  return { ok: true };
}

export async function updateCalendarEntry(fd: FormData): Promise<ActionResult> {
  await requireCapability('calendar.write');
  const id = Number(fd.get('id'));
  const fields = fieldsFromForm(fd);
  if (!fields.entry_date) return { ok: false, error: 'Date is required.' };
  if (!fields.category) return { ok: false, error: 'Category is required.' };
  if (!fields.title) return { ok: false, error: 'Title is required.' };

  const supabase = createAdminClient();
  const { error } = await supabase.from('calendar_entries').update(fields).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateCalendar();
  return { ok: true };
}

// ── CSV import ──────────────────────────────────────────────────────────────

/*
 * Valid categories are read from the lookup table per import (D-082) rather
 * than from a build-time constant: a leader can add a category and import a
 * sheet that uses it in the same sitting, with no deploy in between.
 */

/**
 * The Bugle's Google Sheet is external and still uses the pre-2026-07-18
 * category names — it will keep emitting "Campout" and "Court of Honor" long
 * after the app renamed them. Map legacy labels forward on import instead of
 * rejecting them as unknown, so the sheet never has to be edited in lockstep
 * with the app. New names pass through untouched.
 */
const LEGACY_CATEGORY_ALIASES: Record<string, string> = {
  Campout: 'Campout / Overnight',
  Outing: 'Day Activity / Outing',
  'Committee Meeting': 'Leadership / Planning',
  'Court of Honor': 'Ceremony / Recognition',
  Ceremony: 'Ceremony / Recognition'
};

/** Canonical category for a raw sheet value; unchanged if already current.
 *  Not exported — this is a 'use server' module, where every export must be an
 *  async function. */
function normalizeImportCategory(raw: string): string {
  const trimmed = raw.trim();
  return LEGACY_CATEGORY_ALIASES[trimmed] ?? trimmed;
}

/** The fields the Bugle sheet carries. day_note, on_calendar and the
 *  promotion fields are NOT here on purpose — the sheet doesn't know about
 *  them, so imports never clobber them on update. */
export interface ImportRowFields {
  entry_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  category: string;
  title: string;
  description: string | null;
  location: string | null;
}

export interface ImportUpdate {
  id: number;
  fields: ImportRowFields;
}

export type ImportResult = { ok: boolean; error?: string; inserted: number; updated: number };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function validateImportRow(f: ImportRowFields, validCategories: string[]): string | null {
  if (!DATE_RE.test(f.entry_date)) return `bad date "${f.entry_date}"`;
  if (f.end_date && !DATE_RE.test(f.end_date)) return `bad end date "${f.end_date}"`;
  if (f.start_time && !TIME_RE.test(f.start_time)) return `bad start time "${f.start_time}"`;
  if (f.end_time && !TIME_RE.test(f.end_time)) return `bad end time "${f.end_time}"`;
  if (!validCategories.includes(normalizeImportCategory(f.category)))
    return `unknown category "${f.category}"`;
  if (!f.title.trim()) return 'missing title';
  return null;
}

/** Applies a reviewed CSV import: batch insert + per-row updates. The review
 *  UI (calendar-import.tsx) built the plan; this just validates and writes. */
export async function importCalendarEntries(
  inserts: ImportRowFields[],
  updates: ImportUpdate[]
): Promise<ImportResult> {
  await requireCapability('calendar.write');

  const validCategories = (await loadCalendarCategories()).map((c) => c.label);
  for (const f of [...inserts, ...updates.map((u) => u.fields)]) {
    const problem = validateImportRow(f, validCategories);
    if (problem) return { ok: false, error: `Rejected: ${problem}.`, inserted: 0, updated: 0 };
    // Write the canonical name, not the sheet's legacy one — otherwise a valid
    // row would still trip the calendar_entries category FK on insert.
    f.category = normalizeImportCategory(f.category);
  }

  const supabase = createAdminClient();
  if (inserts.length > 0) {
    const { error } = await supabase.from('calendar_entries').insert(inserts);
    if (error) return { ok: false, error: error.message, inserted: 0, updated: 0 };
  }
  let updated = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from('calendar_entries')
      .update({ ...u.fields, updated_at: new Date().toISOString() })
      .eq('id', u.id);
    if (error) {
      return { ok: false, error: `Update #${u.id}: ${error.message}`, inserted: inserts.length, updated };
    }
    updated++;
  }

  revalidateCalendar();
  return { ok: true, inserted: inserts.length, updated };
}

/**
 * Leader-only, matching every other destructive News & Events action.
 *
 * Same confirm=false dry-run pattern as deleteSlot/deleteQuestion in
 * events/actions.ts: a first call reports who/what is attached before
 * anything is destroyed, rather than deleting outright. Added 2026-08-20
 * after a deleted duplicate entry orphaned its ledger credit (SET NULL,
 * survives but unlinked) while its attendance vanished (CASCADE) — the
 * orphaned credit then read as a stray duplicate in the Universal Ledger and
 * got deleted for real. See calendarEntryDependents() for the FK asymmetry
 * this exists to surface before it fires.
 */
export async function deleteCalendarEntry(
  id: number,
  confirm = false
): Promise<ActionResult & { needsConfirm?: boolean; dependents?: CalendarEntryDependents }> {
  await requireCapability('calendar.write');
  const supabase = createAdminClient();

  if (!confirm) {
    const dependents = await calendarEntryDependents(supabase, id);
    if (dependents.attendanceCount > 0 || dependents.creditCount > 0) {
      const parts: string[] = [];
      if (dependents.attendanceCount > 0) {
        parts.push(
          `${dependents.attendanceCount} attendance ${dependents.attendanceCount === 1 ? 'record' : 'records'}`
        );
      }
      if (dependents.creditCount > 0) {
        parts.push(`${dependents.creditCount} ledger ${dependents.creditCount === 1 ? 'credit' : 'credits'}`);
      }
      return {
        ok: false,
        needsConfirm: true,
        dependents,
        error:
          `${parts.join(' and ')} reference this entry: ${dependents.names.join(', ')}. ` +
          `Attendance is deleted outright; ledger credit survives but loses its link to this event ` +
          `and drops off the reconciliation audit. If this is a duplicate of another entry, reassign ` +
          `or re-run Roll Call on the real one first rather than deleting this one blind.`
      };
    }
  }

  const { error } = await supabase.from('calendar_entries').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateCalendar();
  return { ok: true };
}

/**
 * Merge two calendar entries — the alternative to deleteCalendarEntry when
 * the entries are genuine duplicates of the same real-world event. Every
 * dependent row (attendance, ledger credit, resources, signup, meeting
 * agenda) is reassigned from `loseId` onto `keepId` before `loseId` is
 * removed, so nothing is ever silently orphaned the way a raw delete could.
 *
 * Same confirm=false dry-run shape as deleteCalendarEntry: the first call
 * returns a plan for the leader to review. A plan with conflicts can never
 * proceed, confirm or not — see planCalendarEntryMerge for why (there's no
 * right answer to guess when both entries have their own signup or agenda).
 */
export async function mergeCalendarEntries(
  keepId: number,
  loseId: number,
  confirm = false
): Promise<ActionResult & { needsConfirm?: boolean; plan?: CalendarEntryMergePlan }> {
  const session = await requireCapability('calendar.write');
  const supabase = createAdminClient();

  if (keepId === loseId) return { ok: false, error: 'Pick two different entries.' };

  const plan = await planCalendarEntryMerge(supabase, keepId, loseId);
  if (plan.conflicts.length > 0) {
    return { ok: false, plan, error: plan.conflicts.map((c) => c.detail).join(' ') };
  }
  if (!confirm) {
    return { ok: false, needsConfirm: true, plan, error: describeMergePlan(plan) };
  }

  const result = await executeCalendarEntryMerge(supabase, keepId, loseId, session.label);
  if (!result.ok) return { ok: false, error: result.error };
  revalidateCalendar(keepId);
  return { ok: true };
}

function describeMergePlan(plan: CalendarEntryMergePlan): string {
  const parts: string[] = [];
  if (plan.attendanceMoved > 0) parts.push(`${plan.attendanceMoved} attendance record(s) move`);
  if (plan.attendanceSuperseded > 0) parts.push(`${plan.attendanceSuperseded} duplicate attendance row(s) dropped`);
  if (plan.creditMoved > 0) parts.push(`${plan.creditMoved} ledger credit(s) move and get relabeled to the kept entry`);
  if (plan.creditSuperseded > 0)
    parts.push(`${plan.creditSuperseded} duplicate credit row(s) soft-deleted (kept entry already has that scout's credit)`);
  if (plan.resourcesMoved > 0) parts.push(`${plan.resourcesMoved} resource(s) move`);
  if (plan.signupMoved) parts.push('the signup moves onto the kept entry');
  if (plan.meetingMoved) parts.push('the meeting agenda moves onto the kept entry');
  if (parts.length === 0) return 'Nothing is attached to the entry being removed — this is a plain delete.';
  return `${parts.join('; ')}. The other entry is then removed.`;
}
