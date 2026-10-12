import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import type { Capability } from '../src/lib/capabilities';

/**
 * Content-managed pages (Plans/Content-Managed-Pages.md) — the Pages admin's server actions against the real
 * local database. Only the framework edges are mocked: the signed-in actor (cookies don't exist in Vitest),
 * the cache-expiry calls (so they can be asserted), and the server client (it imports next/headers).
 */
const admin = adminClient();
const state = vi.hoisted(() => ({ caps: new Set<string>(['news.write']) }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/admin-actor', () => ({
  resolveAdminActor: async () => ({
    kind: 'identity',
    label: 'Vitest Leader',
    personId: null,
    capabilities: state.caps as Set<Capability>,
    legacyRole: null,
    subjectKind: 'adult'
  }),
  actorHas: () => true
}));
vi.mock('next/cache', () => ({ revalidatePath: cache.revalidatePath, updateTag: cache.updateTag, unstable_cache: (fn: unknown) => fn }));

const MARK = 'vitest-pages';
const created: number[] = [];

async function actions() {
  return import('../src/app/admin/(workspace)/news/pages/actions');
}

const fields = (over: Record<string, string> = {}) => ({
  title: `${MARK} Page`,
  headline: 'A headline',
  lede: 'A lede.',
  bodyMd: '## Section\n\nBody.',
  sidebarMd: '## Side\n\nNote.',
  metaDescription: 'For search.',
  ...over
});

async function makePage(over: { title?: string; parentId?: number | null } = {}) {
  const { createPage } = await actions();
  const res = await createPage({ title: over.title ?? `${MARK} Page`, parentId: over.parentId ?? null });
  if (!res.ok || !res.id) throw new Error(`createPage failed: ${res.error}`);
  created.push(res.id);
  return res.id;
}

beforeEach(() => {
  state.caps = new Set(['news.write']);
  cache.revalidatePath.mockClear();
  cache.updateTag.mockClear();
});

afterAll(async () => {
  // Children first (parent_id is on delete restrict), then the parents.
  await admin.from('site_pages').delete().in('id', created).not('parent_id', 'is', null);
  await admin.from('site_pages').delete().in('id', created);
  await admin.from('audit_log').delete().eq('area', 'pages').like('summary', `%${MARK}%`);
});

describe('save page', () => {
  it('SavePage_RequiresPageCapability', async () => {
    const id = await makePage();
    const { savePage, createPage, publishPage, movePage } = await actions();
    state.caps = new Set(['calendar.write']);
    await expect(savePage(id, fields())).rejects.toThrow(/requires/i);
    await expect(createPage({ title: 'x', parentId: null })).rejects.toThrow(/requires/i);
    await expect(publishPage(id)).rejects.toThrow(/requires/i);
    await expect(movePage(id, 'up')).rejects.toThrow(/requires/i);
    const { data } = await admin.from('site_pages').select('headline').eq('id', id).single();
    expect(data?.headline).toBe('');
  });

  it('SavePage_WritesAuditDiff', async () => {
    const id = await makePage();
    const { savePage } = await actions();
    expect((await savePage(id, fields())).ok).toBe(true);
    // Second save changes only the lede: the diff names exactly that field, with from/to.
    expect((await savePage(id, fields({ lede: 'A new lede.' }))).ok).toBe(true);

    const { data } = await admin
      .from('audit_log')
      .select('action, entity_type, entity_id, summary, details, actor_label')
      .eq('area', 'pages')
      .eq('entity_id', String(id))
      .order('id');
    const updates = (data ?? []).filter((r) => r.action === 'update');
    expect(updates).toHaveLength(2);
    expect(updates[1].entity_type).toBe('site_page');
    expect(updates[1].details).toEqual([{ field: 'Lede', from: 'A lede.', to: 'A new lede.' }]);
    const firstFields = (updates[0].details as { field: string }[]).map((d) => d.field);
    expect(firstFields).toEqual(expect.arrayContaining(['Headline', 'Lede', 'Body', 'Sidebar', 'Meta description']));
    // An untouched field never appears.
    expect(firstFields).not.toContain('Title');
  });

  it('SavePage_RevalidatesTagAndPath', async () => {
    const id = await makePage();
    const { data: row } = await admin.from('site_pages').select('path').eq('id', id).single();
    cache.revalidatePath.mockClear();
    cache.updateTag.mockClear();
    const { savePage } = await actions();
    expect((await savePage(id, fields())).ok).toBe(true);
    expect(cache.updateTag).toHaveBeenCalledWith('site-pages');
    expect(cache.revalidatePath).toHaveBeenCalledWith(row!.path);
  });

  it('SavePage_RefusesABlankTitle_AndTouchesNothing', async () => {
    const id = await makePage();
    const { savePage } = await actions();
    const res = await savePage(id, fields({ title: '   ' }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/title/i);
    expect(cache.updateTag).not.toHaveBeenCalled();
  });
});

describe('create / publish / move', () => {
  it('CreatePage_MakesADraft_UnderItsParentsPath_WithAUniqueSlug', async () => {
    const parent = await makePage({ title: `${MARK} Parent` });
    const { data: p } = await admin.from('site_pages').select('path').eq('id', parent).single();
    const kid = await makePage({ title: `${MARK} Parent`, parentId: parent });
    const { data: k } = await admin.from('site_pages').select('path, slug, status, parent_id, show_in_nav').eq('id', kid).single();
    expect(k).toMatchObject({ status: 'draft', parent_id: parent, show_in_nav: false });
    expect(k!.path).toBe(`${p!.path}/${k!.slug}`);
    // Same title under the same parent again: the slug is bumped, not rejected.
    const twin = await makePage({ title: `${MARK} Parent`, parentId: parent });
    const { data: t } = await admin.from('site_pages').select('path').eq('id', twin).single();
    expect(t!.path).not.toBe(k!.path);
  });

  it('CreatePage_RefusesATopLevelSlug_ThatIsACodeRoute', async () => {
    const { createPage } = await actions();
    const res = await createPage({ title: 'Events', parentId: null });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/events/i);
  });

  it('PublishPage_GoesLive_AndExpiresTheCache', async () => {
    const id = await makePage();
    const { publishPage } = await actions();
    cache.updateTag.mockClear();
    expect((await publishPage(id)).ok).toBe(true);
    const { data } = await admin.from('site_pages').select('status').eq('id', id).single();
    expect(data?.status).toBe('published');
    expect(cache.updateTag).toHaveBeenCalledWith('site-pages');
    const { data: audit } = await admin.from('audit_log').select('action').eq('area', 'pages').eq('entity_id', String(id));
    expect((audit ?? []).map((a) => a.action)).toContain('publish');
  });

  it('MovePage_SwapsWithItsSibling_AndNeverLeavesTheParent', async () => {
    const parent = await makePage({ title: `${MARK} Move parent` });
    const a = await makePage({ title: `${MARK} A`, parentId: parent });
    const b = await makePage({ title: `${MARK} B`, parentId: parent });
    const { movePage } = await actions();
    const order = async () => {
      const { data } = await admin.from('site_pages').select('id, sort_order').eq('parent_id', parent).order('sort_order').order('id');
      return (data ?? []).map((r) => r.id);
    };
    expect(await order()).toEqual([a, b]);
    expect((await movePage(b, 'up')).ok).toBe(true);
    expect(await order()).toEqual([b, a]);
    // At the top already: a no-op that says so rather than an error.
    expect((await movePage(b, 'up')).ok).toBe(true);
    expect(await order()).toEqual([b, a]);
  });
});
