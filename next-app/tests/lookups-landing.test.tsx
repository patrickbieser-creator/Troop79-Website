import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * Lookups & Admin landing (Patrick, 2026-10-28: too many cards to scroll): grouped links, and no table read until a
 * card is opened. The database client throws here, so a landing render that reads anything fails.
 */
let caps = new Set(['roster.manage']);
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => ({ capabilities: caps }) }));
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => {
    throw new Error('the landing page must not read the database');
  }
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  usePathname: () => '/admin/advancement/lookups',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));

const { default: LookupsPage } = await import('../src/app/admin/(workspace)/advancement/lookups/page');
const landing = async () => render(await LookupsPage({ searchParams: Promise.resolve({}) }));

describe('Lookups & Admin landing', () => {
  it('Landing_GroupsTheCards_UnderHeadings', async () => {
    caps = new Set(['roster.manage']);
    await landing();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Advancement catalog',
      'Fast Entry pick lists',
      'Meeting planner teaching',
      'Site content and email',
      'Families and stores'
    ]);
  });

  it('EachLink_OpensItsCardOnItsOwn', async () => {
    caps = new Set(['roster.manage']);
    await landing();
    expect(screen.getByRole('link', { name: /Requirement classes/ }).getAttribute('href')).toBe('/admin/advancement/lookups?card=requirement-classes');
  });

  it('StoresLink_ShowsOnlyForLibraryModerators', async () => {
    caps = new Set(['roster.manage']);
    const { unmount } = await landing();
    const without = screen.queryByRole('link', { name: /Menu Monster stores/ });
    unmount();
    caps = new Set(['roster.manage', 'library.moderate']);
    await landing();
    expect([without, screen.getByRole('link', { name: /Menu Monster stores/ }) != null]).toEqual([null, true]);
  });

  it('UnknownCard_IsNotFound', async () => {
    caps = new Set(['roster.manage']);
    await expect(LookupsPage({ searchParams: Promise.resolve({ card: 'nope' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
