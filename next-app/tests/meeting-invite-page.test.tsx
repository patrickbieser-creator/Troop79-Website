import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * Meeting invites, P1: the answer page /i/<token> (Plans/Matcher-Tune-Up.md T-5, qa-lead review). The card says one
 * thing per state and answers by POST only; the action is rate-limited per address, records a failure without the
 * token, and never signs anyone in.
 */
const m = vi.hoisted(() => ({ respond: vi.fn(), tooMany: vi.fn(), fail: vi.fn(), audit: vi.fn(), redirect: vi.fn() }));
vi.mock('@/lib/meeting-invites-db', () => ({ respondToInvite: m.respond, tooManyInviteFailures: m.tooMany, recordInviteFailure: m.fail }));
vi.mock('@/lib/audit', () => ({ recordAuditAs: m.audit }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));
const revalidate = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath: revalidate }));
vi.mock('next/headers', () => ({ headers: async () => new Map([['x-forwarded-for', '203.0.113.9']]) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    m.redirect(url);
    throw new Error('REDIRECT');
  }
}));

const { InviteCard } = await import('../src/app/(public)/i/[token]/invite-card');
const { answerInviteAction } = await import('../src/app/(public)/i/actions');

const card = (o: Partial<Parameters<typeof InviteCard>[0]> = {}) =>
  render(
    <InviteCard
      state="open"
      token={'a'.repeat(64)}
      inviteeName="Dan Bieser"
      topic="First Aid for Tenderfoot"
      code="Tenderfoot 4a"
      minutes="about 40 min"
      parts={[{ code: '4a.1', label: 'Simple cuts', minutes: 20 }]}
      day="Sunday, October 25, 2026"
      response={null}
      err={null}
      {...o}
    />
  );
const form = (answer: string) => {
  const fd = new FormData();
  fd.set('token', 'a'.repeat(64));
  fd.set('answer', answer);
  return fd;
};
const run = async (fd: FormData) => {
  await answerInviteAction(fd).catch(() => undefined);
  return m.redirect.mock.calls.at(-1)?.[0] as string;
};

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.tooMany.mockResolvedValue(false);
});

describe('the invite card', () => {
  it('OpenInvite_AsksWhoItIsFor_AndOffersYesAndNotThisWeek', () => {
    card();
    expect([screen.getByText(/This invite is for/).textContent, screen.getByRole('button', { name: 'Yes, I’ll teach it' }) != null, screen.getByRole('button', { name: 'Not this week' }) != null]).toEqual([
      'This invite is for Dan Bieser. If that isn’t you, please don’t answer it.',
      true,
      true
    ]);
  });

  it('OpenInvite_ShowsTheTopicsTimeAndParts', () => {
    card();
    expect([screen.getByText(/about 40 min/) != null, screen.getByRole('list', { name: 'First Aid for Tenderfoot, its parts' }) != null]).toEqual([true, true]);
  });

  it('AnsweredYes_SaysThankYou_NotThatTheLinkIsBroken', () => {
    card({ state: 'answered', response: 'accepted' });
    expect([screen.queryByRole('button', { name: 'Yes, I’ll teach it' }), screen.getByText(/You’re teaching First Aid for Tenderfoot/) != null]).toEqual([null, true]);
  });

  it('ExpiredInvite_SaysItClosedAtSixPm', () => {
    card({ state: 'expired' });
    expect(screen.getByText(/closed at 6:00 PM/)).toBeTruthy();
  });

  it('UnknownLink_PointsToTheSundayPage', () => {
    card({ state: 'unknown' });
    expect(screen.getByRole('link', { name: /your Sunday page/ }).getAttribute('href')).toBe('/member/meeting');
  });
});

describe('answering', () => {
  it('Yes_AnswersTheInvite_AndLandsBackOnIt', async () => {
    m.respond.mockResolvedValue({ ok: true, response: 'accepted', inviteId: 7, inviteeId: 41 });
    const url = await run(form('accept'));
    expect([m.respond.mock.calls[0][2], url]).toEqual(['accept', `/i/${'a'.repeat(64)}`]);
  });

  it('AnAnswer_RefreshesTheInvitePage_SoItShowsTheResult', async () => {
    m.respond.mockResolvedValue({ ok: true, response: 'accepted', inviteId: 7, inviteeId: 41 });
    await run(form('accept'));
    expect(revalidate).toHaveBeenCalledWith('/i/[token]', 'page');
  });

  it('TooManyFailures_FromOneAddress_AnswersNothing', async () => {
    m.tooMany.mockResolvedValue(true);
    const url = await run(form('accept'));
    expect([m.respond.mock.calls.length, url.endsWith('?err=busy')]).toEqual([0, true]);
  });

  it('AFailedAnswer_IsLogged_WithoutTheToken', async () => {
    m.respond.mockResolvedValue({ ok: false, state: 'unknown' });
    await run(form('accept'));
    expect([m.fail.mock.calls[0][1], JSON.stringify(m.fail.mock.calls[0]).includes('a'.repeat(64))]).toEqual(['203.0.113.9', false]);
  });

  it('AGarbledAnswer_RecordsNothing', async () => {
    const url = await run(form('maybe'));
    expect([m.respond.mock.calls.length, url]).toEqual([0, `/i/${'a'.repeat(64)}`]);
  });

  it('ATapOnAnAlreadyAnsweredLink_IsNotCountedAgainstTheAddress', async () => {
    m.respond.mockResolvedValue({ ok: false, state: 'answered' });
    await run(form('accept'));
    expect(m.fail.mock.calls.length).toBe(0);
  });

  it('AFullTeacher_IsToldWhy_AndTheInviteStaysOpen', async () => {
    m.respond.mockResolvedValue({ ok: false, state: 'open', error: 'You’re teaching 2. Remove one to add another.', code: 'full' });
    const url = await run(form('accept'));
    expect([url.endsWith('?err=full'), m.fail.mock.calls.length]).toEqual([true, 0]);
  });

  it('AnAnswer_IsAudited_AsTheInvitee', async () => {
    m.respond.mockResolvedValue({ ok: true, response: 'declined', inviteId: 7, inviteeId: 41 });
    await run(form('decline'));
    expect(m.audit.mock.calls[0][1]).toMatchObject({ personId: 41 });
  });
});
