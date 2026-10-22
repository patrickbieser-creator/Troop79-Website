import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Build a Plan B3 (Plans/Build-A-Plan.md Decision 2): the digest sender's own job, with the database half, the words
 * and the mail transport mocked. Each recipient gets ONE email listing every invite for them, each with its own
 * /i/<token> link; a recipient whose email didn't go out takes their rows with them.
 */
const m = vi.hoisted(() => ({ create: vi.fn(), del: vi.fn(), send: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/meeting-invite-digest-db', () => ({ createInviteDigest: m.create }));
vi.mock('@/lib/meeting-invites-db', async (orig) => ({ ...(await orig<typeof import('../src/lib/meeting-invites-db')>()), deleteInvites: m.del }));
vi.mock('@/lib/meeting-invites-send', async (orig) => ({
  ...(await orig<typeof import('../src/lib/meeting-invites-send')>()),
  inviteWords: async (_sb: unknown, _entry: number, key: string) => ({ label: `Topic ${key}`, codeLabel: `Code ${key}`, minutes: 20, parts: [] })
}));
vi.mock('@/lib/email', () => ({ sendEmail: m.send }));
vi.mock('@/lib/audit', () => ({ recordAudit: m.audit }));
vi.mock('@/lib/site-url', () => ({ siteUrl: () => 'https://www.troop-79.com' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const chain = () => {
  const q: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'is', 'in', 'order', 'limit']) q[k] = () => q;
  q.single = async () => ({ data: { entry_date: '2092-11-02' } });
  q.maybeSingle = async () => ({ data: null });
  q.then = (res: (v: unknown) => void) => res({ data: [] });
  return q;
};
const sb = { from: () => chain() } as unknown as SupabaseClient;

const { sendInviteDigests } = await import('../src/lib/meeting-invite-digest-send');

const token = (n: number) => n.toString(16).padStart(64, '0');
const parent = {
  recipientId: 41,
  name: 'Kim Lee',
  sentTo: 'p41@example.com',
  isScout: false,
  invites: [
    { inviteId: 1, token: token(1), kind: 'teach' as const, key: 'tenderfoot-4a', inviteeId: 41, inviteeName: 'Kim L' },
    { inviteId: 2, token: token(2), kind: 'pick' as const, key: 'tenderfoot-4a', inviteeId: 7, inviteeName: 'Anjali S' },
    { inviteId: 3, token: token(3), kind: 'pick' as const, key: 'tenderfoot-4b', inviteeId: 7, inviteeName: 'Anjali S' }
  ]
};
const other = { recipientId: 42, name: 'Lee Fox', sentTo: 'p42@example.com', isScout: false, invites: [{ inviteId: 9, token: token(9), kind: 'pick' as const, key: 'tenderfoot-4a', inviteeId: 8, inviteeName: 'Finn F' }] };
const input = { entryId: 5, teach: [{ key: 'tenderfoot-4a', personIds: [41] }], pick: [{ key: 'tenderfoot-4a', scoutIds: [7, 8] }, { key: 'tenderfoot-4b', scoutIds: [7] }], sentBy: 82 };

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.del.mockResolvedValue(true);
});

describe('the digest email', () => {
  it('Invite_Digest_ListsEveryInviteWithItsOwnLink', async () => {
    m.create.mockResolvedValue({ ok: true, recipients: [parent], skipped: [] });
    m.send.mockResolvedValue({ status: 'sent', to: [] });
    await sendInviteDigests(sb, input);
    const text = (m.send.mock.calls[0][0] as { text: string }).text;
    expect(new Set(text.match(/\/i\/[0-9a-f]{64}/g))).toEqual(new Set([1, 2, 3].map((n) => `/i/${token(n)}`)));
  });

  it('Invite_DeletesRows_WhenDigestEmailFails', async () => {
    m.create.mockResolvedValue({ ok: true, recipients: [parent, other], skipped: [] });
    m.send.mockResolvedValueOnce({ status: 'sent', to: [] }).mockResolvedValueOnce({ status: 'error', to: [] });
    await sendInviteDigests(sb, input);
    expect(m.del.mock.calls.flatMap((c) => c[1] as number[])).toEqual([9]);
  });
});
