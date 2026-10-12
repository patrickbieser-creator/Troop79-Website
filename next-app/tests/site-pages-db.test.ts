import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { adminClient } from './helpers/admin-client';

/**
 * Content-managed pages (Plans/Content-Managed-Pages.md) against the real local database:
 *  1. the table is service-role only (RLS on, ZERO policies — D-051 / D-239), like every mm_* table;
 *  2. the seed carries today's /join and /about copy, and /join renders from its row — no JSX fallback.
 */
vi.mock('@/lib/site-pages', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  const load = async (path: string) => {
    const { data } = await make().from('site_pages').select('*').eq('path', path).eq('status', 'published').maybeSingle();
    return data;
  };
  return { loadSitePage: load, loadSitePagePreview: load };
});
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  }
}));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => null, actorHas: () => false }));

function localSql(sql: string): string {
  const cfg = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(cfg)?.[1] ?? 'next-app';
  const container = process.env.SUPABASE_DB_CONTAINER ?? `supabase_db_${projectId}`;
  return execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', sql], {
    encoding: 'utf8'
  }).trim();
}

describe('site_pages posture', () => {
  it('SitePages_HasRlsEnabled_WithZeroPolicies', async () => {
    expect(localSql(`select relrowsecurity from pg_class where oid = 'public.site_pages'::regclass`)).toBe('t');
    expect(Number(localSql(`select count(*) from pg_policies where schemaname = 'public' and tablename = 'site_pages'`))).toBe(0);
    // The seeded rows exist, so an empty anon read proves RLS, not an empty table.
    const { count } = await adminClient().from('site_pages').select('*', { count: 'exact', head: true });
    expect(count ?? 0).toBeGreaterThanOrEqual(2);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error('anon key env missing — is .env.local present?');
    const { createClient } = await import('@supabase/supabase-js');
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await anon.from('site_pages').select('*').limit(1);
    if (error === null) expect(data ?? []).toHaveLength(0);
  });

  it('AuditLog_AcceptsThePagesArea', async () => {
    const { error } = await adminClient()
      .from('audit_log')
      .insert({ actor_label: 'vitest', area: 'pages', action: 'probe', entity_type: 'vitest-pages-probe', summary: 'vitest-pages probe' });
    expect(error).toBeNull();
    await adminClient().from('audit_log').delete().eq('entity_type', 'vitest-pages-probe');
  });

  it('SiteText_SeedHasKeyFacts_ForJoinAndAbout', async () => {
    const { data } = await adminClient().from('site_pages').select('path, status, show_in_nav, parent_id').in('path', ['/join', '/about']);
    expect((data ?? []).map((r) => r.path).sort()).toEqual(['/about', '/join']);
    for (const r of data ?? []) expect(r).toMatchObject({ status: 'published', show_in_nav: false, parent_id: null });
  });
});

describe('/join and /about render from their rows', () => {
  it('JoinPage_RendersFromRow', async () => {
    const { default: JoinPage, generateMetadata } = await import('../src/app/(public)/join/page');
    const html = renderToStaticMarkup(await JoinPage());

    // Headline, lede, and the section label from the row.
    expect(html).toContain('Step one: just show up.');
    expect(html).toContain('There’s no application to fill out before you visit');
    expect(html).toContain('Join Troop 79');
    // Four numbered steps with their titles, and the maps + calendar + mailto links kept.
    expect((html.match(/<li/g) ?? []).length).toBeGreaterThanOrEqual(4);
    for (const t of ['Visit a Sunday meeting', 'Say hello', 'Register with Scouts America', 'Jump in']) expect(html).toContain(t);
    expect(html).toContain('https://www.google.com/maps/search/?api=1&amp;query=1572+E+Capitol+Drive%2C+Milwaukee%2C+WI');
    expect(html).toContain('href="/events"');
    expect(html).toContain('href="mailto:bsatroop79bg@gmail.com"');
    // Section dividers, FAQ questions and answers.
    for (const t of ['How Joining Works', 'Who Can Join', 'Common Questions']) expect(html).toContain(t);
    expect(html).toContain('Does my scout need any experience?');
    expect(html).toContain('Any time. Advancement is self-paced');
    // CTA banner with both buttons.
    expect(html).toContain('Come say hi this Sunday.');
    expect(html).toContain('Email the Troop');
    expect(html).toContain('Check the Calendar');
    // Sidebar: the fact card and the note.
    expect(html).toContain('When &amp; Where');
    expect(html).toContain('Most Sundays');
    expect(html).toContain('New Here?');
    expect(html).toContain('href="/about"');

    const meta = await generateMetadata();
    expect(meta.description).toContain('How to join Scout Troop 79');
  });

  it('AboutPage_RendersFromRow_WithStatsAndLeadership', async () => {
    const { default: AboutPage } = await import('../src/app/(public)/about/page');
    const html = renderToStaticMarkup(await AboutPage());
    for (const t of ['A family troop, growing up together.', 'Founded', 'Adult Leaders', 'Who We Are', 'Advancement, In the Open']) {
      expect(html).toContain(t);
    }
    expect(html).toContain('Mindy Stollenwerk');
    expect(html).toContain('Thinking about joining?');
    expect(html).toContain('href="/join"');
  });

  it('SitePage_ThatIsMissing_IsNotFound', async () => {
    const { loadSitePage } = await import('@/lib/site-pages');
    expect(await loadSitePage('/definitely-not-a-page')).toBeNull();
    const { default: CatchAll } = await import('../src/app/(public)/[...slug]/page');
    await expect(CatchAll({ params: Promise.resolve({ slug: ['definitely-not-a-page'] }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
