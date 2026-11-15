/**
 * One form, one Save (Plans/Person-Record-One-Save.md): the record page's draft and the
 * pure logic around it, shared by the client (dirty state, the record bar's "N unsaved
 * changes", blocked-save problems, the To finish list) and the server action (which
 * re-reads the saved record and diffs the posted draft against THAT, so stale ids or
 * "from" values from the browser never reach the database).
 *
 * A plain module, no server imports — the client shell reads it.
 */
import type { AuditDetail } from '@/lib/audit';
import { fmtDate } from '@/lib/format-date';
import { gradeFromGradYear, gradYearFromGrade, gradeLabel, SWIM_CLASS_LABEL, yptStatus } from '@/lib/demographics';
import { initialsShapeProblem } from '@/lib/sign-off-initials';
import { INACTIVE_REASON_LABEL, type InactiveReason } from '@/lib/supabase/types';
import { GRANTABLE_ROLES, ROLE_LABEL, type FamilyRow, type PersonRecord } from './record-types';

/* ── The draft ─────────────────────────────────────────────────────────── */

export const PERSON_FIELD_KEYS = [
  'first_name',
  'last_name',
  'suffix',
  'nickname',
  'birthdate',
  'gender',
  'bsa_member_id',
  'ypt_completed',
  'health_form_date',
  'things_we_should_know',
  'primary_phone',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'zip'
] as const;
export type PersonFieldKey = (typeof PERSON_FIELD_KEYS)[number];

export const FIELD_LABEL: Record<string, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  suffix: 'Suffix',
  nickname: 'Nickname',
  birthdate: 'Birthdate',
  gender: 'Gender',
  bsa_member_id: 'BSA ID',
  ypt_completed: 'YPT completed',
  health_form_date: 'Health form',
  things_we_should_know: 'Things we should know',
  primary_phone: 'Phone',
  address_line1: 'Address',
  address_line2: 'Address line 2',
  city: 'City',
  state: 'State',
  zip: 'ZIP',
  patrol: 'Patrol',
  school_id: 'School',
  grade: 'Grade',
  swim_class: 'Swim class',
  junior_leader_override: 'Junior leader',
  status: 'Status',
  emails: 'Email addresses',
  household: 'Household',
  family: 'Family links',
  roles: 'Roles',
  initials: 'Sign-off initials'
};

const DATE_KEYS = new Set(['birthdate', 'ypt_completed', 'health_form_date']);

export type EmailLabel = 'home' | 'work' | 'other';
export interface DraftEmail {
  email: string;
  label: EmailLabel;
}

export interface ScoutDraft {
  patrol: string;
  school_id: string;
  grade: string;
  swim_class: string;
  junior_leader_override: string;
}

/** A family row's link from this record's side: '' none, 'parent_of>' this person is the
 *  parent, 'parent_of<' the other person is, 'sibling_of' siblings. */
export type FamilyChoice = '' | 'parent_of>' | 'guardian_of>' | 'parent_of<' | 'guardian_of<' | 'sibling_of';

export interface RecordDraft {
  f: Record<PersonFieldKey, string>;
  scout: ScoutDraft | null;
  active: boolean;
  /** Scout: an InactiveReason code. Adult: free text. */
  reason: string;
  emails: DraftEmail[];
  /** The primary address (lower-cased), '' when there are none. */
  primary: string;
  householdId: string;
  /** Moving out of a household: also end the links that came with it. */
  endLinks: boolean;
  /** People joined to this person's household on Save ("+ Person to household"). */
  addMembers: { personId: number; name: string; youth: boolean; kind: FamilyRow['kind'] }[];
  /** Other person id → this record's link to them. */
  family: Record<string, FamilyChoice>;
  /** Grantable roles held now, sorted. */
  roles: string[];
  initials: string;
  initialsRetired: boolean;
}

const str = (v: unknown) => (v == null ? '' : String(v));
const norm = (email: string) => email.trim().toLowerCase();

/** Whether this record carries a scout's sections (an aged-out scout is an adult). */
export function isScoutRecord(record: PersonRecord): boolean {
  return record.kind === 'scout' && record.scout != null;
}

const FAMILY_TYPES = new Set(['parent_of', 'guardian_of', 'sibling_of']);

/** The saved link to one family row, as a FamilyChoice. Parent beats guardian beats sibling. */
export function savedChoice(row: FamilyRow): FamilyChoice {
  const family = row.links.filter((l) => FAMILY_TYPES.has(l.type));
  const pick = (type: string, outgoing: boolean) => family.some((l) => l.type === type && l.outgoing === outgoing);
  if (pick('parent_of', true)) return 'parent_of>';
  if (pick('parent_of', false)) return 'parent_of<';
  if (pick('guardian_of', true)) return 'guardian_of>';
  if (pick('guardian_of', false)) return 'guardian_of<';
  if (family.some((l) => l.type === 'sibling_of')) return 'sibling_of';
  return '';
}

export function draftFromRecord(record: PersonRecord): RecordDraft {
  const f = record.detail.fields;
  const fields = {} as Record<PersonFieldKey, string>;
  for (const k of PERSON_FIELD_KEYS) fields[k] = k === 'gender' ? str(record.gender) : str(f[k]);
  const scout = isScoutRecord(record) ? record.scout! : null;
  const primary = record.emails.find((e) => e.isPrimary)?.email ?? record.emails[0]?.email ?? '';
  const family: Record<string, FamilyChoice> = {};
  for (const row of record.family ?? []) family[String(row.personId)] = savedChoice(row);
  return {
    f: fields,
    scout: scout
      ? {
          patrol: scout.patrol ?? '',
          school_id: scout.school_id == null ? '' : String(scout.school_id),
          grade: (() => {
            const g = gradeFromGradYear(scout.graduation_year, record.today);
            return g == null ? '' : String(g);
          })(),
          swim_class: scout.swim_class ?? '',
          junior_leader_override: scout.junior_leader_override ?? ''
        }
      : null,
    active: record.status.active,
    reason: record.status.reason ?? '',
    emails: record.emails.map((e) => ({ email: e.email, label: e.label as EmailLabel })),
    primary: norm(primary),
    householdId: record.household ? String(record.household.id) : '',
    endLinks: false,
    addMembers: [],
    family,
    roles: record.detail.roles
      .filter((r) => !r.end_date && (GRANTABLE_ROLES as readonly string[]).includes(r.role))
      .map((r) => r.role)
      .sort(),
    initials: record.initials?.code ?? '',
    initialsRetired: !!record.initials?.retiredAt
  };
}

/** Stable key for dirty checks. */
export function draftKey(d: RecordDraft): string {
  return JSON.stringify(d);
}

/* ── Family options ────────────────────────────────────────────────────── */

const firstName = (name: string) => name.split(' ')[0] || name;

/** The choices a family row's select offers, from this record's side. The saved value is
 *  always offered so an unusual link (a scout as parent) is never silently rewritten. */
export function familyOptions(
  me: { name: string; youth: boolean },
  row: { name: string; youth: boolean },
  saved: FamilyChoice
): { value: FamilyChoice; label: string }[] {
  const label: Record<FamilyChoice, string> = {
    '': 'No relationship',
    'parent_of>': `${firstName(me.name)} is parent`,
    'guardian_of>': `${firstName(me.name)} is guardian`,
    'parent_of<': `${firstName(row.name)} is parent`,
    'guardian_of<': `${firstName(row.name)} is guardian`,
    sibling_of: 'Sibling'
  };
  let values: FamilyChoice[];
  if (me.youth && row.youth) values = ['sibling_of', ''];
  else if (!me.youth && row.youth) values = ['parent_of>', 'guardian_of>', ''];
  else if (me.youth && !row.youth) values = ['parent_of<', 'guardian_of<', ''];
  else values = [''];
  if (!values.includes(saved)) values = [saved, ...values];
  return values.map((value) => ({ value, label: label[value] }));
}

/* ── Problems (blocked save, D-331) ────────────────────────────────────── */

export interface DraftProblem {
  /** The id of the control to mark and focus. */
  fieldId: string;
  message: string;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function draftProblems(d: RecordDraft, record: PersonRecord): DraftProblem[] {
  const out: DraftProblem[] = [];
  // Names are required once touched: an old record with no split name still saves its other changes.
  const savedName = (k: 'first_name' | 'last_name') => str(record.detail.fields[k]).trim();
  if (!d.f.first_name.trim() && savedName('first_name') !== '') out.push({ fieldId: 'pr-first_name', message: 'First name is required' });
  if (!d.f.last_name.trim() && savedName('last_name') !== '') out.push({ fieldId: 'pr-last_name', message: 'Last name is required' });
  if (d.scout && !d.active && !record.scout?.is_webelos && !d.reason) {
    out.push({ fieldId: 'pr-reason', message: 'Pick why the scout is inactive' });
  }
  const seen = new Set<string>();
  d.emails.forEach((e, i) => {
    const n = norm(e.email);
    if (!EMAIL_SHAPE.test(n)) out.push({ fieldId: `pr-email-${i}`, message: `"${e.email || 'blank'}" is not an email address` });
    else if (seen.has(n)) out.push({ fieldId: `pr-email-${i}`, message: `${n} is listed twice` });
    seen.add(n);
  });
  const savedInitials = record.initials?.code ?? '';
  if (d.initials.trim() !== savedInitials) {
    if (!d.initials.trim() && savedInitials) {
      out.push({ fieldId: 'pr-initials', message: 'Initials can be retired, not cleared' });
    } else {
      const shape = initialsShapeProblem(d.initials);
      if (shape) out.push({ fieldId: 'pr-initials', message: shape });
    }
  }
  if (d.addMembers.length > 0 && !d.householdId) {
    out.push({ fieldId: 'pr-household', message: 'Pick a household before adding people to it' });
  }
  return out;
}

/* ── The diff: what Save sends ─────────────────────────────────────────── */

export interface SavePayload {
  people?: Record<string, string | boolean | null>;
  scout?: Record<string, string | number | boolean | null>;
  emails?: { remove: number[]; add: DraftEmail[]; relabel: { id: number; label: EmailLabel }[]; primary: string };
  household?: { household_id?: number | null; end_links?: boolean; add_members?: number[] };
  relationships?: { remove: number[]; add: { person_id: number; related_person_id: number; type: string }[] };
  roles?: { grant: string[]; end: number[] };
  initials?: { op: 'add' | 'rename' | 'retire' | 'restore'; code?: string }[];
}

export interface DraftDiff {
  payload: SavePayload;
  /** History lines for the record's own fields (link lines come from the database). */
  details: AuditDetail[];
  /** Labels of what changed, in page order — the record bar's line. */
  changed: string[];
  /** Explicit link changes (other person id), so the preview can say what ELSE happens. */
  explicitPairs: number[];
}

function display(key: string, value: string, ctx: { schoolName: (id: string) => string }): string {
  if (!value) return '—';
  if (DATE_KEYS.has(key)) return fmtDate(value);
  if (key === 'gender') return value === 'M' ? 'Male' : value === 'F' ? 'Female' : value;
  if (key === 'school_id') return ctx.schoolName(value);
  if (key === 'grade') return gradeLabel(Number(value));
  if (key === 'swim_class') return SWIM_CLASS_LABEL[value] ?? value;
  if (key === 'junior_leader_override') return value === 'yes' ? 'Yes' : value === 'no' ? 'No' : 'By position';
  return value;
}

export function diffDraft(
  record: PersonRecord,
  d: RecordDraft,
  ctx: { schoolName: (id: string) => string; householdLabel: (id: string) => string }
): DraftDiff {
  const saved = draftFromRecord(record);
  const payload: SavePayload = {};
  const details: AuditDetail[] = [];
  const changed: string[] = [];
  const explicitPairs: number[] = [];
  const isScout = d.scout != null && saved.scout != null;
  const note = (label: string) => {
    if (!changed.includes(label)) changed.push(label);
  };

  // People columns.
  const people: Record<string, string | boolean | null> = {};
  for (const k of PERSON_FIELD_KEYS) {
    const was = saved.f[k].trim();
    const now = d.f[k].trim();
    if (was === now) continue;
    people[k] = now || null;
    details.push({ field: FIELD_LABEL[k], from: display(k, was, ctx), to: display(k, now, ctx) });
    note(FIELD_LABEL[k]);
  }

  // Status: the scout's row for a scout, the person's otherwise. A Webelos has none.
  const statusChanged = d.active !== saved.active || (!d.active && d.reason.trim() !== saved.reason.trim());
  const webelos = !!record.scout?.is_webelos && isScout;
  const reasonText = (r: string) => (!r ? '—' : isScout ? (INACTIVE_REASON_LABEL[r as InactiveReason] ?? r) : r);
  if (statusChanged && !webelos) {
    const reason = d.active ? null : d.reason.trim() || null;
    details.push({ field: 'Status', from: saved.active ? 'Active' : 'Inactive', to: d.active ? 'Active' : 'Inactive' });
    details.push({ field: 'Reason', from: reasonText(saved.active ? '' : saved.reason), to: reasonText(reason ?? '') });
    note(FIELD_LABEL.status);
    if (!isScout) {
      people.active = d.active;
      people.inactive_reason = reason;
    }
  }
  if (Object.keys(people).length) payload.people = people;

  // The scout's row.
  if (isScout) {
    const s: Record<string, string | number | boolean | null> = {};
    const sd = d.scout!;
    const ss = saved.scout!;
    for (const k of ['patrol', 'school_id', 'grade', 'swim_class', 'junior_leader_override'] as const) {
      if (sd[k].trim() === ss[k].trim()) continue;
      const v = sd[k].trim();
      if (k === 'grade') s.graduation_year = v === '' ? null : gradYearFromGrade(Number(v), record.today);
      else if (k === 'school_id') s.school_id = v === '' ? null : Number(v);
      else s[k] = v || null;
      details.push({ field: FIELD_LABEL[k], from: display(k, ss[k], ctx), to: display(k, v, ctx) });
      note(FIELD_LABEL[k]);
    }
    if (statusChanged && !webelos) {
      s.active = d.active;
      s.inactive_reason = d.active ? null : d.reason || null;
    }
    if (Object.keys(s).length) payload.scout = s;
  }

  // Emails, matched by address: the saved rows' ids come from the record, never the browser.
  const savedByEmail = new Map(record.emails.map((e) => [norm(e.email), e]));
  const draftByEmail = new Map(d.emails.map((e) => [norm(e.email), e]));
  const remove = record.emails.filter((e) => !draftByEmail.has(norm(e.email))).map((e) => e.id);
  const add: DraftEmail[] = [];
  const relabel: { id: number; label: EmailLabel }[] = [];
  for (const e of d.emails) {
    const was = savedByEmail.get(norm(e.email));
    if (!was) add.push({ email: norm(e.email), label: e.label });
    else if (was.label !== e.label) {
      relabel.push({ id: was.id, label: e.label });
      details.push({ field: `Email ${was.email}`, from: was.label, to: e.label });
    }
  }
  const primaryChanged = d.primary !== saved.primary;
  if (remove.length || add.length || relabel.length || primaryChanged) {
    payload.emails = { remove, add, relabel, primary: d.primary };
    for (const e of record.emails.filter((x) => remove.includes(x.id))) {
      details.push({ field: `Email ${e.email}`, from: e.isPrimary ? `${e.label} (primary)` : e.label, to: 'removed' });
    }
    for (const e of add) {
      details.push({ field: `Email ${e.email}`, from: '—', to: e.email === d.primary ? `${e.label} (primary)` : e.label });
    }
    if (primaryChanged && d.primary && savedByEmail.has(d.primary) && !add.some((e) => e.email === d.primary)) {
      details.push({ field: 'Primary email', from: saved.primary || '—', to: d.primary });
    }
    note(FIELD_LABEL.emails);
  }

  // Household.
  const household: NonNullable<SavePayload['household']> = {};
  if (d.householdId !== saved.householdId) {
    household.household_id = d.householdId ? Number(d.householdId) : null;
    household.end_links = !!saved.householdId && d.endLinks;
    details.push({
      field: 'Household',
      from: saved.householdId ? ctx.householdLabel(saved.householdId) : '—',
      to: d.householdId ? ctx.householdLabel(d.householdId) : '—'
    });
    note(FIELD_LABEL.household);
  }
  if (d.addMembers.length) {
    household.add_members = d.addMembers.map((m) => m.personId);
    for (const m of d.addMembers) details.push({ field: `Household member ${m.name}`, from: '—', to: 'added' });
    note(FIELD_LABEL.household);
  }
  if (Object.keys(household).length) payload.household = household;

  // Family links: only parent / guardian / sibling rows are edited here.
  const rows = new Map((record.family ?? []).map((r) => [String(r.personId), r]));
  const relRemove: number[] = [];
  const relAdd: NonNullable<SavePayload['relationships']>['add'] = [];
  for (const [otherKey, choice] of Object.entries(d.family)) {
    const savedValue = saved.family[otherKey] ?? '';
    if (choice === savedValue) continue;
    const other = Number(otherKey);
    const row = rows.get(otherKey);
    if (row) for (const l of row.links) if (FAMILY_TYPES.has(l.type)) relRemove.push(l.id);
    if (choice) {
      const [type, dir] = choice === 'sibling_of' ? ['sibling_of', '>'] : [choice.slice(0, -1), choice.slice(-1)];
      relAdd.push(
        dir === '>'
          ? { person_id: record.personId, related_person_id: other, type }
          : { person_id: other, related_person_id: record.personId, type }
      );
    }
    explicitPairs.push(other);
    note(FIELD_LABEL.family);
  }
  if (relRemove.length || relAdd.length) payload.relationships = { remove: relRemove, add: relAdd };

  // Roles.
  if (!isScout) {
    const grant = d.roles.filter((r) => !saved.roles.includes(r) && (GRANTABLE_ROLES as readonly string[]).includes(r));
    const ending = saved.roles.filter((r) => !d.roles.includes(r));
    if (grant.length || ending.length) {
      const end = record.detail.roles.filter((r) => !r.end_date && ending.includes(r.role)).map((r) => r.id);
      payload.roles = { grant, end };
      for (const r of grant) details.push({ field: ROLE_LABEL[r] ?? r, from: 'none', to: 'granted' });
      for (const r of ending) details.push({ field: ROLE_LABEL[r] ?? r, from: 'held', to: 'ended' });
      note(FIELD_LABEL.roles);
    }
  }

  // Sign-off initials: add / rename, then retire / restore.
  const ops: NonNullable<SavePayload['initials']> = [];
  const code = d.initials.trim();
  if (!saved.initials && code) ops.push({ op: 'add', code });
  else if (saved.initials && code && code !== saved.initials) ops.push({ op: 'rename', code });
  if ((saved.initials || code) && d.initialsRetired !== saved.initialsRetired) {
    ops.push({ op: d.initialsRetired ? 'retire' : 'restore' });
  }
  if (ops.length) {
    payload.initials = ops;
    const from = saved.initials ? `${saved.initials}${saved.initialsRetired ? ' (retired)' : ''}` : '—';
    const to = code ? `${code}${d.initialsRetired ? ' (retired)' : ''}` : '—';
    details.push({ field: 'Sign-off initials', from, to });
    note(FIELD_LABEL.initials);
  }

  return { payload, details, changed, explicitPairs };
}

/* ── To finish ─────────────────────────────────────────────────────────── */

export interface ToFinishItem {
  key: string;
  label: string;
  fieldId: string;
  optional?: boolean;
}

export function toFinish(record: PersonRecord): ToFinishItem[] {
  const f = record.detail.fields;
  const items: ToFinishItem[] = [];
  const scout = isScoutRecord(record);
  if (!scout) {
    const ypt = yptStatus(str(f.ypt_completed) || null, record.today);
    if (ypt.status === 'missing') items.push({ key: 'ypt', label: 'YPT not on file', fieldId: 'pr-ypt_completed' });
    else if (ypt.status === 'expired') items.push({ key: 'ypt', label: 'YPT expired', fieldId: 'pr-ypt_completed' });
    else if (ypt.status === 'expiring') items.push({ key: 'ypt', label: 'YPT expiring soon', fieldId: 'pr-ypt_completed' });
  }
  if (!str(f.health_form_date)) items.push({ key: 'health', label: 'Health form missing', fieldId: 'pr-health_form_date' });
  if (!scout) {
    if (record.emails.length === 0) items.push({ key: 'email', label: 'No email address', fieldId: 'pr-email-add' });
    else if (!record.emails.some((e) => e.verifiedAt && !e.bouncedAt)) {
      items.push({ key: 'email', label: 'No verified email address', fieldId: 'pr-email-0' });
    }
  }
  if (!str(f.bsa_member_id)) items.push({ key: 'bsa', label: 'No BSA ID', fieldId: 'pr-bsa_member_id' });
  if (!scout && !record.detail.roles.some((r) => !r.end_date)) {
    items.push({ key: 'role', label: 'No role', fieldId: 'pr-role-add', optional: true });
  }
  return items;
}
