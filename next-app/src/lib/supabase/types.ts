/**
 * Hand-maintained DB row types. When the schema settles, replace these with
 * generated types from `supabase gen types typescript --local > types.ts`.
 */

export type LedgerKind =
  | 'rank_requirement'
  | 'rank_award'
  | 'merit_badge_requirement'
  | 'merit_badge_award'
  | 'service_hours'
  | 'camping_nights'
  | 'hiking_miles'
  | 'day_outing'
  | 'fundraiser'
  | 'leadership'
  | 'award'
  | 'meeting_attendance';

export interface MeritBadge {
  id: string;
  name: string;
  eagle: boolean;
  scoutbook_id: string | null;
  bsa_page_url: string | null;
  workbook_url: string | null;
}

export interface MeritBadgeRequirement {
  id: number;
  mb_id: string;
  parent_id: number | null;
  code: string;
  label: string;
  complete_rule: 'all' | 'any' | 'n-of';
  complete_n: number | null;
  sort_order: number;
}

export type InactiveReason =
  | 'dropped_out'
  | 'transferred'
  | 'moved_away'
  | 'aged_out'
  | 'other';

export const INACTIVE_REASON_LABEL: Record<InactiveReason, string> = {
  dropped_out: 'Dropped out',
  transferred: 'Transferred to another troop',
  moved_away: 'Moved away',
  aged_out: 'Aged out',
  other: 'Other'
};

export interface Scout {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  patrol: string | null;
  current_rank: string | null;
  bsa_member_id: string | null;
  birthdate: string | null;
  gender: 'M' | 'F' | null;
  school: string | null;
  /** Grade is derived from this (Aug 1 rollover) — see lib/demographics. */
  graduation_year: number | null;
  swim_class: 'swimmer' | 'beginner' | 'nonswimmer' | null;
  active: boolean;
  inactive_reason: InactiveReason | null;
  joined_date: string | null;
  last_activity: string | null;
  auth_user_id: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  health_form_date: string | null;
  /** Freeform: food allergies, medical conditions, special needs (D-014
   *  supersede). Admin-entered for now; the planned family self-service flow
   *  (Plans/) will let households propose updates here too, gated through
   *  review-approval before they take effect. */
  things_we_should_know: string | null;
}

export interface ScoutParent {
  id?: number;
  scout_id: string;
  name: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  same_address_as_scout: boolean;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  sort_order: number;
}

export interface Leader {
  code: string;
  name: string;
  role: string | null;
  /** false for sign-off *sources* imported from the spreadsheet ("Turner
   *  Hall", "Council Clinic", ...) — Roll Call lists people only. */
  is_person: boolean;
  /** Set when these initials belong to a scout (youth leader). Youth =
   *  scout_id set AND that scout is active; once the scout ages out
   *  (inactive, 'aged_out') the same initials count as an adult. */
  scout_id: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  health_form_date: string | null;
  birthdate: string | null;
  bsa_member_id: string | null;
  /** YPT completion date; certification runs two years (derived status). */
  ypt_completed: string | null;
  /** Freeform: food allergies, medical conditions, special needs (D-014
   *  supersede). Admin-entered for now; the planned family self-service flow
   *  (Plans/) will let households propose updates here too, gated through
   *  review-approval before they take effect. */
  things_we_should_know: string | null;
}

export interface MeritBadgeCounselor {
  mb_id: string;
  leader_code: string;
  sort_order: number;
}

export interface LedgerEntry {
  id: number;
  scout_id: string;
  date: string;
  kind: LedgerKind;
  code: string;
  label: string | null;
  by: string | null;
  qty: number;
  unit: string;
  notes: string | null;
  entered_by: string | null;
  entered_at: string;
  archived_at: string | null;
  archived_by: string | null;
  archived_reason: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  deleted_reason: string | null;
  scoutbook_submitted_at: string | null;
  scoutbook_submitted_by: string | null;
  presented_at: string | null;
  presented_by: string | null;
}

export interface MbProgressRow {
  mb_id: string;
  scout_id: string;
  awarded: boolean;
  has_any_req: boolean;
}

export interface ScoutSummaryRow {
  scout_id: string;
  mb_count: number;
  eagle_mb_count: number;
  camping_nights: number;
  service_hours: number;
  last_activity_date: string | null;
}

export interface Rank {
  id: string;
  display_name: string;
  color: string | null;
  sort_order: number;
}

export interface Event {
  id: number;
  name: string;
  /** Stored classification (Campout, Hike, Day Outing, Fundraiser, ...) so
   *  Fast Entry can resolve the ledger kind automatically for a recurring
   *  event instead of asking the leader to re-pick a Type every time. */
  default_kind: LedgerKind | null;
  created_at?: string;
}

// ─── Meeting Plan ───────────────────────────────────────────────────────────

export type ReqVenue = 'meeting' | 'outing' | 'either';

export interface Skill {
  id: string;
  name: string;
  /** Whether an authorized older scout (Star+) may teach this skill. Adult-
   *  instruction skills per the Guide to Safe Scouting stay false. */
  youth_teachable: boolean;
  sort_order: number;
}

export interface LeaderSkill {
  leader_code: string;
  skill_id: string;
}

export interface ScoutInstructor {
  scout_id: string;
  skill_id: string;
  authorized_by: string | null;
  authorized_at: string;
}

export interface MeetingPlanRow {
  id: number;
  meeting_date: string;
  title: string;
  status: 'draft' | 'published';
  /** MeetingPlanPayload snapshot (see lib/meeting-plan-types.ts). */
  payload: unknown;
  generated_at: string;
  generated_by: string | null;
}

// ─── Photo Albums (Google Photos index) ─────────────────────────────────────

export interface PhotoAlbum {
  id: number;
  title: string;
  event_date: string;
  /** Shares the calendar_entries category vocabulary. */
  category: CalendarCategory;
  google_url: string;
  cover_media_id: number | null;
  description: string | null;
  /** Leader-maintained and approximate — shared albums keep growing. */
  photo_count: number | null;
  created_at: string;
  updated_at: string;
}

// ─── Meetings (published agendas) ───────────────────────────────────────────

export type MeetingStatus = 'draft' | 'published';
export type MeetingSection = 'pre_meeting' | 'agenda';

export interface Meeting {
  id: number;
  meeting_date: string;
  status: MeetingStatus;
  title: string;
  time_range: string | null;
  uniform: string | null;
  location: string | null;
  location_address: string | null;
  snack: string | null;
  flag_ceremony: string | null;
  cleanup: string | null;
  duty_roster_url: string | null;
  updated_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Leader-side meeting attendance (scouts live in ledger_entries with
 *  kind='meeting_attendance', code='MTG:<date>'). status 'committed' is
 *  reserved for the future meeting-plan signup flow (optionally with the
 *  skill the leader commits to teach); Roll Call writes 'attended'. */
export interface MeetingAttendanceLeader {
  id: number;
  meeting_date: string;
  leader_code: string;
  status: 'committed' | 'attended';
  skill_id: string | null;
  note: string | null;
  created_at: string;
}

export interface SessionRequirementRef {
  code: string;
  label: string;
}

export interface MeetingSession {
  id: number;
  meeting_id: number;
  section: MeetingSection;
  sort_order: number;
  time_label: string | null;
  title: string;
  description: string | null;
  track: string | null;
  leader_name: string | null;
  contact_name: string | null;
  /** NEVER sent to public pages — the public loader strips it (Patrick,
   *  2026-07-12: contact name public, phone post-login only). */
  contact_phone: string | null;
  skill_id: string | null;
  mb_id: string | null;
  requirements: SessionRequirementRef[] | null;
  /** Public display names, e.g. ["Anjali S.", "Finn P."]. */
  scouts: string[] | null;
}

// ─── News & Events CMS ──────────────────────────────────────────────────────

export type ArticleType = 'news' | 'event' | 'recognition';
export type ArticleStatus = 'draft' | 'published';
export type AuthorRole = 'leader' | 'scout';

export interface Media {
  id: number;
  bunny_path: string;
  cdn_url: string;
  alt_text: string | null;
  caption: string | null;
  uploaded_by: string;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface Tag {
  id: number;
  name: string;
  slug: string;
}

/**
 * The 13 event types the signup preset matrix keys off, plus 'No Meeting'
 * (calendar-only — signup never applies). Renamed/merged 2026-07-18 by the
 * Event Signup Phase 1 migration; 'Court of Honor' and 'Ceremony' collapsed
 * into 'Ceremony / Recognition'.
 */
export type CalendarCategory =
  | 'Troop Meeting'
  | 'Campout / Overnight'
  | 'Day Activity / Outing'
  | 'High Adventure'
  | 'Summer Camp'
  | 'Service Project'
  | 'Fundraiser'
  | 'Advancement Event'
  | 'Training'
  | 'Ceremony / Recognition'
  | 'Leadership / Planning'
  | 'Recruiting / Outreach'
  | 'Social Event'
  | 'No Meeting';

export interface CalendarEntry {
  id: number;
  entry_date: string;
  end_date: string | null;
  day_note: string | null;
  category: CalendarCategory;
  title: string;
  description: string | null;
  location: string | null;
  /** "HH:MM:SS", nullable — not every entry has a known time of day. */
  start_time: string | null;
  end_time: string | null;
  article_id: number | null;
  /** Markdown event details shown on /events/[id]. Added by the Event Signup
   *  Phase 1 migration; null on entries authored before it. */
  details_md: string | null;
  created_at: string;
  updated_at: string;
}

export interface Article {
  id: number;
  slug: string;
  title: string;
  type: ArticleType;
  excerpt: string | null;
  hero_media_id: number | null;
  body: string;
  status: ArticleStatus;
  author_name: string;
  author_role: AuthorRole;
  published_at: string | null;
  featured: boolean;
  featured_order: number | null;
  archived_at: string | null;
  archived_by: string | null;
  event_start: string | null;
  event_end: string | null;
  event_location: string | null;
  event_registration_url: string | null;
  created_at: string;
  updated_at: string;
}
