import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Meeting invites, P1: the send (Plans/Matcher-Tune-Up.md T-5, lib/meeting-invites-send). The database half and the mail
 * transport are the mock boundary; what's checked here is the send's own job (who may send is the planner's check): one email per invite from
 * the Troop 79 Bugler carrying that invite's own link, and an invite whose email didn't go out deleted.
 */
const m = vi.hoisted(() => ({
  actor: { subjectKind: 'adult', personId: 82 } as { subjectKind: string; personId: number | null },
  create: vi.fn(),
  createPick: vi.fn(),
  del: vi.fn(),
  send: vi.fn(),
  audit: vi.fn()
}));
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => m.actor }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/meeting-invites-db', () => ({ createTeachInvites: m.create, createPickInvites: m.createPick, deleteInvites: m.del }));
vi.mock('@/lib/email', () => ({ sendEmail: m.send }));
vi.mock('@/lib/audit', () => ({ recordAudit: m.audit }));
vi.mock('@/lib/site-url', () => ({ siteUrl: () => 'https://www.troop-79.com' }));
vi.mock('@/lib/advancement-catalog', () => ({
  loadAdvancementCatalog: async () => ({
    ranks: [{ id: 'tenderfoot', display_name: 'Tenderfoot', sort_order: 1 }],
    rankRequirements: [{ id: 1, rank_id: 'tenderfoot', parent_id: null, code: '3a', label: 'Knots', complete_rule: 'all', complete_n: null, sort_order: 1, venue: 'either', skill_id: null }],
    meritBadges: [],
    skills: []
  })
}));
const chain = (result: unknown) => {
  const q: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'is', 'in', 'order', 'limit']) q[k] = () => q;
  q.single = async () => result;
  q.maybeSingle = async () => ({ data: null });
  q.then = (res: (v: unknown) => void) => res({ data: [{ id: 41, nickname: 'Dan', first_name: 'Daniel', display_name: 'Dan Bieser' }] });
  return q;
};
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ from: () => chain({ data: { entry_date: '2091-03-04' } }) }) }));

const { createAdminClient } = await import('@/lib/supabase/server');
const { sendTeachInvites, sendPickInvites } = await import('../src/lib/meeting-invites-send');
// Admin's wrappers retired with This Sunday (P5c); the planner calls these same functions after its own access check.
const sendTeachInvitesAction = (input: { entryId: number; topicKey: string; personIds: number[] }) => sendTeachInvites(createAdminClient(), { ...input, sentBy: 82 });
const sendPickInvitesAction = (input: { entryId: number; topicKey: string; scoutIds: number[] }) => sendPickInvites(createAdminClient(), { ...input, sentBy: 82 });

const invite = (personId: number, token: string) => ({ inviteId: personId * 10, personId, name: `Person ${personId}`, sentTo: `p${personId}@example.com`, token });

beforeEach(() => {
  for (const f of [m.create, m.createPick, m.del, m.send, m.audit]) f.mockReset();
  m.actor = { subjectKind: 'adult', personId: 82 };
});

describe('sendTeachInvitesAction', () => {
  it('Leader_SendsEachInvite_FromTheBugler_WithItsOwnLink', async () => {
    m.create.mockResolvedValue({ ok: true, invites: [invite(41, 'a'.repeat(64))], skipped: [] });
    m.send.mockResolvedValue({ status: 'sent', to: ['p41@example.com'] });
    const res = await sendTeachInvitesAction({ entryId: 5, topicKey: 'tenderfoot-3a', personIds: [41] });
    const mail = m.send.mock.calls[0][0];
    expect([res.ok, mail.to, mail.fromName, mail.confirm, mail.html.includes(`https://www.troop-79.com/i/${'a'.repeat(64)}`)]).toEqual([true, ['p41@example.com'], 'Troop 79 Bugler', true, true]);
  });

  it('AnEmailThatDidntGoOut_DeletesItsInvite', async () => {
    m.create.mockResolvedValue({ ok: true, invites: [invite(41, 'a'.repeat(64)), invite(42, 'b'.repeat(64))], skipped: [] });
    m.send.mockResolvedValueOnce({ status: 'sent', to: [] }).mockResolvedValueOnce({ status: 'error', to: [] });
    const res = await sendTeachInvitesAction({ entryId: 5, topicKey: 'tenderfoot-3a', personIds: [41, 42] });
    expect([m.del.mock.calls[0][1], res.ok && res.sent, res.ok && res.skipped.map((s) => s.name)]).toEqual([[420], ['Person 41'], ['Person 42']]);
  });

  it('ATopicNotInTheCatalog_IsRefused_BeforeAnythingIsMinted', async () => {
    const res = await sendTeachInvitesAction({ entryId: 5, topicKey: 'tenderfoot-99z', personIds: [41] });
    expect([res.ok, m.create.mock.calls.length]).toEqual([false, 0]);
  });

  it('ASendThatThrows_LeavesNoInviteBehindWithoutItsEmail', async () => {
    m.create.mockResolvedValue({ ok: true, invites: [invite(41, 'a'.repeat(64)), invite(42, 'b'.repeat(64))], skipped: [] });
    m.send.mockResolvedValueOnce({ status: 'sent', to: [] }).mockRejectedValueOnce(new Error('network'));
    const res = await sendTeachInvitesAction({ entryId: 5, topicKey: 'tenderfoot-3a', personIds: [41, 42] });
    expect([m.del.mock.calls.flatMap((c) => c[1]), res.ok && res.sent]).toEqual([[420], ['Person 41']]);
  });


  it('TheSend_IsAudited', async () => {
    m.create.mockResolvedValue({ ok: true, invites: [invite(41, 'a'.repeat(64))], skipped: [] });
    m.send.mockResolvedValue({ status: 'sent', to: [] });
    await sendTeachInvitesAction({ entryId: 5, topicKey: 'tenderfoot-3a', personIds: [41] });
    expect(m.audit.mock.calls[0][0]).toMatchObject({ area: 'meeting', action: 'invite.teach', entityId: 5 });
  });
});

describe('sendPickInvitesAction (P2)', () => {
  const parentOfTwo = {
    recipientId: 50,
    name: 'Jamie T',
    sentTo: 'jamie@example.com',
    isScout: false,
    scouts: [
      { scoutId: 1, scoutName: 'Anjali Sankpal', inviteId: 11, token: 'a'.repeat(64) },
      { scoutId: 2, scoutName: 'Finn Paltzer', inviteId: 12, token: 'b'.repeat(64) }
    ]
  };

  it('AParentOfTwo_GetsOneEmail_WithALinkForEachScout', async () => {
    m.createPick.mockResolvedValue({ ok: true, recipients: [parentOfTwo], skipped: [] });
    m.send.mockResolvedValue({ status: 'sent', to: [] });
    const res = await sendPickInvitesAction({ entryId: 5, topicKey: 'tenderfoot-3a', scoutIds: [1, 2] });
    const mail = m.send.mock.calls[0][0];
    expect([m.send.mock.calls.length, mail.fromName, mail.html.includes(`/i/${'a'.repeat(64)}`), mail.html.includes(`/i/${'b'.repeat(64)}`), res.ok && res.sent]).toEqual([
      1,
      'Troop 79 Bugler',
      true,
      true,
      ['Anjali S', 'Finn P']
    ]);
  });

  it('AnEmailThatDidntGoOut_TakesThatFamilysInvitesWithIt', async () => {
    m.createPick.mockResolvedValue({ ok: true, recipients: [parentOfTwo], skipped: [] });
    m.send.mockResolvedValue({ status: 'error', to: [] });
    await sendPickInvitesAction({ entryId: 5, topicKey: 'tenderfoot-3a', scoutIds: [1, 2] });
    expect(m.del.mock.calls[0][1]).toEqual([11, 12]);
  });

});
