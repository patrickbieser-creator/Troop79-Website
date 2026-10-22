import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Meeting Planner P5b: sending reminders (Plans/Meeting-Planner-II.md Decision 11). The database half and the mail
 * transport are the mock boundary; what's checked here is the sender's own job: the link is the plain meeting page
 * (no token: a reminder answers nothing by itself), a reminder whose email didn't go out is deleted (even when the
 * transport throws, or the send runs out of time), and emails go out in small concurrent batches.
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

const { sendReminders, REMINDER_BATCH, REMINDER_EMAIL_TIMEOUT_MS } = await import('../src/lib/meeting-invites-send');

const recipient = (id: number, people: [number, string, number][]) => ({
  recipientId: id,
  name: `Parent ${id}`,
  sentTo: `p${id}@example.com`,
  isScout: false,
  people: people.map(([personId, name, inviteId]) => ({ personId, name, inviteId }))
});
const deleted = () => m.del.mock.calls.flatMap((c) => c[1] as number[]);

beforeEach(() => {
  for (const f of [m.create, m.del, m.send, m.audit]) f.mockReset();
  m.del.mockResolvedValue(true);
});

describe('the reminder email', () => {
  const sendOne = async (people: [number, string, number][] = [[7, 'Anjali Smith', 70]]) => {
    m.create.mockResolvedValue({ ok: true, recipients: [recipient(41, people)], skipped: [] });
    m.send.mockResolvedValue({ status: 'sent', to: ['p41@example.com'] });
    await sendReminders(sb, { entryId: 5, personIds: people.map((p) => p[0]), sentBy: 82 });
    return m.send.mock.calls[0][0] as { html: string; text: string; fromName: string };
  };

  it('Reminder_Link_PointsToMemberMeeting', async () => {
    expect((await sendOne()).html).toContain('https://www.troop-79.com/member/meeting"');
  });

  it('Reminder_Link_CarriesNoToken', async () => {
    const mail = await sendOne();
    expect(mail.html + mail.text).not.toMatch(/\/i\//);
  });

  it('Reminder_ComesFromTheBugler', async () => {
    expect((await sendOne()).fromName).toBe('Troop 79 Bugler');
  });

  it('Reminder_SaysYou_WhenTheRecipientIsAmongThePeople', async () => {
    expect((await sendOne([[7, 'Anjali Smith', 70], [41, 'Kim Lee', 71]])).text).toContain('an answer for you and Anjali S');
  });
});

describe('an email that does not go out', () => {
  const twoRecipients = () => m.create.mockResolvedValue({ ok: true, recipients: [recipient(41, [[7, 'Anjali Smith', 70]]), recipient(42, [[8, 'Finn Jones', 80]])], skipped: [] });

  it('Reminder_IsDeleted_WhenEmailDoesNotGoOut', async () => {
    twoRecipients();
    m.send.mockResolvedValueOnce({ status: 'sent', to: [] }).mockResolvedValueOnce({ status: 'error', to: [] });
    await sendReminders(sb, { entryId: 5, personIds: [7, 8], sentBy: 82 });
    expect(deleted()).toEqual([80]);
  });

  it('Reminder_Sent_NamesOnlyThePeopleReached', async () => {
    twoRecipients();
    m.send.mockResolvedValueOnce({ status: 'sent', to: [] }).mockResolvedValueOnce({ status: 'error', to: [] });
    const res = await sendReminders(sb, { entryId: 5, personIds: [7, 8], sentBy: 82 });
    expect(res.ok && res.sent).toEqual(['Anjali S']);
  });

  it('Reminder_Skipped_NamesTheRecipientNotReached', async () => {
    twoRecipients();
    m.send.mockResolvedValueOnce({ status: 'sent', to: [] }).mockResolvedValueOnce({ status: 'error', to: [] });
    const res = await sendReminders(sb, { entryId: 5, personIds: [7, 8], sentBy: 82 });
    expect(res.ok && res.skipped.map((s) => s.name)).toEqual(['Parent 42']);
  });

  it('Reminder_IsDeleted_WhenSendEmailThrows', async () => {
    twoRecipients();
    m.send.mockResolvedValueOnce({ status: 'sent', to: [] }).mockRejectedValueOnce(new Error('socket hang up'));
    await sendReminders(sb, { entryId: 5, personIds: [7, 8], sentBy: 82 });
    expect(deleted()).toEqual([80]);
  });

  it('Reminder_KeepsSending_AfterOneEmailThrows', async () => {
    m.create.mockResolvedValue({ ok: true, recipients: [recipient(41, [[7, 'Anjali Smith', 70]]), recipient(42, [[8, 'Finn Jones', 80]])], skipped: [] });
    m.send.mockRejectedValueOnce(new Error('socket hang up')).mockResolvedValueOnce({ status: 'sent', to: [] });
    const res = await sendReminders(sb, { entryId: 5, personIds: [7, 8], sentBy: 82 });
    expect(res.ok && res.sent).toEqual(['Finn J']);
  });

  it('Reminder_DeletesTheRest_WhenTheSendRunsOutOfTime', async () => {
    const many = Array.from({ length: REMINDER_BATCH + 2 }, (_, i) => recipient(100 + i, [[200 + i, `Scout ${i}`, 300 + i]]));
    m.create.mockResolvedValue({ ok: true, recipients: many, skipped: [] });
    m.send.mockResolvedValue({ status: 'sent', to: [] });
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(10 * 60_000);
    await sendReminders(sb, { entryId: 5, personIds: many.map((r) => r.people[0].personId), sentBy: 82 }, { clock });
    expect(deleted()).toEqual([300 + REMINDER_BATCH, 301 + REMINDER_BATCH]);
  });

  it('Reminder_IsDeleted_WhenTheEmailSetupThrows', async () => {
    m.create.mockResolvedValue({ ok: true, recipients: [recipient(41, [[7, 'Anjali Smith', 70]])], skipped: [] });
    const broken = { from: () => { throw new Error('fetch failed'); } } as unknown as SupabaseClient;
    await sendReminders(broken, { entryId: 5, personIds: [7], sentBy: 82 }).catch(() => undefined);
    expect(deleted()).toEqual([70]);
  });

  it('Reminder_IsSweptAgain_WhenItsDeleteFails', async () => {
    m.create.mockResolvedValue({ ok: true, recipients: [recipient(41, [[7, 'Anjali Smith', 70]])], skipped: [] });
    m.send.mockResolvedValue({ status: 'error', to: [] });
    m.del.mockResolvedValueOnce(false);
    await sendReminders(sb, { entryId: 5, personIds: [7], sentBy: 82 });
    expect(deleted()).toEqual([70, 70]);
  });

  it('Reminder_IsDeleted_WhenTheEmailHangs', async () => {
    vi.useFakeTimers();
    try {
      m.create.mockResolvedValue({ ok: true, recipients: [recipient(41, [[7, 'Anjali Smith', 70]])], skipped: [] });
      m.send.mockReturnValue(new Promise(() => undefined));
      const done = sendReminders(sb, { entryId: 5, personIds: [7], sentBy: 82 });
      await vi.advanceTimersByTimeAsync(REMINDER_EMAIL_TIMEOUT_MS);
      await done;
      expect(deleted()).toEqual([70]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('batches', () => {
  it('Reminder_SendsAFewAtATime', async () => {
    const many = Array.from({ length: REMINDER_BATCH * 2 + 1 }, (_, i) => recipient(100 + i, [[200 + i, `Scout ${i}`, 300 + i]]));
    m.create.mockResolvedValue({ ok: true, recipients: many, skipped: [] });
    let inFlight = 0;
    let most = 0;
    m.send.mockImplementation(async () => {
      most = Math.max(most, ++inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return { status: 'sent', to: [] };
    });
    await sendReminders(sb, { entryId: 5, personIds: many.map((r) => r.people[0].personId), sentBy: 82 });
    expect(most).toBe(REMINDER_BATCH);
  });
});
