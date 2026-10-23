import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Build a Plan B3 (Plans/Build-A-Plan.md Decision 2): the digest sender's own job, with the database half, the words
 * and the mail transport mocked. Each recipient gets ONE email listing every invite for them, each with its own
 * /i/<token> link; a recipient whose email didn't go out takes their rows with them.
 */
const m = vi.hoisted(() => ({ create: vi.fn(), del: vi.fn(), send: vi.fn(), audit: vi.fn() }));
const emails = vi.hoisted(() => new Set<number>());
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

const chain = (table: string) => {
  const q: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'is', 'in', 'order', 'limit']) q[k] = () => q;
  q.single = async () => ({ data: { entry_date: '2092-11-02' } });
  q.maybeSingle = async () => ({ data: null });
  // person_emails: who has an address on file (the P.S.); everything else reads empty.
  q.then = (res: (v: unknown) => void) => res({ data: table === 'person_emails' ? [...emails].map((person_id) => ({ person_id })) : [] });
  return q;
};
const sb = { from: (table: string) => chain(table) } as unknown as SupabaseClient;

const { sendInviteDigests } = await import('../src/lib/meeting-invite-digest-send');
const { REMINDER_BATCH, REMINDER_EMAIL_TIMEOUT_MS, REMINDER_TIME_BUDGET_MS } = await import('../src/lib/meeting-invites-send');

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
  emails.clear();
});

describe('the digest email', () => {
  it('Invite_Digest_ListsEveryInviteWithItsOwnLink', async () => {
    m.create.mockResolvedValue({ ok: true, recipients: [parent], skipped: [] });
    m.send.mockResolvedValue({ status: 'sent', to: [] });
    await sendInviteDigests(sb, input);
    const text = (m.send.mock.calls[0][0] as { text: string }).text;
    expect(new Set(text.match(/\/i\/[0-9a-f]{64}/g))).toEqual(new Set([1, 2, 3].map((n) => `/i/${token(n)}`)));
  });

  // Patrick, 2026-10-22: a parent's email names their own scout by first name; the teach ask is untouched.
  it('Invite_Digest_ScoutLine_UsesTheFirstName', async () => {
    m.create.mockResolvedValue({ ok: true, recipients: [parent], skipped: [] });
    m.send.mockResolvedValue({ status: 'sent', to: [] });
    await sendInviteDigests(sb, input);
    const text = (m.send.mock.calls[0][0] as { text: string }).text;
    expect([text.includes('Answer for Anjali'), text.includes('Anjali S')]).toEqual([true, false]);
  });

  it('Invite_Digest_ScoutWithNoEmail_GetsThePs', async () => {
    m.create.mockResolvedValue({ ok: true, recipients: [parent], skipped: [] });
    m.send.mockResolvedValue({ status: 'sent', to: [] });
    await sendInviteDigests(sb, input);
    expect((m.send.mock.calls[0][0] as { text: string }).text).toContain('P.S. If Anjali has an email address');
  });

  it('Invite_Digest_ScoutWithAnEmail_NoPs', async () => {
    emails.add(7);
    m.create.mockResolvedValue({ ok: true, recipients: [parent], skipped: [] });
    m.send.mockResolvedValue({ status: 'sent', to: [] });
    await sendInviteDigests(sb, input);
    expect((m.send.mock.calls[0][0] as { text: string }).text).not.toContain('P.S.');
  });

  it('Invite_Digest_ScoutsOwnCopy_NoPs', async () => {
    const own = { recipientId: 7, name: 'Anjali Smith', sentTo: 'a7@example.com', isScout: true, invites: [{ inviteId: 2, token: token(2), kind: 'pick' as const, key: 'tenderfoot-4a', inviteeId: 7, inviteeName: 'Anjali S' }] };
    m.create.mockResolvedValue({ ok: true, recipients: [own], skipped: [] });
    m.send.mockResolvedValue({ status: 'sent', to: [] });
    await sendInviteDigests(sb, input);
    expect((m.send.mock.calls[0][0] as { text: string }).text).not.toContain('P.S.');
  });

  it('Invite_Digest_TeachOnly_NoPs', async () => {
    m.create.mockResolvedValue({ ok: true, recipients: [{ ...parent, invites: [parent.invites[0]] }], skipped: [] });
    m.send.mockResolvedValue({ status: 'sent', to: [] });
    await sendInviteDigests(sb, input);
    expect((m.send.mock.calls[0][0] as { text: string }).text).not.toContain('P.S.');
  });

  // B10a: the teach line names the scouts it would help, as snapshotted at send time (createInviteDigest's `helped`).
  it('Digest_TeachLines_RenderCountAndNames', async () => {
    const helped = { 'tenderfoot-4a': { count: 3, names: ['Finn P', 'Anjali S', 'Leo K'], more: 0 } };
    m.create.mockResolvedValue({ ok: true, recipients: [{ ...parent, invites: [parent.invites[0]] }], skipped: [], helped });
    m.send.mockResolvedValue({ status: 'sent', to: [] });
    await sendInviteDigests(sb, input);
    expect((m.send.mock.calls[0][0] as { text: string }).text).toContain('Topic tenderfoot-4a (about 20 min): 3 scouts (Finn P, Anjali S, Leo K)');
  });

  it('Invite_DeletesRows_WhenDigestEmailFails', async () => {
    m.create.mockResolvedValue({ ok: true, recipients: [parent, other], skipped: [] });
    m.send.mockResolvedValueOnce({ status: 'sent', to: [] }).mockResolvedValueOnce({ status: 'error', to: [] });
    await sendInviteDigests(sb, input);
    expect(m.del.mock.calls.flatMap((c) => c[1] as number[])).toEqual([9]);
  });
});

describe('send safety (the reminder sender rules)', () => {
  const deleted = () => m.del.mock.calls.flatMap((c) => c[1] as number[]);
  const one = (n: number) => ({ recipientId: 100 + n, name: `R ${n}`, sentTo: `r${n}@example.com`, isScout: false, invites: [{ inviteId: 300 + n, token: token(300 + n), kind: 'pick' as const, key: 'tenderfoot-4a', inviteeId: 200 + n, inviteeName: `S ${n}` }] });

  it('Invite_Digest_EmailThatHangs15Seconds_IsDeleted', async () => {
    expect(REMINDER_EMAIL_TIMEOUT_MS).toBe(15_000);
    vi.useFakeTimers();
    try {
      m.create.mockResolvedValue({ ok: true, recipients: [other], skipped: [] });
      m.send.mockReturnValue(new Promise(() => undefined));
      const done = sendInviteDigests(sb, input);
      await vi.advanceTimersByTimeAsync(REMINDER_EMAIL_TIMEOUT_MS);
      await done;
      expect(deleted()).toEqual([9]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Invite_Digest_PastThe40SecondBudget_StartsNoNewBatch', async () => {
    expect(REMINDER_TIME_BUDGET_MS).toBe(40_000);
    const many = Array.from({ length: REMINDER_BATCH + 2 }, (_, i) => one(i));
    m.create.mockResolvedValue({ ok: true, recipients: many, skipped: [] });
    m.send.mockResolvedValue({ status: 'sent', to: [] });
    // Started at 0; the first batch starts at 0; the next would start 41 s in.
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(REMINDER_TIME_BUDGET_MS + 1_000);
    const res = await sendInviteDigests(sb, input, { clock });
    expect([m.send.mock.calls.length, deleted(), res.ok && res.skipped.filter((x) => x.reason.startsWith('out of time')).length]).toEqual([REMINDER_BATCH, [300 + REMINDER_BATCH, 301 + REMINDER_BATCH], 2]);
  });
});
