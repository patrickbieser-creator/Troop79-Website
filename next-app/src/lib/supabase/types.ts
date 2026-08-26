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

/**
 * Contact/demographic facts (address, phone, email, birthdate, gender, BSA
 * member id, health form date, things-we-should-know) moved to `people`,
 * read via `person_id` (Plans/Retire-Roster-Contact-Columns.md). `scouts`
 * keeps only patrol/rank/school-shaped facts — things true because this
 * person is currently a scout.
 */
export interface Scout {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  patrol: string | null;
  current_rank: string | null;
  school: string | null;
  /** Grade is derived from this (June 15 rollover) — see lib/demographics. */
  graduation_year: number | null;
  swim_class: 'swimmer' | 'beginner' | 'nonswimmer' | null;
  active: boolean;
  inactive_reason: InactiveReason | null;
  joined_date: string | null;
  last_activity: string | null;
  auth_user_id: string | null;
  /** The person spine link — every contact/demographic fact lives on this
   *  row's `people` counterpart. */
  person_id: number | null;
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

/**
 * Contact/demographic fields (address, phone, email, birthdate, BSA member
 * id, health form date, YPT completion, things-we-should-know) moved to
 * `people`, read via `person_id` (Plans/Retire-Roster-Contact-Columns.md).
 * `name` stays — trigger-derived from `people.display_name` for is_person
 * leaders, and the login label outright for non-person sign-off sources.
 */
export interface Leader {
  code: string;
  name: string;
  role: string | null;
  /** false for sign-off *sources* imported from the spreadsheet ("Turner
   *  Hall", "Council Clinic", ...) — Roll Call lists people only. */
  is_person: boolean;
  can_login: boolean;
  login_name: string | null;
  /** Set when these initials belong to a scout (youth leader), matched
   *  against that scout's own person_id. Youth = this person_id belongs to
   *  an ACTIVE scout; once the scout ages out (inactive, 'aged_out') the
   *  same initials count as an adult. */
  person_id: number | null;
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

export interface RankRequirement {
  id: number;
  rank_id: string;
  parent_id: number | null;
  code: string;
  label: string;
  complete_rule: 'all' | 'any' | 'n-of';
  complete_n: number | null;
  sort_order: number;
  venue: 'meeting' | 'outing' | 'either';
  skill_id: string | null;
}

/** Verbatim official BSA requirement wording — a leader-pasted reference
 *  field, kept out of rank_requirements/merit_badge_requirements so those
 *  public catalog tables gain no columns. Keyed by (source, parent_id, code)
 *  — the same stable natural key ledger_entries uses — not the bigserial
 *  requirement row id, which is regenerated on every catalog save. Service-
 *  role only (no RLS policies) — never fetched with the anon key. */
export interface RequirementOfficialText {
  id: number;
  source: 'rank' | 'mb';
  parent_id: string;
  code: string;
  official_text: string;
  source_url: string | null;
  updated_at: string;
  updated_by: string | null;
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
  /** Shares the calendar_entries vocabulary — literally: same FK into
   *  calendar_categories since D-082, so a rename reaches albums too. */
  category: string;
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

/* 'event' retired 2026-08-08 (Event→News promotion): an event is a
   calendar_entries row promoted into the feed, never an article. Rows are
   converted by the drop_legacy migration. */
export type ArticleType = 'news' | 'recognition';
/** 'pending' = proposed from /news/submit by a verified family member or
 *  scout, awaiting a leader's review (20260816170000). 'draft' remains a
 *  leader's own work in progress. */
export type ArticleStatus = 'pending' | 'draft' | 'published';
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

/* `Tag` is gone (2026-08-21): news shares the ONE taxonomy with calendar
   entries — calendar_categories, joined via article_categories. See
   lib/news-feed NewsCategory. */

/*
 * The CalendarCategory union that used to stand here is gone (D-082):
 * categories are rows in `calendar_categories`, editable from Lookups & Admin,
 * so a build-time union would be a fourth copy of a vocabulary that already
 * drifted once (the 2026-07-21 photo-album CHECK bug). `category` is plain
 * text validated by an FK; the row shape and helpers live in
 * lib/calendar-categories.ts.
 */

export interface CalendarEntry {
  id: number;
  entry_date: string;
  end_date: string | null;
  day_note: string | null;
  /** FK to calendar_categories.label (D-082) — validated by the DB, not a union. */
  category: string;
  title: string;
  description: string | null;
  location: string | null;
  /** "HH:MM:SS", nullable — not every entry has a known time of day. */
  start_time: string | null;
  end_time: string | null;
  /* Event→News promotion (Plans/Event-News-Promotion.md). article_id is
     gone from this type ahead of the drop_legacy migration on purpose — the
     compiler is what enforces the removal sweep. */
  /** Off = external opportunity: keeps its /events page and news promotion,
   *  never appears on the troop calendar/ICS/homepage sidebar. */
  on_calendar: boolean;
  /** 'draft' = staged by a leader, invisible on every public surface.
   *  INDEPENDENT of on_calendar, which is a month-grid display filter — a
   *  published entry with on_calendar=false is the normal news-shaped case
   *  (20260816170000). */
  status: 'draft' | 'published';
  show_on_homepage: boolean;
  featured: boolean;
  /** Position in the home page's curated order (2026-08-21); null = unordered. */
  featured_order: number | null;
  promo_start: string | null;
  promo_end: string | null;
  hero_media_id: number | null;
  auto_archive_at: string | null;
  /** Markdown event details shown on /events/[id]. Added by the Event Signup
   *  Phase 1 migration; null on entries authored before it. */
  details_md: string | null;
  /** Leader who created the entry. Attribution only — unlike
   *  articles.author_name it does not gate editing, because calendar entries
   *  are leader-only to edit outright. Null on entries that predate the column. */
  author_name: string | null;
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
  auto_archive_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Resource Library (Plans/Resource-Library.md) ────────────────────────────

export interface LibraryTopic {
  id: number;
  slug: string;
  title: string;
  blurb_md: string | null;
  icon: string | null;
  sort_order: number;
  retired_at: string | null;
  created_at: string;
}

export interface LibraryResource {
  id: number;
  title: string;
  blurb: string | null;
  kind: 'link' | 'video' | 'document' | 'image' | 'post';
  url: string | null;
  body_md: string | null;
  thumbnail_url: string | null;
  host: string | null;
  visibility: 'public' | 'leaders';
  status: 'pending' | 'published' | 'archived';
  submitted_by_label: string | null;
  submitted_person_id: number | null;
  submitter_note: string | null;
  /** Webmaster-editable public credit; defaults from submitted_by_label at publish. */
  attribution_label: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  decline_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface LibraryPlacement {
  id: number;
  resource_id: number;
  target_kind: 'rank_req' | 'mb' | 'mb_req' | 'topic';
  target_key: string;
  pinned: boolean;
  sort_order: number;
  created_at: string;
}

export interface RequirementNote {
  id: number;
  target_kind: 'rank_req' | 'mb' | 'mb_req';
  target_key: string;
  narrative_md: string;
  updated_by: string | null;
  updated_at: string;
}

export interface RequirementSubmission {
  id: number;
  scout_id: string;
  target_kind: 'rank_req' | 'mb_req';
  target_key: string;
  proof_type: 'photo' | 'report' | 'link';
  body_md: string | null;
  link_url: string | null;
  /** Private-bucket storage paths (never public CDN) — see Plans/Resource-Library.md. */
  media: unknown[];
  submitted_via: 'family' | 'scout';
  status: 'pending' | 'approved' | 'returned';
  feedback_md: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  ledger_entry_id: number | null;
  created_at: string;
}
