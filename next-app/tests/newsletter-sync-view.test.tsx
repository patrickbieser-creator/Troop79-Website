import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewsletterSyncView } from '../src/app/admin/(workspace)/newsletter/newsletter-sync-view';
import type { NewsletterPreview } from '../src/app/admin/(workspace)/newsletter/actions';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/** EmailOctopus sync screen. The action is a vi.fn(); the component is under test. */
const preview: NewsletterPreview = {
  ok: true,
  listSize: 3,
  plan: {
    add: [{ email: 'new@x.org', firstName: 'Ann', lastName: 'Lee', personIds: [1] }],
    rename: [],
    markUnsubscribed: ['gone@x.org'],
    unchanged: 2,
    onListOnly: 0
  }
};

describe('NewsletterSyncView', () => {
  it('Leader_SeesHowManyChangesASyncMakes', () => {
    render(<NewsletterSyncView preview={preview} syncAction={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Sync now (2)' })).toBeTruthy();
  });

  it('Leader_SeesWhatTheSyncDid', async () => {
    const syncAction = vi.fn(async () => ({ ok: true as const, added: 1, renamed: 0, unsubscribed: 1, failures: [] }));
    render(<NewsletterSyncView preview={preview} syncAction={syncAction} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sync now (2)' }));
    expect(await screen.findByText('Added 1, updated 0 names, recorded 1 unsubscribe.')).toBeTruthy();
  });

  it('Leader_SeesInSync_WhenNothingIsDifferent', () => {
    const none: NewsletterPreview = { ok: true, listSize: 2, plan: { add: [], rename: [], markUnsubscribed: [], unchanged: 2, onListOnly: 0 } };
    render(<NewsletterSyncView preview={none} syncAction={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'In sync' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Leader_SeesWhyItCannotSync_WhenNotConnected', () => {
    render(<NewsletterSyncView preview={{ ok: false, error: 'EmailOctopus isn’t connected yet' }} syncAction={vi.fn()} />);
    expect(screen.getByText('EmailOctopus isn’t connected yet')).toBeTruthy();
  });
});
