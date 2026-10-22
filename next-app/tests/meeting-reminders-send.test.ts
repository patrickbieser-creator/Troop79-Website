import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Meeting Planner P5b: sending reminders (Plans/Meeting-Planner-II.md Decision 11). The database half and the mail
 * transport are the mock boundary; what's checked here is the sender's own job: the link is the plain meeting page
 * (no token: a reminder answers nothing by itself), and a reminder whose email didn't go out is deleted.
 */
const m = vi.hoisted(() => ({ create: vi.fn(), del: vi.fn(), send: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/meeting-invites-db', () => ({ createReminders: m.create, deleteInvites: m.del, createTeachInvites: vi.fn(), createPickInvites: vi.fn() }));
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

const { sendReminders } = await import('../src/lib/meeting-invites-send');

const recipient = (id: number, people: [number, string, number][]) => ({
  recipientId: id,
  name: `Parent ${id}`,
  sentTo: `p${id}@example.com`,
  isScout: false,
  people: people.map(([personId, name, inviteId]) => ({ personId, name, inviteId }))
});

beforeEach(() => {
  for (const f of [m.create, m.del, m.send, m.audit]) f.mockReset();
});

describe('sendReminders', () => {
  it('Reminder_Link_PointsToMemberMeeting_WithNoToken', async () => {
    m.create.mockResolvedValue({ ok: true, recipients: [recipient(41, [[7, 'Anjali Smith', 70]])], skipped: [] });
    m.send.mockResolvedValue({ status: 'sent', to: ['p41@example.com'] });
    await sendReminders(sb, { entryId: 5, personIds: [7], sentBy: 82 });
    const mail = m.send.mock.calls[0][0];
    expect([mail.html.includes('https://www.troop-79.com/member/meeting"'), /\/i\//.test(mail.html + mail.text), mail.fromName]).toEqual([true, false, 'Troop 79 Bugler']);
  });

  it('Reminder_IsDeleted_WhenEmailDoesNotGoOut', async () => {
    m.create.mockResolvedValue({ ok: true, recipients: [recipient(41, [[7, 'Anjali Smith', 70]]), recipient(42, [[8, 'Finn Jones', 80]])], skipped: [] });
    m.send.mockResolvedValueOnce({ status: 'sent', to: [] }).mockResolvedValueOnce({ status: 'error', to: [] });
    const res = await sendReminders(sb, { entryId: 5, personIds: [7, 8], sentBy: 82 });
    expect([m.del.mock.calls.flatMap((c) => c[1]), res.ok && res.sent, res.ok && res.skipped.map((s) => s.name)]).toEqual([[80], ['Anjali S'], ['Parent 42']]);
  });
});
