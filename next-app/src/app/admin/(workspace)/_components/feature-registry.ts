/**
 * The admin feature registry (Plans/Admin-Portal-Nav.md): every screen, report, task and setup page a leader can open,
 * in one list. The rail, the area menus, Home, search, Everything A–Z and Reports all read it; nothing keeps a second
 * hand-written list. Today's section bar, tabs and Home card grid are DERIVED from it (nav-data.ts LEGACY_SECTIONS)
 * until the rail replaces them.
 *
 * A plain module on purpose (no 'use client'): a const exported from a client file reaches server code as a client
 * reference.
 *
 * Adding an admin page: register it here, or list its route in UNLISTED with a reason. The guard test
 * (tests/admin-feature-registry.test.ts) fails a page that does neither.
 */
import type { Capability } from '@/lib/capabilities';

/** The rail's groups, in rail order. Home is the rail's first entry, not a menu. */
export const AREAS = ['home', 'meetings', 'advancement', 'content', 'money', 'people', 'reports', 'setup'] as const;
export type Area = (typeof AREAS)[number];

/** The four columns of an area menu: Do · Screens · Reports · Setup. */
export type FeatureKind = 'action' | 'screen' | 'report' | 'setup';

export interface Feature {
  /** Stable id, '<area>.<name>'. Pins and nav events store it, so never rename one that has shipped. */
  key: string;
  label: string;
  /** One line, optional. */
  description?: string;
  /** Extra search words. */
  aliases?: string[];
  /** The group the item belongs to (its home menu). */
  area: Area;
  kind: FeatureKind;
  /** Deep link, including ?tab= / ?do= / ?card= where needed. */
  href: string;
  /** Other menus that list it too: every report is also in Reports; shared lists show in Setup. */
  alsoIn?: Area[];
  /**
   * The capability the target page requires. Must match the page's own guard; the registry only stops offering links
   * that would refuse, it is not the security boundary. Absent (and not `everyone` / `planner` / `healthViewersOnly` /
   * `landing`) means full admins only.
   */
  capability?: Capability;
  /** Offered to every leader (Home: the inbox each person sees filtered to what they hold). */
  everyone?: boolean;
  /** On the public Meeting Planner: shown only when plannerAccess(actor).canView (decision 13). */
  planner?: boolean;
  /** Shown only to an admin on the health viewers list. Not a capability, so never implied by full admin. */
  healthViewersOnly?: boolean;
  /** Ordered by the sale's season: first while it is open, last and greyed otherwise. */
  seasonal?: 'wreaths';
  /** A landing page for every feature of this kind (Reports): visible exactly when at least one of them is. */
  landing?: FeatureKind;
  /** Primary items lead their column. */
  tier?: 'primary' | 'secondary';
}

const ADV: Capability = 'advancement.write';
const ROSTER: Capability = 'roster.manage';
const FIN: Capability = 'finance.manage';
const LIB: Capability = 'library.moderate';
const NEWS: Capability = 'news.write';
const CAL: Capability = 'calendar.write';

export const FEATURES: Feature[] = [
  // ── Home ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  { key: 'home', label: 'Home', area: 'home', kind: 'screen', href: '/admin', everyone: true, tier: 'primary' },

  // ── Meetings: convenience links to the public planner (decision 13) ──────────────────────────────────────────────────
  { key: 'meetings.roll-call', label: 'Take roll call', area: 'meetings', kind: 'action', href: '/planner/live', planner: true, aliases: ['attendance', 'roll'] },
  { key: 'meetings.invite', label: 'Invite teachers', area: 'meetings', kind: 'action', href: '/planner', planner: true, aliases: ['teachers', 'invites'] },
  { key: 'meetings.publish', label: "Publish this week's plan", area: 'meetings', kind: 'action', href: '/planner', planner: true },
  { key: 'meetings.this-week', label: "This week's plan", description: 'The coming meeting: groups, stations and teachers', area: 'meetings', kind: 'screen', href: '/planner', planner: true, tier: 'primary', aliases: ['meeting planner', 'planner'] },
  { key: 'meetings.live', label: 'Meeting Live', description: 'Run tonight’s meeting', area: 'meetings', kind: 'screen', href: '/planner/live', planner: true, tier: 'primary', aliases: ['tonight'] },
  { key: 'meetings.rotations', label: 'Rotations', area: 'meetings', kind: 'screen', href: '/planner/rotations', planner: true, aliases: ['stations'] },
  { key: 'meetings.focus-sets', label: 'Focus sets', area: 'meetings', kind: 'screen', href: '/planner/focus-sets', planner: true },
  { key: 'meetings.theme-calendar', label: 'Theme calendar', description: 'The focus of each coming meeting', area: 'meetings', kind: 'screen', href: '/planner/calendar', planner: true },
  { key: 'meetings.has-needs', label: 'Has / Needs', area: 'meetings', kind: 'screen', href: '/planner/has-needs', planner: true },
  { key: 'meetings.emails', label: 'Meeting emails', area: 'meetings', kind: 'screen', href: '/planner/emails', planner: true },
  { key: 'meetings.suggestions', label: 'Suggestions', area: 'meetings', kind: 'screen', href: '/planner/suggestions', planner: true },
  { key: 'meetings.attendance', label: 'Attendance Report', description: 'Meeting attendance per scout and per adult', area: 'meetings', kind: 'report', href: '/admin/advancement/meetings/report', alsoIn: ['reports'], capability: ADV },
  { key: 'meetings.teaching-skills', label: 'Teaching skills', description: 'Teaching skills, and which older scouts may teach', area: 'meetings', kind: 'setup', href: '/admin/advancement/lookups?card=skills', alsoIn: ['setup'], capability: ROSTER },

  // ── Advancement ─────────────────────────────────────────────────────────────────────────────────────────────────────
  { key: 'advancement.review-proof', label: 'Review proof submissions', area: 'advancement', kind: 'action', href: '/admin/library?tab=proof', capability: LIB, aliases: ['proof queue'] },
  { key: 'advancement.publish-report', label: 'Publish the Advancement Report', area: 'advancement', kind: 'action', href: '/admin/advancement/report', capability: ADV, aliases: ['bugle'] },
  { key: 'advancement.scoutbook-submitted', label: 'Mark Scoutbook uploads submitted', area: 'advancement', kind: 'action', href: '/admin/advancement/records', capability: ADV },
  { key: 'advancement.fast-entry', label: 'Fast Entry', description: 'Sign off requirements for many scouts at once', area: 'advancement', kind: 'screen', href: '/admin/advancement/fast-entry', capability: ADV, tier: 'primary', aliases: ['sign off'] },
  { key: 'advancement.ledger', label: 'Advancement Ledger', description: 'Every requirement, rank and badge on record', area: 'advancement', kind: 'screen', href: '/admin/advancement/ledger', capability: ADV },
  { key: 'advancement.records', label: 'Submit & Present', description: 'Council submissions and awards to hand out', area: 'advancement', kind: 'screen', href: '/admin/advancement/records', capability: ADV, aliases: ['scoutbook', 'awards'] },
  { key: 'advancement.approvals', label: 'Approvals', description: 'Proof submissions approved in the past two months', area: 'advancement', kind: 'screen', href: '/admin/advancement/approvals', capability: ADV },
  // Retired in phase 4 (decision 7): its cards move to Home, the old URL redirects to /admin.
  { key: 'advancement.dashboard', label: 'Advancement Dashboard', description: 'Active scouts, ledger, Court of Honor candidates and recent sign-ins', area: 'advancement', kind: 'screen', href: '/admin/advancement/dashboard', capability: ADV },
  { key: 'advancement.report', label: 'Advancement Report', description: 'What got signed off in a date range, for the Bugle and the public site', area: 'advancement', kind: 'report', href: '/admin/advancement/report', alsoIn: ['reports'], capability: ADV },
  { key: 'advancement.court-of-honor', label: 'Court of Honor', description: 'Ranks, merit badges and awards earned in a date range', area: 'advancement', kind: 'report', href: '/admin/advancement/court-of-honor', alsoIn: ['reports'], capability: ADV, aliases: ['coh'] },
  { key: 'advancement.scoutbook-export', label: 'Scoutbook Export', description: "Awards in a date range, formatted for Scoutbook's bulk upload", area: 'advancement', kind: 'report', href: '/admin/advancement/scoutbook-export', alsoIn: ['reports'], capability: ADV },
  { key: 'advancement.audits', label: 'Audits', description: 'Data-quality checks that flag ledger records that look wrong', area: 'advancement', kind: 'report', href: '/admin/advancement/audits', alsoIn: ['reports'], capability: ADV },
  { key: 'advancement.requirement-classes', label: 'Requirement classes', description: 'Where a requirement can be done: meeting, campout, aquatics…', area: 'advancement', kind: 'setup', href: '/admin/advancement/lookups?card=requirement-classes', alsoIn: ['setup'], capability: ROSTER },

  // ── Website Content ─────────────────────────────────────────────────────────────────────────────────────────────────
  { key: 'content.add-calendar-entry', label: 'Add a calendar entry', area: 'content', kind: 'action', href: '/admin/calendar', capability: CAL, aliases: ['new event', 'campout'] },
  { key: 'content.build-signup', label: 'Build a sign-up', area: 'content', kind: 'action', href: '/admin/calendar', capability: CAL, aliases: ['signup', 'registration'] },
  { key: 'content.write-article', label: 'Write an article', area: 'content', kind: 'action', href: '/admin/news/articles', capability: NEWS, aliases: ['bugle', 'post'] },
  { key: 'content.calendar', label: 'Calendar', description: 'Meetings, campouts, sign-ups and roll call', area: 'content', kind: 'screen', href: '/admin/calendar', capability: CAL, tier: 'primary', aliases: ['events'] },
  { key: 'content.news', label: 'News & Bugle', description: 'Articles and the weekly Bugle', area: 'content', kind: 'screen', href: '/admin/news/articles', capability: NEWS, aliases: ['articles', 'newsletter'] },
  { key: 'content.pages', label: 'Pages', description: 'Join, About and other site pages', area: 'content', kind: 'screen', href: '/admin/news/pages', capability: NEWS },
  { key: 'content.media', label: 'Media Manager', description: 'Images and video on the CDN', area: 'content', kind: 'screen', href: '/admin/news/media-manager', capability: NEWS, aliases: ['images', 'photos', 'bunny'] },
  { key: 'content.photo-albums', label: 'Photo Albums', description: 'Gallery links for events', area: 'content', kind: 'screen', href: '/admin/news/photo-albums', capability: NEWS, aliases: ['gallery'] },
  { key: 'content.library', label: 'Resource Library', description: 'Study guides, proof submissions, the queue', area: 'content', kind: 'screen', href: '/admin/library', capability: LIB },
  { key: 'content.menu-monster', label: 'Menu Monster', description: 'Recipes, ingredients and prices for patrol cooking', area: 'content', kind: 'screen', href: '/admin/library/menu-monster', capability: LIB, aliases: ['recipes', 'cooking'] },
  { key: 'content.price-book', label: 'Price book', area: 'content', kind: 'screen', href: '/admin/library/menu-monster?tab=prices', capability: LIB, aliases: ['prices', 'brands'] },
  { key: 'content.topics', label: 'Topics & shelves', area: 'content', kind: 'setup', href: '/admin/library?tab=topics', capability: LIB },
  { key: 'content.narratives', label: 'Narratives', area: 'content', kind: 'setup', href: '/admin/library?tab=narratives', capability: LIB },
  { key: 'content.cooking-gear', label: 'Cooking gear', area: 'content', kind: 'setup', href: '/admin/library/menu-monster?tab=gear', capability: LIB },

  // ── Money ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  { key: 'money.record', label: 'Record a transaction', area: 'money', kind: 'action', href: '/admin/finance?do=record', capability: FIN, aliases: ['deposit', 'payment', 'expense'] },
  { key: 'money.approve-reimbursements', label: 'Approve reimbursements', area: 'money', kind: 'action', href: '/admin/finance/reimbursements', capability: FIN, aliases: ['receipts'] },
  { key: 'money.transfer', label: 'Transfer between accounts', area: 'money', kind: 'action', href: '/admin/finance?do=transfer', capability: FIN },
  { key: 'money.reconcile', label: 'Monthly reconciliation', area: 'money', kind: 'action', href: '/admin/finance?do=reconcile', capability: FIN, aliases: ['recon', 'bank statement'] },
  { key: 'money.move-departed-balance', label: "Move a departed scout's balance", area: 'money', kind: 'action', href: '/admin/finance/scout-accounts', capability: FIN, aliases: ['troop fund'] },
  { key: 'money.ledger', label: 'Financial Ledger', description: 'Every dollar in and out of the troop account', area: 'money', kind: 'screen', href: '/admin/finance', capability: FIN, tier: 'primary', aliases: ['finance', 'transactions'] },
  { key: 'money.reimbursements', label: 'Reimbursements', description: 'Approve, deny and pay back receipts', area: 'money', kind: 'screen', href: '/admin/finance/reimbursements', capability: FIN },
  { key: 'money.wreaths', label: 'Wreath Sale orders', description: 'Orders, sellers and the Rose order', area: 'money', kind: 'screen', href: '/admin/finance/wreaths', capability: FIN, seasonal: 'wreaths', aliases: ['wreaths'] },
  { key: 'money.scout-accounts', label: 'Scout Accounts', description: 'Balance and history for each scout', area: 'money', kind: 'screen', href: '/admin/finance/scout-accounts', capability: FIN },
  { key: 'money.bucket-report', label: 'Bucket Report', description: 'Income and spending by bucket', area: 'money', kind: 'report', href: '/admin/finance/report', alsoIn: ['reports'], capability: FIN },
  { key: 'money.ledger-audit', label: 'Ledger Audit', description: 'Match the ledger to the bank statement', area: 'money', kind: 'report', href: '/admin/utilities/ledger-audit', alsoIn: ['reports'], capability: FIN, aliases: ['bank match'] },
  { key: 'money.wreath-dashboard', label: 'Wreath Sale Dashboard', area: 'money', kind: 'report', href: '/admin/finance/wreaths?tab=dashboard', alsoIn: ['reports'], capability: FIN },
  { key: 'money.wreath-reconciliation', label: 'Wreath Reconciliation', area: 'money', kind: 'report', href: '/admin/finance/wreaths?tab=reconciliation', alsoIn: ['reports'], capability: FIN },
  { key: 'money.rose-order', label: 'Rose order', area: 'money', kind: 'report', href: '/admin/finance/wreaths?tab=rose', alsoIn: ['reports'], capability: FIN },
  { key: 'money.buckets', label: 'Buckets', area: 'money', kind: 'setup', href: '/admin/finance/report', alsoIn: ['setup'], capability: FIN },
  { key: 'money.kinds', label: 'Transaction kinds', area: 'money', kind: 'setup', href: '/admin/finance?do=kinds', alsoIn: ['setup'], capability: FIN },
  { key: 'money.wreath-setup', label: 'Wreath items and sellers', area: 'money', kind: 'setup', href: '/admin/finance/wreaths?tab=items', capability: FIN },
  { key: 'money.export', label: 'Export ledger CSV', area: 'money', kind: 'setup', href: '/admin/finance/export', capability: FIN, aliases: ['backup'] },

  // ── People ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  { key: 'people.confirm-roster-changes', label: 'Confirm roster changes', area: 'people', kind: 'action', href: '/admin/advancement/roster', capability: ROSTER },
  { key: 'people.add', label: 'Add a scout or adult', area: 'people', kind: 'action', href: '/admin/advancement/roster', capability: ROSTER, aliases: ['new scout', 'new parent'] },
  { key: 'people.patrols', label: 'Assign patrols', area: 'people', kind: 'action', href: '/admin/advancement/roster/patrols', capability: ROSTER },
  { key: 'people.sign-in-link', label: 'Send a sign-in link', area: 'people', kind: 'action', href: '/admin/advancement/roster', capability: ROSTER, aliases: ['login link'] },
  { key: 'people.roster', label: 'Roster', description: 'Scouts, adults and households', area: 'people', kind: 'screen', href: '/admin/advancement/roster', capability: ROSTER, tier: 'primary', aliases: ['scouts', 'adults', 'parents'] },
  { key: 'people.health-forms', label: 'Health Forms', description: 'Forms, reviews and the binder', area: 'people', kind: 'screen', href: '/admin/health-forms', healthViewersOnly: true, aliases: ['medical'] },
  { key: 'people.access', label: 'Access', description: 'Who can use which admin tools', area: 'people', kind: 'screen', href: '/admin/access', alsoIn: ['setup'], capability: ROSTER, aliases: ['permissions', 'capabilities'] },
  { key: 'people.family-roster', label: 'Family Roster print', area: 'people', kind: 'report', href: '/admin/roster-print', alsoIn: ['reports'], capability: ROSTER, aliases: ['pdf', 'directory'] },
  { key: 'people.health-log', label: 'Health access log', area: 'people', kind: 'report', href: '/admin/health-forms/log', alsoIn: ['reports'], healthViewersOnly: true },
  { key: 'people.households', label: 'Households', area: 'people', kind: 'setup', href: '/admin/advancement/lookups?card=households', alsoIn: ['setup'], capability: ROSTER, aliases: ['families'] },
  { key: 'people.schools', label: 'Schools', area: 'people', kind: 'setup', href: '/admin/advancement/lookups?card=schools', alsoIn: ['setup'], capability: ROSTER },
  { key: 'people.health-viewers', label: 'Who can open health records', area: 'people', kind: 'setup', href: '/admin/health-forms/viewers', healthViewersOnly: true },

  // ── Reports (the site's own; every other report lives in its area and is alsoIn Reports) ────────────────────────────
  { key: 'reports.index', label: 'Reports', area: 'reports', kind: 'screen', href: '/admin/reports', landing: 'report' },
  { key: 'reports.sign-ins', label: 'Recent Sign-ins', area: 'reports', kind: 'report', href: '/admin/advancement/dashboard/logins', capability: ADV, aliases: ['logins'] },
  { key: 'reports.analytics', label: 'Site Analytics', area: 'reports', kind: 'report', href: '/admin/advancement/dashboard/analytics', capability: ADV, aliases: ['traffic', 'visits'] },

  // ── Setup ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  { key: 'setup.emailoctopus', label: 'Sync the EmailOctopus list', area: 'setup', kind: 'action', href: '/admin/newsletter', capability: ROSTER, aliases: ['mailing list', 'newsletter'] },
  { key: 'setup.bsa-roster', label: 'Compare with the BSA roster', area: 'setup', kind: 'action', href: '/admin/advancement/bsa-roster', capability: ROSTER, aliases: ['my.scouting', 'registration'] },
  { key: 'setup.lookups', label: 'All lists', description: 'Every lookup list the site uses', area: 'setup', kind: 'setup', href: '/admin/advancement/lookups', capability: ROSTER, aliases: ['lookups'] },
  { key: 'setup.audit-trail', label: 'Audit Trail', description: 'Who changed news, calendar, roster and library content', area: 'setup', kind: 'report', href: '/admin/audit', alsoIn: ['reports'], capability: ROSTER, aliases: ['history', 'changes'] },
  { key: 'setup.styleguides', label: 'Styleguides', area: 'setup', kind: 'setup', href: '/admin/styleguide' },
  // Retired in phase 6: /admin/utilities redirects to /admin/reports.
  { key: 'setup.utilities', label: 'Utilities', area: 'setup', kind: 'screen', href: '/admin/utilities', capability: NEWS }
];

/**
 * Admin page routes that are deliberately not registered, each with its reason. Detail pages open from a list, retired
 * routes redirect, and sub-pages belong to a registered parent. A new page goes in FEATURES or here; never neither.
 */
export const UNLISTED: Readonly<Record<string, string>> = {
  '/admin/advancement': 'redirect to /admin',
  '/admin/advancement/has-needs': 'redirect to /planner/has-needs',
  '/admin/advancement/meeting-plan': 'redirect to /planner',
  '/admin/advancement/meeting-plan/by-scout': 'redirect to /planner',
  '/admin/advancement/meetings': 'redirect to /admin/calendar',
  '/admin/advancement/meetings/[id]': 'detail: one meeting’s agenda, opened from its calendar entry',
  '/admin/advancement/meetings/[id]/attendance': 'redirect to the calendar entry’s roll call',
  '/admin/advancement/approvals/[id]': 'detail: one approval, opened from Approvals',
  '/admin/advancement/roster/[personId]': 'detail: one person’s record, opened from the Roster',
  '/admin/calendar/[id]': 'detail: one calendar entry, opened from the Calendar',
  '/admin/calendar/[id]/roll-call': 'redirect to the entry’s Roll Call tab',
  '/admin/events': 'redirect to /admin/calendar',
  '/admin/events/[id]': 'redirect to the calendar entry’s Signup tab',
  '/admin/rosters': 'redirect to /admin/calendar',
  '/admin/rosters/[id]': 'detail: an event roster, opened from the entry’s Signup tab',
  '/admin/rosters/[id]/assignments': 'detail: an event roster’s assignments',
  '/admin/rosters/[id]/money': 'detail: an event roster’s money',
  '/admin/rosters/[id]/snapshot': 'detail: an event roster’s print snapshot',
  '/admin/library/menu-monster/recipes/[recipeId]': 'detail: one recipe, opened from Menu Monster',
  '/admin/news/articles/[id]': 'detail: one article, opened from News',
  '/admin/news/pages/[id]': 'detail: one page, opened from Pages',
  '/admin/styleguide/admin': 'sub-page of Styleguides',
  '/admin/styleguide/public': 'sub-page of Styleguides',
  '/admin/styleguide/help-sample': 'sub-page of Styleguides (help badge tuning)'
};

/** The route part of an href: no query, no hash. */
export function hrefPath(href: string): string {
  return href.split(/[?#]/)[0];
}

/**
 * finance.manage / finance.view never come "for free" with full admin (qa-lead, 2026-08-18): a legacy LEADER_PASSWORD
 * session was never granted them, so a link would be a dead end. Drives VISIBILITY only; admin-actor.ts owns the grant.
 */
export const NEVER_IMPLIED_BY_FULL_ADMIN: ReadonlySet<Capability> = new Set(['finance.manage', 'finance.view']);

export interface VisibilityOpts {
  fullAdmin: boolean;
  capabilities: ReadonlySet<Capability>;
  healthViewer?: boolean;
  /** plannerAccess(actor).canView */
  plannerView?: boolean;
}

/** Whether this one feature is offered to the person, ignoring landings (see visibleFeatures). */
function offered(f: Feature, o: VisibilityOpts): boolean {
  if (f.healthViewersOnly) return o.healthViewer === true;
  if (f.planner) return o.plannerView === true;
  if (f.everyone) return true;
  if (f.capability == null) return o.fullAdmin;
  if (o.capabilities.has(f.capability)) return true;
  return o.fullAdmin && !NEVER_IMPLIED_BY_FULL_ADMIN.has(f.capability);
}

/**
 * The features this person can open, in registry order. Same rules as today's nav (visibleNavSections): health and
 * planner items answer to their own lists; full admin implies every capability except finance; a landing is offered
 * while at least one feature of its kind is.
 */
export function visibleFeatures(features: readonly Feature[], o: VisibilityOpts): Feature[] {
  const shown = features.filter((f) => f.landing == null && offered(f, o));
  const kinds = new Set(shown.map((f) => f.kind));
  return features.filter((f) => (f.landing != null ? kinds.has(f.landing) : shown.includes(f)));
}

/** Every feature listed in an area's menu: its own, then those that list it in alsoIn. */
export function featuresIn(features: readonly Feature[], area: Area): Feature[] {
  return features.filter((f) => f.area === area || f.alsoIn?.includes(area));
}

export function featureByKey(key: string): Feature | undefined {
  return FEATURES.find((f) => f.key === key);
}
