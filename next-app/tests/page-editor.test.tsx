import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const savePage = vi.hoisted(() => vi.fn(async () => ({ ok: true, id: 7 })));
vi.mock('../src/app/admin/(workspace)/news/pages/actions', () => ({
  savePage,
  createPage: vi.fn(async () => ({ ok: true, id: 8 })),
  publishPage: vi.fn(async () => ({ ok: true })),
  setPageStatus: vi.fn(async () => ({ ok: true })),
  movePage: vi.fn(async () => ({ ok: true }))
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/news/pages/7'
}));

import { PageEditor } from '../src/app/admin/(workspace)/news/pages/[id]/page-editor';
import type { SitePage } from '../src/lib/site-pages-tree';

const PAGE: SitePage = {
  id: 7,
  parent_id: null,
  slug: 'join',
  path: '/join',
  title: 'Join Troop 79',
  headline: 'Step one: just show up.',
  lede: 'No application needed.',
  body_md: '## How Joining Works\n\n1. **Visit** A Sunday.',
  sidebar_md: '## When & Where\n\n- **Day** Most Sundays',
  meta_description: 'How to join.',
  status: 'published',
  sort_order: 10,
  show_in_nav: false,
  created_at: '2026-10-11T00:00:00Z',
  updated_at: '2026-10-11T00:00:00Z',
  updated_by: 'seed'
};

describe('PageEditor', () => {
  it('PageEditor_SaveDisabledUntilDirty_DiscardRestoresLastSaved', async () => {
    const user = userEvent.setup();
    render(<PageEditor page={PAGE} parentLabel={null} />);

    const save = screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement;
    const discard = screen.getByRole('button', { name: 'Discard changes' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(discard.disabled).toBe(true);

    const headline = screen.getByLabelText('Headline') as HTMLInputElement;
    await user.clear(headline);
    await user.type(headline, 'Come on in.');
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Discard changes' }) as HTMLButtonElement).disabled).toBe(false);
    // The live preview follows the draft.
    expect(screen.getAllByText('Come on in.').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect((screen.getByLabelText('Headline') as HTMLInputElement).value).toBe('Step one: just show up.');
    expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
  }, 20000);

  it('PageEditor_Save_SendsTheDraft_AndStaysOnThePage', async () => {
    const user = userEvent.setup();
    render(<PageEditor page={PAGE} parentLabel={null} />);
    const lede = screen.getByLabelText('Lede') as HTMLTextAreaElement;
    await user.type(lede, ' Just come.');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(savePage).toHaveBeenCalled());
    const [id, fields] = savePage.mock.calls[0] as unknown as [number, Record<string, string>];
    expect(id).toBe(7);
    expect(fields).toMatchObject({ title: 'Join Troop 79', lede: 'No application needed. Just come.' });
    // After a save the new draft is what "saved" means, so Save goes grey again.
    await waitFor(() => expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true));
  }, 20000);
});
