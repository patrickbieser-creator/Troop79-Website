import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import {
  EMAIL_CLAIM_STALE_SECONDS,
  EMAIL_SEND_CAP,
  queueEmails,
  claimRetry,
  sendNextEmail,
  unfinishedSends,
  type QueueEmail,
  type SendDeps
} from '../src/lib/meeting-emails';
import { SUGGESTION_CAP } from '../src/lib/family-week-shared';

/**
 * Meeting Planner III Emails, E1 (Plans/Meeting-Planner-III-Emails.md): the log and the one-at-a-time sender. Nothing
 * is mailed: the sender is injected. Test-owned rows only: a 2086 meeting, whose emails, suggestions and exclusions
 * cascade with it. Real scouts are only referenced, never changed.
 */
const sb = adminClient();
const MEETING_DATE = '2086-02-03';
let meeting = 0;
let scoutA = 0;
let scoutB = 0;
let actor = 0;

const plan = (sentTo: string, scouts: number[]): QueueEmail => ({ kind: 'plan', recipientPersonId: null, sentTo, about: { scouts } });

type Sent = { to: string; idempotencyKey: string };
function deps(outcome: (to: string) => 'sent' | 'error' | 'timeout' | 'skipped' = () => 'sent', extra: Partial<SendDeps> = {}) {
  const sent: Sent[] = [];
  const undone: number[] = [];
  const kept: number[] = [];
  const d: SendDeps = {
    prepare: async (row) => ({
      subject: `About ${row.id}`,
      html: '<p>x</p>',
      text: 'x',
      onSent: async () => void kept.push(row.id),
      undo: async () => void undone.push(row.id)
    }),
    send: vi.fn(async (opts) => {
      sent.push({ to: opts.to, idempotencyKey: opts.idempotencyKey });
      const o = outcome(opts.to);
      if (o === 'timeout') return 'timeout' as const;
      if (o === 'sent') return { status: 'sent' as const, id: `re_${opts.idempotencyKey}`, deliveredTo: opts.to };
      return { status: o, detail: o === 'error' ? 'mailbox unavailable' : 'not configured' };
    }) as SendDeps['send'],
    ...extra
  };
  return { sent, undone, kept, d };
}

async function rows() {
  const { data } = await sb.from('meeting_emails').select('*').eq('calendar_entry_id', meeting).order('id');
  return (data ?? []) as { id: number; status: string; failure: string | null; resend_id: string | null; about: { scouts?: number[] }; batch_id: string; sent_to: string }[];
}

beforeAll(async () => {
  await sb.from('calendar_entries').delete().like('title', `%${TEST_PREFIX}%`).gte('entry_date', '2086-01-01').lte('entry_date', '2086-12-31');
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: MEETING_DATE, category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX} EMAILS` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id as number;
  const { data: s } = await sb.from('scouts').select('person_id').eq('active', true).not('person_id', 'is', null).order('person_id').limit(2);
  [scoutA, scoutB] = ((s ?? []) as { person_id: number }[]).map((r) => r.person_id);
  actor = scoutA;
});

beforeEach(async () => {
  await sb.from('meeting_emails').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_scout_suggestions').delete().eq('calendar_entry_id', meeting);
});

afterAll(async () => {
  await sb.from('calendar_entries').delete().eq('id', meeting);
});

describe('queue', () => {
  it('Planner_CanQueueEmails_OneRowPerRecipientPerKind', async () => {
    await queueEmails(sb, { entryId: meeting, actorPersonId: actor, emails: [plan('parent@example.com', [scoutA]), plan('Parent@example.com', [scoutB])] });
    const r = await rows();
    expect(r.map((x) => [...(x.about.scouts ?? [])].sort())).toEqual([[scoutA, scoutB].sort()]);
  });

  it('Planner_CannotQueue_OverTheCap', async () => {
    const many = Array.from({ length: EMAIL_SEND_CAP + 1 }, (_, i) => plan(`p${i}@example.com`, [scoutA]));
    const res = await queueEmails(sb, { entryId: meeting, actorPersonId: actor, emails: many });
    expect([res.ok && res.queued, res.ok && res.overflow.length, (await rows()).length]).toEqual([EMAIL_SEND_CAP, 1, EMAIL_SEND_CAP]);
  });
});

describe('send one at a time', () => {
  it('Sender_SendsEachQueuedEmailOnce_ThenReportsDone', async () => {
    const q = await queueEmails(sb, { entryId: meeting, actorPersonId: actor, emails: [plan('a@example.com', [scoutA]), plan('b@example.com', [scoutB])] });
    const batchId = q.ok ? q.batchId : '';
    const { sent, d } = deps();
    const steps = [await sendNextEmail(sb, { entryId: meeting, batchId }, d), await sendNextEmail(sb, { entryId: meeting, batchId }, d), await sendNextEmail(sb, { entryId: meeting, batchId }, d)];
    expect([sent.map((x) => x.to).sort(), steps.map((s) => s.done), (await rows()).map((x) => x.status)]).toEqual([['a@example.com', 'b@example.com'], [false, false, true], ['sent', 'sent']]);
  });

  it('Sender_ClaimsEachQueuedRowOnce_WhenTwoSendersRace', async () => {
    const q = await queueEmails(sb, { entryId: meeting, actorPersonId: actor, emails: [plan('race@example.com', [scoutA])] });
    const batchId = q.ok ? q.batchId : '';
    const { sent, d } = deps();
    await Promise.all([sendNextEmail(sb, { entryId: meeting, batchId }, d), sendNextEmail(sb, { entryId: meeting, batchId }, d)]);
    expect(sent.length).toBe(1);
  });

  it('Sender_PassesTheRowAsIdempotencyKey', async () => {
    const q = await queueEmails(sb, { entryId: meeting, actorPersonId: actor, emails: [plan('key@example.com', [scoutA])] });
    const { sent, d } = deps();
    await sendNextEmail(sb, { entryId: meeting, batchId: q.ok ? q.batchId : '' }, d);
    const [row] = await rows();
    expect(sent[0].idempotencyKey).toBe(`meeting-email-${row.id}`);
  });

  it('Sender_RecordsTheResendId_WhenSent', async () => {
    const q = await queueEmails(sb, { entryId: meeting, actorPersonId: actor, emails: [plan('id@example.com', [scoutA])] });
    const { d } = deps();
    await sendNextEmail(sb, { entryId: meeting, batchId: q.ok ? q.batchId : '' }, d);
    const [row] = await rows();
    expect(row.resend_id).toBe(`re_meeting-email-${row.id}`);
  });

  it('Sender_MarksFailedWithReason_WhenResendRefuses', async () => {
    const q = await queueEmails(sb, { entryId: meeting, actorPersonId: actor, emails: [plan('bad@example.com', [scoutA])] });
    const { d } = deps(() => 'error');
    await sendNextEmail(sb, { entryId: meeting, batchId: q.ok ? q.batchId : '' }, d);
    const [row] = await rows();
    expect([row.status, row.failure]).toEqual(['failed', 'mailbox unavailable']);
  });

  it('Sender_DeletesTheLink_WhenTheEmailDidNotGo', async () => {
    const q = await queueEmails(sb, { entryId: meeting, actorPersonId: actor, emails: [plan('gone@example.com', [scoutA])] });
    const { undone, d } = deps(() => 'error');
    await sendNextEmail(sb, { entryId: meeting, batchId: q.ok ? q.batchId : '' }, d);
    expect(undone.length).toBe(1);
  });

  it('Sender_TimeoutIsUnknown_NotFailed', async () => {
    const q = await queueEmails(sb, { entryId: meeting, actorPersonId: actor, emails: [plan('slow@example.com', [scoutA])] });
    const { undone, d } = deps(() => 'timeout');
    await sendNextEmail(sb, { entryId: meeting, batchId: q.ok ? q.batchId : '' }, d);
    const [row] = await rows();
    expect([row.status, undone.length]).toEqual(['unknown', 0]);
  });

  it('Sender_ReleasesAStaleClaim_AsUnknown', async () => {
    const q = await queueEmails(sb, { entryId: meeting, actorPersonId: actor, emails: [plan('stuck@example.com', [scoutA])] });
    const batchId = q.ok ? q.batchId : '';
    const [row] = await rows();
    await sb.from('meeting_emails').update({ status: 'sending', claimed_at: new Date(Date.now() - (EMAIL_CLAIM_STALE_SECONDS + 5) * 1000).toISOString() }).eq('id', row.id);
    const { sent, d } = deps();
    await sendNextEmail(sb, { entryId: meeting, batchId }, d);
    expect([(await rows())[0].status, sent.length]).toEqual(['unknown', 0]);
  });

  it('Sender_LeavesAFreshClaimAlone', async () => {
    const q = await queueEmails(sb, { entryId: meeting, actorPersonId: actor, emails: [plan('busy@example.com', [scoutA])] });
    const [row] = await rows();
    await sb.from('meeting_emails').update({ status: 'sending', claimed_at: new Date().toISOString() }).eq('id', row.id);
    const { d } = deps();
    await sendNextEmail(sb, { entryId: meeting, batchId: q.ok ? q.batchId : '' }, d);
    expect((await rows())[0].status).toBe('sending');
  });

  it('Sender_FailsTheRow_WhenItCannotBeBuilt', async () => {
    const q = await queueEmails(sb, { entryId: meeting, actorPersonId: actor, emails: [plan('build@example.com', [scoutA])] });
    const { sent, d } = deps(undefined, { prepare: async () => { throw new Error('boom'); } });
    await sendNextEmail(sb, { entryId: meeting, batchId: q.ok ? q.batchId : '' }, d);
    expect([(await rows())[0].status, sent.length]).toEqual(['failed', 0]);
  });

  it('SendNext_RefusesAForeignBatch', async () => {
    const q = await queueEmails(sb, { entryId: meeting, actorPersonId: actor, emails: [plan('mine@example.com', [scoutA])] });
    const { sent, d } = deps();
    const res = await sendNextEmail(sb, { entryId: meeting + 1, batchId: q.ok ? q.batchId : '' }, d);
    expect([res.done, sent.length]).toEqual([true, 0]);
  });

  it('Sender_UsesTheOverride_WhenTheEmailWasEdited', async () => {
    await queueEmails(sb, { entryId: meeting, actorPersonId: actor, emails: [{ ...plan('edit@example.com', [scoutA]), bodyMdOverride: 'Just for you' }] });
    const { data } = await sb.from('meeting_emails').select('body_md_override').eq('calendar_entry_id', meeting).single();
    expect((data as { body_md_override: string }).body_md_override).toBe('Just for you');
  });
});

describe('unfinished sends', () => {
  it('Leader_SeesUnfinishedSends_WhenQueuedRowsRemain', async () => {
    await queueEmails(sb, { entryId: meeting, actorPersonId: actor, emails: [plan('left@example.com', [scoutA]), plan('left2@example.com', [scoutA])] });
    await sb.from('meeting_emails').update({ queued_at: new Date(Date.now() - (EMAIL_CLAIM_STALE_SECONDS + 5) * 1000).toISOString() }).eq('calendar_entry_id', meeting);
    const u = await unfinishedSends(sb, meeting);
    expect(u.map((x) => x.queued)).toEqual([2]);
  });

  it('Leader_DoesNotSeeASendStillRunning', async () => {
    await queueEmails(sb, { entryId: meeting, actorPersonId: actor, emails: [plan('now@example.com', [scoutA])] });
    expect(await unfinishedSends(sb, meeting)).toEqual([]);
  });

  it('SendAgain_MarksTheFailedEmailRetried', async () => {
    const q = await queueEmails(sb, { entryId: meeting, actorPersonId: actor, emails: [plan('again@example.com', [scoutA])] });
    const { d } = deps(() => 'error');
    await sendNextEmail(sb, { entryId: meeting, batchId: q.ok ? q.batchId : '' }, d);
    const [failed] = await rows();
    const got = await claimRetry(sb, { entryId: meeting, ids: [failed.id] });
    expect([got.map((r) => r.id), (await rows()).map((x) => x.status)]).toEqual([[failed.id], ['retried']]);
  });

  it('SendAgain_Twice_ClaimsTheEmailOnce', async () => {
    const q = await queueEmails(sb, { entryId: meeting, actorPersonId: actor, emails: [plan('twice@example.com', [scoutA])] });
    const { d } = deps(() => 'timeout');
    await sendNextEmail(sb, { entryId: meeting, batchId: q.ok ? q.batchId : '' }, d);
    const [unknown] = await rows();
    const [a, b] = await Promise.all([claimRetry(sb, { entryId: meeting, ids: [unknown.id, unknown.id] }), claimRetry(sb, { entryId: meeting, ids: [unknown.id] })]);
    expect(a.length + b.length).toBe(1);
  });

  it('SendAgain_IgnoresASentEmail', async () => {
    const q = await queueEmails(sb, { entryId: meeting, actorPersonId: actor, emails: [plan('fine@example.com', [scoutA])] });
    const { d } = deps();
    await sendNextEmail(sb, { entryId: meeting, batchId: q.ok ? q.batchId : '' }, d);
    const [sent] = await rows();
    expect(await claimRetry(sb, { entryId: meeting, ids: [sent.id] })).toEqual([]);
  });
});

describe('suggestions', () => {
  it('Family_CannotAddASixthSuggestion', async () => {
    const keys = ['tenderfoot-1a', 'tenderfoot-1b', 'tenderfoot-1c', 'tenderfoot-2a', 'tenderfoot-2b', 'tenderfoot-2c'];
    const results = [];
    for (const k of keys) results.push(await sb.rpc('meeting_add_suggestion_capped', { p_entry: meeting, p_person: scoutA, p_actor: actor, p_topic_key: k, p_cap: SUGGESTION_CAP }));
    expect(results.map((r) => r.error == null)).toEqual([true, true, true, true, true, false]);
  });

  it('Family_AddingTheSameSuggestionTwice_IsANoOp', async () => {
    for (let i = 0; i < 2; i++) await sb.rpc('meeting_add_suggestion_capped', { p_entry: meeting, p_person: scoutA, p_actor: actor, p_topic_key: 'tenderfoot-1a', p_cap: SUGGESTION_CAP });
    const { count } = await sb.from('meeting_scout_suggestions').select('*', { count: 'exact', head: true }).eq('calendar_entry_id', meeting);
    expect(count).toBe(1);
  });
});
