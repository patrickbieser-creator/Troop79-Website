import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Build a Plan B10b (Plans/Build-A-Plan.md "B10 spec"): a teacher's digest carries ONE "Choose what you'll teach →"
 * button to /i/teach/<token>, a page that answers only that teacher's classes on that page, for that meeting, until
 * 6 PM on the meeting day. Real local database; the mail transport is mocked (no email leaves this machine), as are
 * "today" (2094-02-20) and the request headers. Test-owned rows only: the meeting (its pages, invites, topics and
 * teachers by entry), fixture people, households and skills by id, failure rows by this run's IP.
 */
const sb = adminClient();
const state = vi.hoisted(() => ({
  send: vi.fn(async (opts: { to: string[]; html?: string; text?: string }) => ({ status: 'sent', to: opts.to })),
  redirect: vi.fn(),
  ip: '198.51.100.7'
}));

vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/email', () => ({ sendEmail: (opts: { to: string[] }) => state.send(opts) }));
vi.mock('@/lib/audit', () => ({ recordAudit: vi.fn(), recordAuditAs: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('next/headers', () => ({ headers: async () => new Map([['x-forwarded-for', state.ip]]) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    state.redirect(url);
    throw new Error('REDIRECT');
  }
}));
vi.mock('@/lib/dates', async (orig) => ({ ...(await orig<typeof import('../src/lib/dates')>()), centralToday: () => '2094-02-20' }));

const { fetchAdvancementCatalog } = await import('../src/lib/advancement-catalog');
const { sendInviteDigests } = await import('../src/lib/meeting-invite-digest-send');
const { answerTeachPage, inspectTeachPage, saveDeclineNotes } = await import('../src/lib/meeting-teach-pages');
const { hashSecret } = await import('../src/lib/identity-challenge');
const { randomInviteToken, respondToInvite } = await import('../src/lib/meeting-invites-db');
const { DEFAULT_INVITE_DIGEST, TEACH_PAGE_BUTTON, renderInviteDigest } = await import('../src/lib/meeting-invite-email');
const loadCatalog = () => fetchAdvancementCatalog(sb);

const DATE = '2094-03-14';
let meeting = 0;
let teacher = 0;
let other = 0;
let keys: string[] = [];
const people: number[] = [];
const households: number[] = [];
const mail = (id: number) => `zzvitest-b10b-${id}-${process.pid}@example.com`;

async function adult(label: string): Promise<number> {
  const { data, error } = await sb
    .from('people')
    .insert({ display_name: `${TEST_PREFIX} B10b ${label}`, first_name: TEST_PREFIX, last_name: `B10b ${label}`, active: true })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const id = data!.id as number;
  people.push(id);
  const { error: e2 } = await sb.from('person_emails').insert({ person_id: id, email: mail(id), is_primary: true });
  if (e2) throw new Error(e2.message);
  const { data: h } = await sb.from('households').insert({ label: `${TEST_PREFIX} B10b ${label} family` }).select('id').single();
  households.push(h!.id);
  await sb.from('household_members').insert({ household_id: h!.id, person_id: id });
  return id;
}

beforeAll(async () => {
  await sb.from('calendar_entries').delete().like('title', `%${TEST_PREFIX}%`).eq('entry_date', DATE);
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: DATE, category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX} B10b` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id;
  teacher = await adult('Teacher');
  other = await adult('Other');
  const { data: tf } = await sb.from('rank_requirements').select('id, parent_id, code, venue').eq('rank_id', 'tenderfoot').order('sort_order');
  const rows = (tf ?? []) as { id: number; parent_id: number | null; code: string; venue: string }[];
  keys = rows
    .filter((r) => r.parent_id == null && r.venue !== 'outing' && r.code.toLowerCase() !== 'bor')
    .slice(0, 3)
    .map((r) => `tenderfoot-${r.code}`);
  if (keys.length < 3) throw new Error('fixture: need three meeting-doable Tenderfoot requirements');
  const seeded = await sb.rpc('meeting_seed_many', { p_entry: meeting, p_keys: keys, p_actor: teacher });
  if (seeded.error) throw new Error(seeded.error.message);
}, 60_000);

afterEach(async () => {
  await sb.from('meeting_invite_pages').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_invites').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_topic_teachers').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_invite_failures').delete().eq('ip', state.ip);
  state.send.mockReset();
  state.send.mockImplementation(async (opts: { to: string[] }) => ({ status: 'sent', to: opts.to }));
  state.redirect.mockReset();
});

afterAll(async () => {
  // Rotations L3: a topic's classes first (their FK keeps a topic under a class).
  await sb.from('meeting_classes').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', meeting);
  await sb.from('calendar_entries').delete().eq('id', meeting);
  await sb.from('household_members').delete().in('household_id', households);
  await sb.from('households').delete().in('id', households);
  await sb.from('person_emails').delete().in('person_id', people);
  await sb.from('people').delete().in('id', people);
});

/** Sends a teach digest and returns the page token the email carried ('' when none went out). */
async function sendTeach(ks: string[], who = teacher): Promise<string> {
  await sendInviteDigests(sb, { entryId: meeting, teach: ks.map((key) => ({ key, personIds: [who] })), pick: [], sentBy: null }, { loadCatalog });
  const opts = state.send.mock.calls.at(-1)?.[0] as { html?: string; text?: string } | undefined;
  return /\/i\/teach\/([0-9a-f]{64})/.exec(`${opts?.html ?? ''} ${opts?.text ?? ''}`)?.[1] ?? '';
}
const lineIds = async (token: string) => (await inspectTeachPage(sb, token)).page?.lines.map((l) => l.inviteId) ?? [];
const teaching = async (who = teacher) => (await sb.from('meeting_topic_teachers').select('topic_id').eq('calendar_entry_id', meeting).eq('person_id', who)).data?.length ?? 0;
const pageOf = async (token: string) =>
  (await sb.from('meeting_invite_pages').select('id, superseded_at').eq('token_hash', await hashSecret(token)).maybeSingle()).data as { id: number; superseded_at: string | null } | null;

describe('the email', () => {
  it('Digest_OneTeachButton_NoPerLineLinks', () => {
    const teach = (code: string) => ({ kind: 'teach' as const, inviteeName: 'Kim L', aboutRecipient: true, code, topic: 'Square Knot use', minutes: '', url: 'https://example.com/i/teach/x' });
    const { md } = renderInviteDigest(DEFAULT_INVITE_DIGEST, { name: 'Kim', people: 'you', day: 'Sunday' }, [teach('Tenderfoot 3a'), teach('Tenderfoot 3b')]);
    expect([md.split('](').length - 1, md.includes(`**[${TEACH_PAGE_BUTTON}](https://example.com/i/teach/x)**`), /one at a time/.test(md)]).toEqual([1, true, false]);
  });

  it('Digest_TeacherEmail_LinksTheTeachPage', async () => {
    expect(await sendTeach([keys[0], keys[1]])).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);
});

describe('the page', () => {
  it('TeachPage_Get_WritesNothing', async () => {
    const token = await sendTeach([keys[0], keys[1]]);
    const snap = async () => JSON.stringify([
      (await sb.from('meeting_invite_pages').select('*').eq('calendar_entry_id', meeting).order('id')).data,
      (await sb.from('meeting_invites').select('*').eq('calendar_entry_id', meeting).order('id')).data,
      (await sb.from('meeting_invite_failures').select('id').eq('ip', state.ip)).data
    ]);
    const before = await snap();
    const { default: TeachPage } = await import('../src/app/(public)/i/teach/[token]/page');
    await TeachPage({ params: Promise.resolve({ token }), searchParams: Promise.resolve({}) });
    await TeachPage({ params: Promise.resolve({ token: 'f'.repeat(64) }), searchParams: Promise.resolve({}) });
    expect(await snap()).toBe(before);
  }, 60_000);

  it('TeachPage_UnknownToken_CountsTowardIpLimit', async () => {
    const { answerTeachPageAction } = await import('../src/app/(public)/i/teach/actions');
    const fd = new FormData();
    fd.set('token', randomInviteToken());
    fd.set('line-1', 'yes');
    await answerTeachPageAction(fd).catch(() => undefined);
    const { count } = await sb.from('meeting_invite_failures').select('id', { count: 'exact', head: true }).eq('ip', state.ip);
    expect(count).toBe(1);
  }, 60_000);

  it('TeachPage_ForgottenLines_StayOpen', async () => {
    const token = await sendTeach([keys[0], keys[1]]);
    const [first, second] = await lineIds(token);
    await answerTeachPage(sb, token, [{ inviteId: first, answer: 'yes' }]);
    const { data } = await sb.from('meeting_invites').select('consumed_at, response').eq('id', second).single();
    expect(data).toEqual({ consumed_at: null, response: null });
  }, 60_000);

  it('TeachPage_YesToNo_ReleasesTeacher', async () => {
    const token = await sendTeach([keys[0]]);
    const [line] = await lineIds(token);
    await answerTeachPage(sb, token, [{ inviteId: line, answer: 'yes' }]);
    const afterYes = await teaching();
    await answerTeachPage(sb, token, [{ inviteId: line, answer: 'no' }]);
    const { data } = await sb.from('meeting_invites').select('response').eq('id', line).single();
    expect([afterYes, await teaching(), data?.response]).toEqual([1, 0, 'declined']);
  }, 60_000);

  it('TeachPage_StaleEpoch_VoidsLines', async () => {
    const token = await sendTeach([keys[0]]);
    const [line] = await lineIds(token);
    const { data: p } = await sb.from('people').select('session_epoch').eq('id', teacher).single();
    const epoch = (p as { session_epoch: number }).session_epoch;
    await sb.from('people').update({ session_epoch: epoch + 1 }).eq('id', teacher);
    try {
      const res = await answerTeachPage(sb, token, [{ inviteId: line, answer: 'yes' }]);
      const view = await inspectTeachPage(sb, token);
      expect([res.ok ? 'answered' : res.state, await teaching(), view.page?.lines[0]?.available]).toEqual(['void', 0, false]);
    } finally {
      await sb.from('people').update({ session_epoch: epoch }).eq('id', teacher);
    }
  }, 60_000);

  it('TeachPage_Expired_RefusesSubmit', async () => {
    const token = await sendTeach([keys[0]]);
    const [line] = await lineIds(token);
    await sb.from('meeting_invite_pages').update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('calendar_entry_id', meeting);
    const res = await answerTeachPage(sb, token, [{ inviteId: line, answer: 'yes' }]);
    expect([res.ok ? 'answered' : res.state, await teaching()]).toEqual(['expired', 0]);
  }, 60_000);

  it('TeachPage_OnlyAnswersOwnInvites', async () => {
    const mine = await sendTeach([keys[0]]);
    const theirs = await sendTeach([keys[1]], other);
    const [their] = await lineIds(theirs);
    const res = await answerTeachPage(sb, mine, [{ inviteId: their, answer: 'yes' }]);
    const { data } = await sb.from('meeting_invites').select('response').eq('id', their).single();
    expect([res.ok && res.lines[0]?.result, data?.response, await teaching(other)]).toEqual(['gone', null, 0]);
  }, 60_000);

  it('TeachPage_SubmitsAreCapped', async () => {
    const token = await sendTeach([keys[0]]);
    const [line] = await lineIds(token);
    for (let i = 0; i < 10; i++) await answerTeachPage(sb, token, [{ inviteId: line, answer: i % 2 ? 'no' : 'yes' }]);
    const res = await answerTeachPage(sb, token, [{ inviteId: line, answer: 'yes' }]);
    expect(res.ok ? 'answered' : res.state).toBe('busy');
  }, 60_000);
});

describe('a resend', () => {
  it('Resend_SupersedesOldPage_OnlyAfterEmailSent', async () => {
    const first = await sendTeach([keys[0]]);
    const old = await pageOf(first);
    let during: string | null | undefined;
    state.send.mockImplementationOnce(async (opts: { to: string[] }) => {
      during = (await sb.from('meeting_invite_pages').select('superseded_at').eq('id', old!.id).single()).data?.superseded_at;
      return { status: 'sent', to: opts.to };
    });
    const second = await sendTeach([keys[1]]);
    const view = await inspectTeachPage(sb, second);
    expect([during, (await pageOf(first))?.superseded_at != null, view.page?.lines.map((l) => l.key)]).toEqual([null, true, [keys[0], keys[1]]]);
  }, 60_000);

  it('EmailFailure_DeletesNewPage_KeepsOld', async () => {
    const first = await sendTeach([keys[0]]);
    state.send.mockImplementationOnce(async (opts: { to: string[] }) => ({ status: 'error', to: opts.to }));
    await sendInviteDigests(sb, { entryId: meeting, teach: [{ key: keys[1], personIds: [teacher] }], pick: [], sentBy: null }, { loadCatalog });
    const { data } = await sb.from('meeting_invite_pages').select('id, superseded_at').eq('calendar_entry_id', meeting).eq('recipient_person_id', teacher);
    expect([data?.length, (await inspectTeachPage(sb, first)).state]).toEqual([1, 'open']);
  }, 60_000);
});

describe('deploy order: DB first', () => {
  it('OldProductionCode_StillWorks_AfterMigration', async () => {
    // What main 1c974e51 does: a teach row WITH its own token through meeting_mint_invites, answered at /i/<token>.
    const token = randomInviteToken();
    const minted = await sb.rpc('meeting_mint_invites', {
      p_entry: meeting,
      p_since: new Date(Date.now() - 86400_000).toISOString(),
      p_rows: [
        {
          kind: 'teach',
          topic_key: keys[2],
          invitee_person_id: teacher,
          recipient_person_id: teacher,
          sent_to: mail(teacher),
          invitee_epoch: 0,
          recipient_epoch: (await sb.from('people').select('session_epoch').eq('id', teacher).single()).data!.session_epoch,
          token_hash: await hashSecret(token),
          expires_at: new Date(Date.now() + 86400_000).toISOString(),
          sent_by: null
        }
      ]
    });
    const res = await respondToInvite(sb, token, 'accept', { loadCatalog });
    expect([minted.error, res.ok, await teaching()]).toEqual([null, true, 1]);
  }, 60_000);
});

/** qa-lead B10b follow-ups. */
describe('B10b qa: what a closed page shows', () => {
  /** Everything the page hands to the client (the RSC payload carries a client component's props, rendered or not). */
  const html = async (token: string) => {
    const { default: TeachPage } = await import('../src/app/(public)/i/teach/[token]/page');
    const tree = await TeachPage({ params: Promise.resolve({ token }), searchParams: Promise.resolve({}) });
    return JSON.stringify(tree, (k, v) => (k === '_owner' || k === '_store' ? undefined : v));
  };
  const leaks = (out: string) => [out.includes(`${TEST_PREFIX} B10b Teacher`), /\d+ scouts? \(/.test(out), out.includes('no scouts yet')];

  it('TeachPage_Expired_LeaksNoNames', async () => {
    const token = await sendTeach([keys[0]]);
    await sb.from('meeting_invite_pages').update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('calendar_entry_id', meeting);
    expect(leaks(await html(token))).toEqual([false, false, false]);
  }, 60_000);

  it('TeachPage_Superseded_LeaksNoNames', async () => {
    const first = await sendTeach([keys[0]]);
    await sendTeach([keys[1]]);
    expect(leaks(await html(first))).toEqual([false, false, false]);
  }, 60_000);

  it('TeachPage_Open_ShowsTheTeacher', async () => {
    const token = await sendTeach([keys[0]]);
    expect(leaks(await html(token))[0]).toBe(true);
  }, 60_000);
});

describe('B10b qa: answers', () => {
  const teachRow = async (who: number, key: string) =>
    (await sb.from('meeting_topic_teachers').select('for_picks, meeting_topics!inner(topic_key)').eq('calendar_entry_id', meeting).eq('person_id', who).eq('meeting_topics.topic_key', key)).data as { for_picks: boolean }[] | null;

  it('TeachPage_Superseded_RefusesSubmit', async () => {
    const first = await sendTeach([keys[0]]);
    const [line] = await lineIds(first);
    await sendTeach([keys[1]]);
    const res = await answerTeachPage(sb, first, [{ inviteId: line, answer: 'yes' }]);
    expect([res.ok ? 'answered' : res.state, await teaching()]).toEqual(['superseded', 0]);
  }, 60_000);

  it('TeachPage_NoToYes_SignsUp', async () => {
    const token = await sendTeach([keys[0]]);
    const [line] = await lineIds(token);
    await answerTeachPage(sb, token, [{ inviteId: line, answer: 'no' }]);
    await answerTeachPage(sb, token, [{ inviteId: line, answer: 'yes' }]);
    const { data } = await sb.from('meeting_invites').select('response').eq('id', line).single();
    expect([await teaching(), data?.response]).toEqual([1, 'accepted']);
  }, 60_000);

  it('TeachPage_RepeatYes_IsIdempotent', async () => {
    const token = await sendTeach([keys[0]]);
    const [line] = await lineIds(token);
    await answerTeachPage(sb, token, [{ inviteId: line, answer: 'yes' }]);
    const again = await answerTeachPage(sb, token, [{ inviteId: line, answer: 'yes' }]);
    expect([again.ok && again.lines[0]?.result, await teaching()]).toEqual(['unchanged', 1]);
  }, 60_000);

  // B10b follow-up: a Yes on a line already 'accepted' still signs the teacher up, so one released elsewhere (the
  // planner's unteach, the board's "I can't teach this") is back after they say Yes again.
  it('TeachPage_YesAgain_AfterRelease_SignsBackUp', async () => {
    const token = await sendTeach([keys[0]]);
    const [line] = await lineIds(token);
    await answerTeachPage(sb, token, [{ inviteId: line, answer: 'yes' }]);
    const u = await sb.rpc('meeting_unteach_topic', { p_entry: meeting, p_person: teacher, p_actor: teacher, p_leader: true, p_topic_key: keys[0] });
    if (u.error) throw new Error(u.error.message);
    await answerTeachPage(sb, token, [{ inviteId: line, answer: 'yes' }]);
    expect(await teaching()).toBe(1);
  }, 60_000);

  it('TeachPage_YesAgain_StillTeaching_KeepsOneRow', async () => {
    const token = await sendTeach([keys[0]]);
    const [line] = await lineIds(token);
    await answerTeachPage(sb, token, [{ inviteId: line, answer: 'yes' }]);
    await answerTeachPage(sb, token, [{ inviteId: line, answer: 'yes' }]);
    await answerTeachPage(sb, token, [{ inviteId: line, answer: 'yes' }]);
    expect(await teaching()).toBe(1);
  }, 60_000);

  it('TeachPage_YesToNo_LeavesOtherTeachersAlone', async () => {
    const t = await sb.rpc('meeting_teach_topic', { p_entries: [meeting], p_person: other, p_actor: other, p_leader: false, p_topic_key: keys[0], p_title: null, p_note: null });
    if (t.error) throw new Error(t.error.message);
    const token = await sendTeach([keys[0]]);
    const [line] = await lineIds(token);
    await answerTeachPage(sb, token, [{ inviteId: line, answer: 'yes' }]);
    await answerTeachPage(sb, token, [{ inviteId: line, answer: 'no' }]);
    expect([await teaching(), await teaching(other)]).toEqual([0, 1]);
  }, 60_000);

  // D-424: the planner's Assign marks a sign-up for_picks. A Yes leaves it as it is; a Yes -> No removes it (accepted).
  const assigned = async () => {
    const t = await sb.rpc('meeting_teach_topic', { p_entries: [meeting], p_person: teacher, p_actor: teacher, p_leader: true, p_topic_key: keys[0], p_title: null, p_note: null });
    if (t.error) throw new Error(t.error.message);
    await sb.from('meeting_topic_teachers').update({ for_picks: true }).eq('calendar_entry_id', meeting).eq('person_id', teacher);
  };

  it('TeachPage_Yes_KeepsAnAssignedRowForPicks', async () => {
    await assigned();
    const token = await sendTeach([keys[0]]);
    const [line] = await lineIds(token);
    await answerTeachPage(sb, token, [{ inviteId: line, answer: 'yes' }]);
    expect(await teachRow(teacher, keys[0])).toEqual([{ for_picks: true, meeting_topics: { topic_key: keys[0] } }]);
  }, 60_000);

  it('TeachPage_YesToNo_RemovesAnAssignedRow', async () => {
    await assigned();
    const token = await sendTeach([keys[0]]);
    const [line] = await lineIds(token);
    await answerTeachPage(sb, token, [{ inviteId: line, answer: 'yes' }]);
    await answerTeachPage(sb, token, [{ inviteId: line, answer: 'no' }]);
    expect(await teachRow(teacher, keys[0])).toEqual([]);
  }, 60_000);
});

describe('B10b qa: a re-invite for the same class', () => {
  /** A second ask for the same class after the 24-hour dedupe window. */
  const reask = async () => {
    await sb.from('meeting_invites').update({ sent_at: new Date(Date.now() - 25 * 3600_000).toISOString() }).eq('calendar_entry_id', meeting);
    return sendTeach([keys[0]]);
  };

  it('Supersede_SameKey_OneLinePerKey', async () => {
    await sendTeach([keys[0], keys[1]]);
    const second = await reask();
    const { data } = await sb.from('meeting_invites').select('topic_key').eq('page_id', (await pageOf(second))!.id);
    expect((data ?? []).map((r) => r.topic_key).sort()).toEqual([keys[0], keys[1]].sort());
  }, 60_000);

  it('Supersede_SameKey_CarriesTheAnswer_SoNoReleases', async () => {
    const first = await sendTeach([keys[0]]);
    const [old] = await lineIds(first);
    await answerTeachPage(sb, first, [{ inviteId: old, answer: 'yes' }]);
    const second = await reask();
    const view = await inspectTeachPage(sb, second);
    const line = view.page!.lines[0];
    await answerTeachPage(sb, second, [{ inviteId: line.inviteId, answer: 'no' }]);
    expect([view.page?.lines.length, line.answer, await teaching()]).toEqual([1, 'yes', 0]);
  }, 60_000);
});

describe('Emails E2: a Not this week note', () => {
  it('Teacher_NotThisWeek_SavesTheNote', async () => {
    const token = await sendTeach([keys[0]]);
    const [line] = await lineIds(token);
    const res = await answerTeachPage(sb, token, [{ inviteId: line, answer: 'no' }]);
    await saveDeclineNotes(sb, res.ok ? res.pageId : 0, [{ inviteId: line, note: 'December works' }]);
    expect((await inspectTeachPage(sb, token)).page?.lines[0].note).toBe('December works');
  });

  it('DeclineNote_CannotLandOnAnotherPagesInvite', async () => {
    const mine = await sendTeach([keys[0]]);
    const theirs = await sendTeach([keys[1]], other);
    const [theirLine] = await lineIds(theirs);
    await answerTeachPage(sb, theirs, [{ inviteId: theirLine, answer: 'no' }]);
    const minePage = await pageOf(mine);
    await saveDeclineNotes(sb, minePage!.id, [{ inviteId: theirLine, note: 'not mine to write' }]);
    expect((await inspectTeachPage(sb, theirs)).page?.lines[0].note).toBeNull();
  });

  it('DeclineNote_ClearsWhenTheAnswerTurnsYes', async () => {
    const token = await sendTeach([keys[0]]);
    const [line] = await lineIds(token);
    const no = await answerTeachPage(sb, token, [{ inviteId: line, answer: 'no' }]);
    await saveDeclineNotes(sb, no.ok ? no.pageId : 0, [{ inviteId: line, note: 'Maybe later' }]);
    const yes = await answerTeachPage(sb, token, [{ inviteId: line, answer: 'yes' }]);
    await saveDeclineNotes(sb, yes.ok ? yes.pageId : 0, []);
    const { data } = await sb.from('meeting_invites').select('decline_note').eq('id', line).single();
    expect((data as { decline_note: string | null }).decline_note).toBeNull();
  });
});
