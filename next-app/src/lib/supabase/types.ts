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
  | 'award';

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
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  health_form_date: string | null;
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
