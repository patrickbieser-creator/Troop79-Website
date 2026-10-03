import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * A topic shelf's "Got something that belongs here? / Suggest a Resource" band
 * (Patrick, 2026-10-03): it stays on ordinary shelves and is gone from a shelf
 * with a tool — Menu Monster's pages are a planner, not a list of resources.
 * Data loaders are faked; the page's own rendering is real.
 */

const topic = (slug: string) => ({ slug, title: slug === 'menu-monster' ? 'Menu Monster' : 'Knots', icon: null, blurb_md: null });

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: (_c: string, slug: string) => ({ maybeSingle: async () => ({ data: topic(slug) }) }) }) })
  })
}));
vi.mock('@/lib/library-data', () => ({ loadPublishedFor: async () => [] }));
vi.mock('@/lib/library-viewer', () => ({ viewerIsLeader: async () => false }));
vi.mock('../src/app/(public)/library/_tools/registry', () => ({
  TOPIC_TOOLS: { 'menu-monster': () => <p>Menu Monster tool</p> }
}));

import LibraryTopicPage from '../src/app/(public)/library/topic/[slug]/page';

async function renderShelf(slug: string) {
  render(await LibraryTopicPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) }));
}

describe('Topic shelf — the Suggest a Resource band', () => {
  it('MenuMonsterPages_HaveNoSuggestAResourceBand', async () => {
    await renderShelf('menu-monster');
    expect(screen.queryByRole('link', { name: 'Suggest a Resource' })).toBeNull();
  });

  it('MenuMonsterPages_HaveNoGotSomethingHeading', async () => {
    await renderShelf('menu-monster');
    expect(screen.queryByRole('heading', { name: /Got something that belongs here/ })).toBeNull();
  });

  it('OrdinaryShelves_KeepTheSuggestAResourceBand', async () => {
    await renderShelf('knots');
    expect(screen.getByRole('link', { name: 'Suggest a Resource' })).toBeTruthy();
  });
});
