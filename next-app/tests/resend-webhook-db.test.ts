import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { applyResendEvent, type EventTags, type ResendEmailEvent } from '../src/lib/resend-webhook';

/**
 * Resend events → the meeting email log (lib/resend-webhook). Test-owned rows only: a 2087 meeting whose emails
 * cascade with it; Resend ids carry a per-run suffix so they can't meet a real one.
 */
const sb = adminClient();
const RUN = randomUUID().slice(0, 8);
let meeting = 0;

type Row = { id: number; resend_id: string | null; delivery_status: string | null; delivered_at: string | null; opened_at: string | null };

async function email(resendId: string | null): Promise<number> {
  const { data, error } = await sb
    .from('meeting_emails')
    .insert({ calendar_entry_id: meeting, kind: 'plan', batch_id: randomUUID(), sent_to: 'hook@example.com', status: resendId ? 'sent' : 'unknown', resend_id: resendId })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data!.id as number;
}
async function row(id: number): Promise<Row> {
  const { data } = await sb.from('meeting_emails').select('id, resend_id, delivery_status, delivered_at, opened_at').eq('id', id).single();
  return data as Row;
}
const ev = (type: string, resendId: string, at: string, tags?: EventTags): ResendEmailEvent => ({
  type,
  created_at: at,
  data: { email_id: resendId, tags }
});
const rid = (n: string) => `re_vitest_${RUN}_${n}`;

beforeAll(async () => {
  await sb.from('calendar_entries').delete().like('title', `%${TEST_PREFIX}%`).gte('entry_date', '2087-01-01').lte('entry_date', '2087-12-31');
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: '2087-03-02', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX} RESEND` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id as number;
});

beforeEach(async () => {
  await sb.from('meeting_emails').delete().eq('calendar_entry_id', meeting);
});

afterAll(async () => {
  await sb.from('calendar_entries').delete().eq('id', meeting);
});

describe('applyResendEvent', () => {
  it('Delivered_MarksTheRowDelivered_ByResendId', async () => {
    const id = await email(rid('d'));
    await applyResendEvent(sb, ev('email.delivered', rid('d'), '2087-03-01T15:00:00.000Z'));
    const r = await row(id);
    expect([r.delivery_status, new Date(r.delivered_at!).toISOString()]).toEqual(['delivered', '2087-03-01T15:00:00.000Z']);
  });

  it('Bounced_OverwritesDelivered', async () => {
    const id = await email(rid('b'));
    await applyResendEvent(sb, ev('email.delivered', rid('b'), '2087-03-01T15:00:00.000Z'));
    await applyResendEvent(sb, ev('email.bounced', rid('b'), '2087-03-01T15:05:00.000Z'));
    expect((await row(id)).delivery_status).toBe('bounced');
  });

  it('Delivered_NeverOverwritesABounce', async () => {
    const id = await email(rid('bd'));
    await applyResendEvent(sb, ev('email.bounced', rid('bd'), '2087-03-01T15:05:00.000Z'));
    const outcome = await applyResendEvent(sb, ev('email.delivered', rid('bd'), '2087-03-01T15:00:00.000Z'));
    expect([outcome, (await row(id)).delivery_status]).toEqual(['unchanged', 'bounced']);
  });

  it('Opened_KeepsTheEarliestTime_WhenEventsArriveOutOfOrder', async () => {
    const id = await email(rid('o'));
    await applyResendEvent(sb, ev('email.opened', rid('o'), '2087-03-01T18:00:00.000Z'));
    await applyResendEvent(sb, ev('email.opened', rid('o'), '2087-03-01T16:00:00.000Z'));
    await applyResendEvent(sb, ev('email.opened', rid('o'), '2087-03-01T19:00:00.000Z'));
    expect(new Date((await row(id)).opened_at!).toISOString()).toBe('2087-03-01T16:00:00.000Z');
  });

  it('Clicked_CountsAsOpened', async () => {
    const id = await email(rid('c'));
    await applyResendEvent(sb, ev('email.clicked', rid('c'), '2087-03-01T17:00:00.000Z'));
    expect(new Date((await row(id)).opened_at!).toISOString()).toBe('2087-03-01T17:00:00.000Z');
  });

  it('Tag_MatchesARowWithNoResendId_AndTheRowLearnsIt', async () => {
    const id = await email(null);
    await applyResendEvent(sb, ev('email.delivered', rid('t'), '2087-03-01T15:00:00.000Z', { meeting_email_id: String(id) }));
    const r = await row(id);
    expect([r.resend_id, r.delivery_status]).toEqual([rid('t'), 'delivered']);
  });

  it('Tag_NeverRedirectsAnEventOntoARowWithAnotherResendId', async () => {
    const id = await email(rid('mine'));
    expect(await applyResendEvent(sb, ev('email.opened', rid('theirs'), '2087-03-01T15:00:00.000Z', { meeting_email_id: String(id) }))).toBe('no-match');
  });

  it('OtherEmail_MatchesNothing', async () => {
    expect(await applyResendEvent(sb, ev('email.delivered', rid('signin'), '2087-03-01T15:00:00.000Z'))).toBe('no-match');
  });

  it('UnhandledEventTypes_AreIgnored', async () => {
    expect(await applyResendEvent(sb, ev('email.sent', rid('x'), '2087-03-01T15:00:00.000Z'))).toBe('ignored');
  });
});
