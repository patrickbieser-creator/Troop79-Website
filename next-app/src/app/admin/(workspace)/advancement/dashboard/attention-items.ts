/**
 * "Needs Attention" — leader-facing inbox of things submitted by someone else
 * that are waiting on a decision. First thing on the Dashboard (Patrick,
 * 2026-07-21): a leader shouldn't have to already know which scout has a
 * pending profile update to find it.
 *
 * Deliberately a growing LIST OF CATEGORIES, not just today's one item type —
 * this is where submitted news articles and submitted website-improvement
 * suggestions will land too, once those exist. Add a new `load*()` function
 * below and register it in loadAttentionCategories(); nothing else about the
 * panel needs to change.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/server';
import { fieldLabel, type ChangeEntityType, type ChangeRequestRow } from '@/lib/change-requests';
import { fmtDate, fmtDay } from '@/lib/format-date';
import type { Capability } from '@/lib/capabilities';
import { centralToday } from '@/lib/dates';
import { loadAdminSale } from '@/lib/wreaths/admin-data';
import { fmtMoney2 } from '@/lib/wreaths/rules';
import { countUnreviewedTeachingSkillChanges, loadTeachingSkillChanges } from '@/lib/teaching-skills';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { loadBoardState, loadNextMeeting } from '@/lib/meeting-board';
import { topicWords } from '@/lib/meeting-board-picklist';
import { loadTeachBoard } from '@/lib/meeting-board-supply';

export interface AttentionItem {
  label: string;
  meta: string;
  href: string;
}

/**
 * One inbox row on Home ("Needs you today"): a count, what it counts, and ONE
 * link to the queue that clears it. `items` is the detail behind the count —
 * the row names the first few in `meta`; the queue page lists them all.
 */
export interface AttentionCategory {
  key: string;
  label: string;
  items: AttentionItem[];
  count: number;
  /** "waiting", "to approve", "unpaid"… — the small word under the number. */
  unit: string;
  /** One line under the title: who/what, newest or oldest. */
  meta: string;
  href: string;
  /** Money rows take the forest accent. */
  tone?: 'money';
  /** Shown even at count 0 — an FYI row rather than a queue (the next open sign-up). */
  informational?: boolean;
}

/** Names of the first few items, "A, B and 2 more" — the row's meta line. */
function nameList(items: AttentionItem[], max = 3, total = items.length): string {
  const names = items.slice(0, max).map((i) => i.label);
  const rest = total - names.length;
  if (rest > 0) return `${names.join(', ')} and ${rest} more`;
  if (names.length > 1) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return names[0] ?? '';
}

/**
 * How many names a row shows. Every queue fetches only this many rows plus an
 * exact head COUNT, so the badge is right past PostgREST's 1000-row cap and a
 * busy queue costs two small queries, not a full table read.
 */
const SHOWN = 3;

function queue(
  key: string,
  label: string,
  items: AttentionItem[],
  href: string,
  unit = 'waiting',
  count = items.length
): AttentionCategory {
  return { key, label, items, count, unit, meta: nameList(items, SHOWN, count), href };
}

/**
 * Family-submitted profile updates awaiting review
 * (Plans/Scout-Self-Service-Demographics.md).
 *
 * Covers ADULT requests as well as scout ones — /profile edits the whole
 * household now, and an adult update that only ever produced an email would
 * have sat unreviewed forever. Each deep-links into the Roster tab that
 * actually holds the record.
 */
async function loadPendingProfileUpdates(): Promise<AttentionCategory> {
  const supabase = createAdminClient();
  const [{ data: requests }, { count }] = await Promise.all([
    supabase
      .from('change_requests')
      .select('id, entity_type, entity_id, submitted_at, proposed_changes')
      .in('entity_type', ['scout', 'adult'])
      .eq('status', 'pending')
      .order('submitted_at', { ascending: true })
      .limit(SHOWN),
    supabase
      .from('change_requests')
      .select('id', { count: 'exact', head: true })
      .in('entity_type', ['scout', 'adult'])
      .eq('status', 'pending')
  ]);

  const rows = (requests ?? []) as Pick<
    ChangeRequestRow,
    'id' | 'entity_type' | 'entity_id' | 'submitted_at' | 'proposed_changes'
  >[];

  const scoutIds = [...new Set(rows.filter((r) => r.entity_type === 'scout').map((r) => r.entity_id))];
  const personIds = [
    ...new Set(rows.filter((r) => r.entity_type === 'adult').map((r) => Number(r.entity_id)))
  ];

  const [{ data: scouts }, { data: people }] = await Promise.all([
    scoutIds.length > 0
      ? supabase.from('scouts').select('id, display_name, active').in('id', scoutIds)
      : Promise.resolve({ data: [] }),
    personIds.length > 0
      ? supabase.from('person_directory').select('person_id, display_name, tab').in('person_id', personIds)
      : Promise.resolve({ data: [] })
  ]);

  const scoutById = new Map(
    ((scouts ?? []) as { id: string; display_name: string; active: boolean }[]).map((s) => [s.id, s])
  );
  const personById = new Map(
    ((people ?? []) as { person_id: number; display_name: string; tab: string }[]).map((p) => [
      String(p.person_id),
      p
    ])
  );

  const items: AttentionItem[] = rows.map((r) => {
    const type = r.entity_type as ChangeEntityType;
    const fieldLabels = Object.keys(r.proposed_changes)
      .map((f) => fieldLabel(type, f))
      .join(', ');

    if (type === 'adult') {
      const person = personById.get(r.entity_id);
      // Leaders and Adults are separate roster tabs; open the one the person
      // is actually on, same idea as the scout branch below.
      const tab = person?.tab === 'leader' ? 'leader' : 'adult';
      return {
        label: person?.display_name ?? `Person ${r.entity_id}`,
        meta: `${fieldLabels} · submitted ${fmtDate(r.submitted_at, { year: false })}`,
        href: `/admin/advancement/roster?tab=${tab}&open=${encodeURIComponent(r.entity_id)}`
      };
    }

    const scout = scoutById.get(r.entity_id);
    // Deep-links via the Roster's ?open= redirect to the scout's record page
    // (Active or Inactive tab, whichever the scout is actually on, becomes
    // its Back link) — see roster/page.tsx.
    const tab = scout?.active === false ? 'inactive_scout' : 'active_scout';
    return {
      label: scout?.display_name ?? r.entity_id,
      meta: `${fieldLabels} · submitted ${fmtDate(r.submitted_at, { year: false })}`,
      href: `/admin/advancement/roster?tab=${tab}&open=${encodeURIComponent(r.entity_id)}`
    };
  });

  return queue('profile-updates', 'Profile updates awaiting review', items, '/admin/advancement/roster', 'waiting', count ?? items.length);
}

/** Resource Library submissions waiting for webmaster review
 *  (Plans/Resource-Library.md — everything queues, including leaders'). */
async function loadPendingLibrarySubmissions(): Promise<AttentionCategory> {
  const supabase = createAdminClient();
  const [{ data }, { count }] = await Promise.all([
    supabase
      .from('library_resources')
      .select('id, title, submitted_by_label, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(SHOWN),
    supabase.from('library_resources').select('id', { count: 'exact', head: true }).eq('status', 'pending')
  ]);

  const items: AttentionItem[] = (
    (data ?? []) as { id: number; title: string; submitted_by_label: string | null; created_at: string }[]
  ).map((r) => ({
    label: r.title,
    meta: `${r.submitted_by_label ? `from ${r.submitted_by_label} · ` : ''}submitted ${fmtDate(r.created_at, { year: false })}`,
    href: '/admin/library?tab=queue'
  }));

  return queue('library-submissions', 'Library submissions awaiting review', items, '/admin/library?tab=queue', 'waiting', count ?? items.length);
}

/** Proof-of-completion submissions awaiting review
 *  (Plans/Resource-Library.md Phase 2). */
async function loadPendingProofSubmissions(): Promise<AttentionCategory> {
  const supabase = createAdminClient();
  const [{ data }, { count }] = await Promise.all([
    supabase
      .from('requirement_submissions')
      .select('id, scout_id, target_key, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(SHOWN),
    supabase.from('requirement_submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending')
  ]);

  const rows = (data ?? []) as { id: number; scout_id: string; target_key: string; created_at: string }[];
  const scoutIds = [...new Set(rows.map((r) => r.scout_id))];
  const { data: scouts } =
    scoutIds.length > 0
      ? await supabase.from('scouts').select('id, display_name').in('id', scoutIds)
      : { data: [] as { id: string; display_name: string }[] };
  const scoutById = new Map(((scouts ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s]));

  const items: AttentionItem[] = rows.map((r) => ({
    label: scoutById.get(r.scout_id)?.display_name ?? r.scout_id,
    meta: `${r.target_key} · submitted ${fmtDate(r.created_at, { year: false })}`,
    href: '/admin/library?tab=proof'
  }));

  return queue('proof-submissions', 'Proof submissions awaiting review', items, '/admin/library?tab=proof', 'waiting', count ?? items.length);
}

/**
 * People a FAMILY put on the roster from /profile.
 *
 * Its own category rather than a row in the profile-updates list: those are
 * proposals waiting on a decision, whereas this already happened and only
 * needs a leader's eyes. Lumping them together would have made "awaiting
 * review" mean two different things in one list. Without this the only trace
 * of a new adult is an email — Patrick, 2026-08-14: "otherwise these are
 * going in undetected".
 */
async function loadNewHouseholdMembers(): Promise<AttentionCategory> {
  const supabase = createAdminClient();
  const [{ data }, { count }] = await Promise.all([
    supabase
      .from('change_requests')
      .select('id, entity_id, submitted_at, proposed_changes, submitted_by_person_id')
      .eq('entity_type', 'adult_added')
      .eq('status', 'pending')
      .order('submitted_at', { ascending: true })
      .limit(SHOWN),
    supabase
      .from('change_requests')
      .select('id', { count: 'exact', head: true })
      .eq('entity_type', 'adult_added')
      .eq('status', 'pending')
  ]);

  const rows = (data ?? []) as Pick<
    ChangeRequestRow,
    'id' | 'entity_id' | 'submitted_at' | 'proposed_changes' | 'submitted_by_person_id'
  >[];
  if (rows.length === 0) return queue('new-members', 'New household members', [], '/admin/advancement/roster', 'new');

  // One lookup for both the added person (which roster tab holds them) and
  // whoever added them (shown so a leader knows who to ask).
  const ids = [
    ...new Set([
      ...rows.map((r) => Number(r.entity_id)),
      ...rows.map((r) => r.submitted_by_person_id).filter((v): v is number => v != null)
    ])
  ];
  const { data: people } = await supabase
    .from('person_directory')
    .select('person_id, display_name, tab')
    .in('person_id', ids);
  const byId = new Map(
    ((people ?? []) as { person_id: number; display_name: string; tab: string }[]).map((p) => [
      p.person_id,
      p
    ])
  );

  const items: AttentionItem[] = rows.map((r) => {
    const added = byId.get(Number(r.entity_id));
    const by = r.submitted_by_person_id != null ? byId.get(r.submitted_by_person_id) : undefined;
    const relationship = r.proposed_changes.relationship;
    const tab = added?.tab === 'leader' ? 'leader' : 'adult';
    return {
      label: added?.display_name ?? String(r.proposed_changes.name ?? `Person ${r.entity_id}`),
      meta: [
        relationship ? String(relationship) : null,
        by ? `added by ${by.display_name}` : 'added from the Profile page',
        fmtDate(r.submitted_at, { year: false })
      ]
        .filter(Boolean)
        .join(' · '),
      href: `/admin/advancement/roster?tab=${tab}&open=${encodeURIComponent(r.entity_id)}`
    };
  });

  return queue('new-members', 'New household members', items, '/admin/advancement/roster', 'new', count ?? items.length);
}

/**
 * Reimbursements a treasurer has to decide on (status 'submitted'). finance.manage
 * only: the queue page and every action are finance.manage, so offering this row
 * to finance.view would hand a read-only viewer a link that throws.
 */
async function loadReimbursementsToApprove(sb: SupabaseClient): Promise<AttentionCategory> {
  const [{ data }, { data: amounts }, { count }] = await Promise.all([
    sb
      .from('reimbursement_requests')
      .select('id, requester_person_id, amount, description, created_at')
      .eq('status', 'submitted')
      .order('created_at', { ascending: true })
      .limit(SHOWN),
    // One narrow column, so the "$ total" covers the whole queue and not just the names shown.
    sb.from('reimbursement_requests').select('amount').eq('status', 'submitted').limit(5000),
    sb.from('reimbursement_requests').select('id', { count: 'exact', head: true }).eq('status', 'submitted')
  ]);
  const rows = (data ?? []) as {
    id: number;
    requester_person_id: number;
    amount: number | string;
    description: string;
    created_at: string;
  }[];

  const ids = [...new Set(rows.map((r) => r.requester_person_id))];
  const { data: people } =
    ids.length > 0
      ? await sb.from('people').select('id, display_name').in('id', ids)
      : { data: [] as { id: number; display_name: string }[] };
  const nameById = new Map(((people ?? []) as { id: number; display_name: string }[]).map((p) => [p.id, p.display_name]));

  const items: AttentionItem[] = rows.map((r) => ({
    label: nameById.get(r.requester_person_id) ?? `Person ${r.requester_person_id}`,
    meta: `${fmtMoney2(Number(r.amount))} · ${r.description}`,
    href: '/admin/finance/reimbursements'
  }));
  const total = ((amounts ?? []) as { amount: number | string }[]).reduce((n, r) => n + Number(r.amount), 0);
  const all = count ?? items.length;
  return {
    key: 'reimbursements',
    label: 'Reimbursements to approve',
    items,
    count: all,
    unit: 'to approve',
    meta:
      all === 0
        ? ''
        : `${fmtMoney2(total)} total · oldest ${fmtDate(rows[0].created_at, { year: false })} (${items[0].label})`,
    href: '/admin/finance/reimbursements',
    tone: 'money'
  };
}

/**
 * Wreath orders still unpaid — only while the current sale is OPEN. A draft sale
 * has no orders worth chasing and a closed one is the books' job (Release C), so
 * outside the season the row stays out of the way.
 */
async function loadUnpaidWreathOrders(sb: SupabaseClient): Promise<AttentionCategory> {
  const href = '/admin/finance/wreaths?pay=unpaid';
  const empty: AttentionCategory = {
    key: 'wreath-orders',
    label: 'Wreath orders not paid yet',
    items: [],
    count: 0,
    unit: 'unpaid',
    meta: '',
    href,
    tone: 'money'
  };
  const sale = await loadAdminSale(sb);
  if (!sale || sale.status !== 'open') return empty;
  const [{ data }, { count }] = await Promise.all([
    sb
      .from('wreath_orders')
      .select('id, order_number, customer_name, placed_at')
      .eq('sale_id', sale.id)
      .eq('status', 'placed')
      .eq('payment_status', 'unpaid')
      .order('placed_at', { ascending: true })
      .limit(SHOWN),
    sb
      .from('wreath_orders')
      .select('id', { count: 'exact', head: true })
      .eq('sale_id', sale.id)
      .eq('status', 'placed')
      .eq('payment_status', 'unpaid')
  ]);
  const rows = (data ?? []) as { id: number; order_number: string; customer_name: string; placed_at: string }[];
  const items: AttentionItem[] = rows.map((r) => ({
    label: r.customer_name,
    meta: `${r.order_number} · placed ${fmtDate(r.placed_at, { year: false })}`,
    href
  }));
  return {
    ...empty,
    items,
    count: count ?? items.length,
    meta:
      items.length === 0
        ? ''
        : `Check Venmo and PayPal for the order number · oldest ${fmtDate(rows[0].placed_at, { year: false })}`
  };
}

/**
 * News submitted from the public side, waiting for an editor. Only ARTICLES have
 * a pending state (articles.status 'pending'); site_pages is draft | published,
 * so a page edit never waits for review and there is nothing to count there.
 */
async function loadPendingNews(sb: SupabaseClient): Promise<AttentionCategory> {
  const [{ data }, { count }] = await Promise.all([
    sb
      .from('articles')
      .select('id, title, author_name, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(SHOWN),
    sb.from('articles').select('id', { count: 'exact', head: true }).eq('status', 'pending')
  ]);
  const items: AttentionItem[] = (
    (data ?? []) as { id: number; title: string; author_name: string; created_at: string }[]
  ).map((a) => ({
    label: a.title,
    meta: `from ${a.author_name} · submitted ${fmtDate(a.created_at, { year: false })}`,
    href: `/admin/news/articles/${a.id}`
  }));
  return queue('news-pending', 'News waiting to publish', items, '/admin/news/articles?status=pending', 'pending', count ?? items.length);
}

/**
 * The next upcoming event whose sign-up is still taking replies — one FYI row,
 * not a queue. "Open" = sign-up status open AND its deadline has not passed AND
 * the calendar entry is published and not in the past.
 */
async function loadNextOpenSignup(sb: SupabaseClient): Promise<AttentionCategory | null> {
  const { data } = await sb
    .from('event_signups')
    .select('id, deadline, calendar_entries!inner(id, title, entry_date, end_date, status)')
    .eq('status', 'open')
    .gt('deadline', new Date().toISOString())
    .eq('calendar_entries.status', 'published')
    .gte('calendar_entries.entry_date', centralToday());

  type Entry = { id: number; title: string; entry_date: string; end_date: string | null };
  const rows = ((data ?? []) as unknown as { id: number; deadline: string; calendar_entries: Entry | Entry[] }[])
    .map((r) => ({
      id: r.id,
      deadline: r.deadline,
      entry: Array.isArray(r.calendar_entries) ? r.calendar_entries[0] : r.calendar_entries
    }))
    .filter((r) => r.entry)
    .sort((a, b) => a.entry.entry_date.localeCompare(b.entry.entry_date) || a.entry.id - b.entry.id);
  const next = rows[0];
  if (!next) return null;

  const { count } = await sb
    .from('signup_entries')
    .select('id', { count: 'exact', head: true })
    .eq('event_signup_id', next.id)
    .eq('status', 'yes');
  const href = `/admin/calendar/${next.entry.id}`;
  const when =
    next.entry.end_date && next.entry.end_date !== next.entry.entry_date
      ? `${fmtDay(next.entry.entry_date, { year: false })} to ${fmtDay(next.entry.end_date, { year: false })}`
      : fmtDay(next.entry.entry_date, { year: false });
  return {
    key: 'next-signup',
    label: `${next.entry.title}: sign-up is open`,
    items: [{ label: next.entry.title, meta: when, href }],
    count: count ?? 0,
    unit: 'going',
    meta: `${when} · sign-up closes ${fmtDay(next.deadline, { year: false })}`,
    href,
    informational: true
  };
}

/**
 * Teaching skills people set for themselves on the member page (Plans/Meeting-Requests-And-Teaching-Offers.md,
 * Phase 0b, Decision 12): they count right away, so this is a look-at list, not an approval queue. Undo or Mark
 * reviewed on Lookups clears a row. No email is sent.
 */
async function loadTeachingSkillChangesToReview(sb: SupabaseClient): Promise<AttentionCategory> {
  const [rows, count] = await Promise.all([
    loadTeachingSkillChanges(sb, { filter: 'review', limit: SHOWN }),
    countUnreviewedTeachingSkillChanges(sb)
  ]);
  const href = '/admin/advancement/lookups#teaching-changes';
  const items: AttentionItem[] = rows.map((r) => ({
    label: `${r.personName} ${r.action} ${r.skillName}`,
    meta: fmtDate(r.changedAt, { year: false }),
    href
  }));
  return queue(
    'teaching-skill-changes',
    `${count} teaching-skill ${count === 1 ? 'change' : 'changes'} to look at`,
    items,
    href,
    count === 1 ? 'change' : 'changes',
    count
  );
}

/**
 * The next meeting's recruiting list (Plans/Meeting-Requests-And-Teaching-Offers.md, Phase 2; Prototype feedback,
 * Brad's question 4): topics scouts asked for that nobody is teaching yet, beside the teaching-skill-changes row.
 * Links to Meeting Plan › This Sunday. A closed meeting counts 0.
 * `today` is for tests (the next meeting on or after it).
 */
export async function loadSundayNoTeacher(sb: SupabaseClient, today?: string): Promise<AttentionCategory> {
  const href = '/admin/advancement/meeting-plan';
  const meeting = await loadNextMeeting(sb, today);
  const day = meeting ? fmtDay(meeting.date, { year: false }).split(',')[0] : 'Sunday';
  const empty = queue('sunday-no-teacher', `${day}: no requests waiting for a teacher`, [], href, 'no teacher', 0);
  if (!meeting || meeting.closed) return empty;
  const catalog = await loadAdvancementCatalog();
  const board = await loadBoardState(sb, meeting, catalog);
  const teach = await loadTeachBoard(sb, meeting, catalog, board);
  const wanted = [...teach.match.wanted].sort((a, b) => (teach.demand.get(b)?.length ?? 0) - (teach.demand.get(a)?.length ?? 0));
  const n = wanted.length;
  const items: AttentionItem[] = wanted.slice(0, SHOWN).map((key) => {
    const w = topicWords(key, catalog.ranks, catalog.rankRequirements, catalog.meritBadges, teach.freeformTitles, { mbReqs: catalog.meritBadgeRequirements, members: teach.members });
    const asked = teach.demand.get(key)?.length ?? 0;
    return { label: w?.label ?? key, meta: `${asked} ${asked === 1 ? 'scout' : 'scouts'}`, href };
  });
  return queue('sunday-no-teacher', `${day}: ${n} ${n === 1 ? 'request' : 'requests'} with no teacher`, items, href, 'no teacher', n);
}

/**
 * Home's "Needs you today" rows for this actor. Each category is gated by the
 * capability that opens the queue it links to — the same one the target page
 * and its actions enforce (this list is for the reader, not the boundary).
 *
 *  - profile updates / new members .... advancement.write (the dashboard's old gate)
 *  - library + proof submissions ...... advancement.write or library.moderate
 *  - reimbursements to approve ........ finance.manage (finance.view cannot open the queue)
 *  - unpaid wreath orders ............. finance.manage, only while the sale is open
 *  - pending news ..................... news.write
 *  - next open sign-up ................ calendar.write
 *  - teaching-skill changes ........... roster.manage (Lookups, where Undo and Mark reviewed live)
 *  - Sunday's requests with no teacher  meeting_plan.use (Meeting Plan › This Sunday), right after the skill changes
 */
export async function loadAttentionCategories(
  capabilities: ReadonlySet<Capability>,
  sb: SupabaseClient = createAdminClient()
): Promise<AttentionCategory[]> {
  const has = (c: Capability) => capabilities.has(c);
  const advancement = has('advancement.write');
  const jobs: Promise<AttentionCategory | null>[] = [];
  if (advancement) jobs.push(loadPendingProfileUpdates(), loadNewHouseholdMembers());
  if (advancement || has('library.moderate')) {
    jobs.push(loadPendingLibrarySubmissions(), loadPendingProofSubmissions());
  }
  if (has('finance.manage')) jobs.push(loadReimbursementsToApprove(sb), loadUnpaidWreathOrders(sb));
  if (has('news.write')) jobs.push(loadPendingNews(sb));
  if (has('calendar.write')) jobs.push(loadNextOpenSignup(sb));
  if (has('roster.manage')) jobs.push(loadTeachingSkillChangesToReview(sb));
  if (has('meeting_plan.use')) jobs.push(loadSundayNoTeacher(sb));

  const categories = (await Promise.all(jobs)).filter((c): c is AttentionCategory => c !== null);
  // A queue with nothing in it is noise, not signal — drop it rather than
  // showing a "0 waiting" row. Informational rows (the next sign-up) stay.
  return categories.filter((c) => c.count > 0 || c.informational);
}
