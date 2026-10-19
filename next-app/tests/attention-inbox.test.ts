import { describe, it, expect, vi, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { makeWreathFixture, NOW_R1, type WreathFixture } from './helpers/wreath-fixture';
import { placeOrder } from '../src/lib/wreaths/place-order';
import { centralToday } from '../src/lib/dates';
import type { Capability } from '../src/lib/capabilities';

/**
 * The Home "Needs you today" inbox (Plans/Admin-Home-And-Nav.md, Wave 1): the new capability-gated categories.
 * The local DB is a production mirror, so every count is asserted as a DELTA around a test-owned fixture row.
 */
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});

const admin = adminClient();
const caps = (...c: Capability[]) => new Set<Capability>(c);

async function load(c: Set<Capability>) {
  const { loadAttentionCategories } = await import('../src/app/admin/(workspace)/advancement/dashboard/attention-items');
  return loadAttentionCategories(c, admin);
}
const find = <T extends { key: string }>(cats: T[], key: string) => cats.find((c) => c.key === key);

describe('AttentionInbox reimbursements', () => {
  const ids: number[] = [];
  afterEach(async () => {
    if (ids.length) await admin.from('reimbursement_requests').delete().in('id', ids);
    ids.length = 0;
  });

  async function submit(status: 'submitted' | 'approved') {
    const { data: person } = await admin.from('people').select('id').order('id').limit(1).single();
    const { data, error } = await admin
      .from('reimbursement_requests')
      .insert({ requester_person_id: person!.id, amount: 12.5, description: '[TEST] inbox probe', receipt_path: 'vitest/none.jpg', status })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: ${error?.message}`);
    ids.push(data.id as number);
  }

  it('AttentionInbox_CountsReimbursementsToApprove_ForFinanceOnly', async () => {
    const before = find(await load(caps('finance.manage')), 'reimbursements')?.count ?? 0;
    await submit('submitted');
    await submit('approved'); // approved is not "awaiting approval"
    const after = await load(caps('finance.manage'));
    expect(find(after, 'reimbursements')?.count).toBe(before + 1);
    expect(find(after, 'reimbursements')?.href).toBe('/admin/finance/reimbursements');

    // finance.view cannot open the queue (page is finance.manage), so it never sees the row.
    expect(find(await load(caps('finance.view', 'news.write', 'calendar.write', 'advancement.write')), 'reimbursements')).toBeUndefined();
  });
});

describe('AttentionInbox wreath orders', () => {
  let fx: WreathFixture | null = null;
  afterEach(async () => {
    await fx?.cleanup();
    fx = null;
  });

  async function unpaidOrder() {
    const f = fx!;
    const res = await placeOrder(
      {
        idempotencyKey: `vitest-inbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sellerSlug: null,
        lines: [{ itemId: f.item.w20, quantity: 1, donated: false }],
        gift: 0,
        coverFee: false,
        fulfillment: 'pickup',
        customer: { name: 'Vitest Inbox', email: `inbox-${Math.random().toString(36).slice(2, 6)}@example.test`, phone: '414-555-0100', street: '', city: '', zip: '' },
        outsideAreaRelative: false,
        startedAt: NOW_R1 - 120_000,
        mountedAt: NOW_R1 - 60_000,
        website: ''
      },
      {
        supabase: admin,
        now: () => NOW_R1,
        ip: `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`,
        send: async () => ({ status: 'sent', to: [] as string[] }),
        householdEmails: async () => [],
        siteUrl: 'https://wreaths.test',
        replyTo: 'troop@example.test',
        saleId: f.saleId
      }
    );
    if (!res.ok) throw new Error(`order: ${res.error}`);
  }

  it('AttentionInbox_ShowsWreathOrders_OnlyWhileASaleIsOpen', async () => {
    fx = await makeWreathFixture('open');
    await unpaidOrder();
    await unpaidOrder();

    const open = find(await load(caps('finance.manage')), 'wreath-orders');
    expect(open?.count).toBe(2);
    expect(open?.href).toBe('/admin/finance/wreaths?pay=unpaid');
    // Finance only.
    expect(find(await load(caps('news.write', 'calendar.write')), 'wreath-orders')).toBeUndefined();

    await admin.from('wreath_sales').update({ status: 'closed' }).eq('id', fx.saleId);
    expect(find(await load(caps('finance.manage')), 'wreath-orders')).toBeUndefined();
  });

  it('AttentionInbox_OmitsWreathOrders_WhenNothingIsUnpaid', async () => {
    fx = await makeWreathFixture('open');
    expect(find(await load(caps('finance.manage')), 'wreath-orders')).toBeUndefined();
  });
});

describe('AttentionInbox pending news', () => {
  const ids: number[] = [];
  afterEach(async () => {
    if (ids.length) await admin.from('articles').delete().in('id', ids);
    ids.length = 0;
  });

  it('AttentionInbox_CountsSubmittedArticles_ForNewsWritersOnly', async () => {
    const before = find(await load(caps('news.write')), 'news-pending')?.count ?? 0;
    const { data, error } = await admin
      .from('articles')
      .insert({ slug: `test-inbox-${Date.now()}`, title: '[TEST] Inbox Probe', type: 'news', body: 'x', status: 'pending', featured: false, author_name: '[TEST]', author_role: 'scout' })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: ${error?.message}`);
    ids.push(data.id as number);

    const after = find(await load(caps('news.write')), 'news-pending');
    expect(after?.count).toBe(before + 1);
    expect(after?.href).toBe('/admin/news/articles?status=pending');
    expect(find(await load(caps('finance.manage', 'calendar.write')), 'news-pending')).toBeUndefined();
  });
});

describe('AttentionInbox next open sign-up', () => {
  const entryIds: number[] = [];
  afterEach(async () => {
    // event_signups cascades from the calendar entry.
    if (entryIds.length) await admin.from('calendar_entries').delete().in('id', entryIds);
    entryIds.length = 0;
  });

  async function entryWithSignup(over: { status?: 'open' | 'closed'; deadlineMs?: number; entryStatus?: 'draft' | 'published' } = {}) {
    const { data, error } = await admin
      .from('calendar_entries')
      .insert({ entry_date: centralToday(), title: '[TEST] Inbox Campout', category: 'Troop Meeting', status: over.entryStatus ?? 'published' })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture entry: ${error?.message}`);
    entryIds.push(data.id as number);
    const { error: se } = await admin.from('event_signups').insert({
      calendar_entry_id: data.id,
      status: over.status ?? 'open',
      deadline: new Date(Date.now() + (over.deadlineMs ?? 86_400_000)).toISOString()
    });
    if (se) throw new Error(`fixture signup: ${se.message}`);
    return data.id as number;
  }

  it('AttentionInbox_ShowsTheNextOpenSignup_ForCalendarWritersOnly', async () => {
    const id = await entryWithSignup();
    const row = find(await load(caps('calendar.write')), 'next-signup');
    expect(row?.items[0]?.label).toBe('[TEST] Inbox Campout');
    expect(row?.items[0]?.href).toBe(`/admin/calendar/${id}`);
    expect(find(await load(caps('finance.manage', 'news.write')), 'next-signup')).toBeUndefined();
  });

  it('AttentionInbox_SkipsSignups_ThatAreClosedPastDeadlineOrDraft', async () => {
    await entryWithSignup({ status: 'closed' });
    await entryWithSignup({ deadlineMs: -86_400_000 });
    await entryWithSignup({ entryStatus: 'draft' });
    const row = find(await load(caps('calendar.write')), 'next-signup');
    expect(row?.items[0]?.label ?? '').not.toBe('[TEST] Inbox Campout');
  });
});

describe('AttentionInbox capability scoping', () => {
  const requestIds: number[] = [];
  const reimbIds: number[] = [];
  afterEach(async () => {
    if (requestIds.length) await admin.from('change_requests').delete().in('id', requestIds);
    if (reimbIds.length) await admin.from('reimbursement_requests').delete().in('id', reimbIds);
    requestIds.length = 0;
    reimbIds.length = 0;
  });

  const keys = async (...c: Capability[]) => (await load(caps(...c))).map((r) => r.key);

  it('AttentionInbox_ReturnsNothing_ForAnActorWithNoCapabilities', async () => {
    expect(await load(caps())).toEqual([]);
  });

  it('AttentionInbox_ReturnsNothing_ForFinanceViewOnly', async () => {
    expect(await load(caps('finance.view'))).toEqual([]);
  });

  it('AttentionInbox_OffersOnlyLibraryAndProofRows_ToLibraryModerateOnly', async () => {
    const got = await keys('library.moderate');
    expect(got.every((k) => ['library-submissions', 'proof-submissions'].includes(k))).toBe(true);
  });

  it('AttentionInbox_ShowsProfileUpdatesAndNewMembers_ForAdvancementWrite', async () => {
    const { data, error } = await admin
      .from('change_requests')
      .insert([
        { entity_type: 'scout', entity_id: `vitest-inbox-${Date.now()}`, proposed_changes: {} },
        { entity_type: 'adult_added', entity_id: '2147480000', proposed_changes: { name: '[TEST] Added Adult' } }
      ])
      .select('id');
    if (error || !data) throw new Error(`fixture: ${error?.message}`);
    requestIds.push(...data.map((d) => d.id as number));

    const got = await load(caps('advancement.write'));
    expect(got.map((r) => r.key)).toEqual(expect.arrayContaining(['profile-updates', 'new-members']));
    // …and none of the other capabilities' rows.
    expect(got.some((r) => ['reimbursements', 'wreath-orders', 'news-pending', 'next-signup'].includes(r.key))).toBe(false);
    // Without advancement.write they are absent.
    expect(await keys('news.write')).not.toContain('profile-updates');
  });

  it('AttentionInbox_CountsTheWholeQueue_ButFetchesOnlyTheNamesItShows', async () => {
    const before = find(await load(caps('finance.manage')), 'reimbursements')?.count ?? 0;
    const { data: person } = await admin.from('people').select('id').order('id').limit(1).single();
    const { data, error } = await admin
      .from('reimbursement_requests')
      .insert(Array.from({ length: 5 }, () => ({ requester_person_id: person!.id, amount: 1, description: '[TEST] cap probe', receipt_path: 'vitest/none.jpg', status: 'submitted' })))
      .select('id');
    if (error || !data) throw new Error(`fixture: ${error?.message}`);
    reimbIds.push(...data.map((d) => d.id as number));

    const row = find(await load(caps('finance.manage')), 'reimbursements')!;
    expect(row.count).toBe(before + 5);
    expect(row.items.length).toBeLessThanOrEqual(3);
  });
});

describe('AttentionInbox teaching-skill changes', () => {
  // Phase 0b (Decision 12): self-service skill changes raise a count; no email. roster.manage opens Lookups.
  let personId: number | null = null;
  afterEach(async () => {
    if (personId != null) {
      await admin.from('teaching_skill_changes').delete().eq('person_id', personId);
      await admin.from('teaching_skills').delete().eq('person_id', personId);
      await admin.from('people').delete().eq('id', personId);
    }
    personId = null;
  });

  it('Leader_SeesAdminHomeAlert_WhenSkillChangeUnreviewed', async () => {
    const before = find(await load(caps('roster.manage')), 'teaching-skill-changes')?.count ?? 0;
    const { data } = await admin.from('people').insert({ display_name: 'ZZVITEST Inbox Teacher' }).select('id').single();
    personId = data!.id as number;
    const { saveTeachingSkills } = await import('../src/lib/teaching-skills');
    await saveTeachingSkills(admin, personId!, ['knots'], 'member', { personId, label: 'ZZVITEST Inbox Teacher' });
    const row = find(await load(caps('roster.manage')), 'teaching-skill-changes');
    expect([row?.count, row?.href]).toEqual([before + 1, '/admin/advancement/lookups#teaching-changes']);
    expect(find(await load(caps('finance.manage', 'news.write')), 'teaching-skill-changes')).toBeUndefined();
  });
});
