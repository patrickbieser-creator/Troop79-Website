import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EmailScreen, ScreenRow } from '../src/lib/meeting-email-screen';

/** Emails E3 (prototypes/meeting-plan-III/Emails.dc.html): nothing ticked, emails counted not rows, blocked rows,
 *  the confirmation, and How this works. The actions are mocked; nothing is sent. */
const queue = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../src/app/(public)/planner/emails/actions', () => ({ emailsQueueAction: queue, emailsSendNextAction: vi.fn(async () => ({ ok: true, done: true })), emailsRequeueAction: vi.fn() }));
const { EmailsClient } = await import('../src/app/(public)/planner/emails/emails-client');

const laura = { personId: 50, name: 'Laura P', email: 'laura@example.com', isScout: false };
const row = (o: Partial<ScreenRow>): ScreenRow => ({
  id: 'plan:1',
  kind: 'plan',
  personId: 1,
  name: 'Lily P',
  rank: 'tenderfoot',
  isScout: true,
  about: 'Second Class group · 6a, 6c',
  group: 'fr:second-class',
  recipients: [laura],
  blocked: null,
  state: 'new',
  sentAt: null,
  openedAt: null,
  delivery: null,
  failure: null,
  answer: null,
  changed: false,
  ...o
});
const T = { subject: 'Troop meeting on [day]', body: 'Hi [name].' };
const data = (scouts: ScreenRow[]): EmailScreen => ({
  entryId: 9,
  focus: 'First aid',
  scouts,
  teachers: [],
  reminders: [],
  log: [],
  unfinished: [],
  plans: {},
  templates: { plan: T, reminder: T, teacher: T },
  firstNames: { 50: 'Laura' },
  groupWords: {},
  cap: 150
});
const siblings = [row({}), row({ id: 'plan:2', personId: 2, name: 'Simon P' })];

afterEach(() => cleanup());

describe('Emails screen', () => {
  it('Leader_NothingTickedByDefault', () => {
    render(<EmailsClient screen={data(siblings)} day="Sunday, Nov 1" backHref="/planner" />);
    expect(screen.getAllByRole('checkbox', { name: /Include the email/ }).some((c) => (c as HTMLInputElement).checked)).toBe(false);
  });

  it('Selection_CountsEmailsNotRows', async () => {
    render(<EmailsClient screen={data(siblings)} day="Sunday, Nov 1" backHref="/planner" />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Select all not sent yet' }));
    expect(screen.getByRole('button', { name: /Review and send/ }).textContent).toBe('Review and send 1 email');
  });

  it('BlockedRow_CannotBeTicked', () => {
    render(<EmailsClient screen={data([row({ blocked: 'no parent email on file', recipients: [] })])} day="Sunday, Nov 1" backHref="/planner" />);
    expect((screen.getByRole('checkbox', { name: 'Include the email about Lily P' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('Confirm_ListsEveryRecipient_AndTheCap', async () => {
    render(<EmailsClient screen={data(siblings)} day="Sunday, Nov 1" backHref="/planner" />);
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Select all not sent yet' }));
    await u.click(screen.getByRole('button', { name: /Review and send/ }));
    const c = within(screen.getByRole('region', { name: 'Send 1 email to these people?' }));
    expect([c.getByText(/1 of a 150-email limit/), c.getByText(/Laura P/).textContent]).toEqual([expect.anything(), 'Laura P (Lily P and Simon P)']);
  });

  it('Send_QueuesWhatTheConfirmationListed', async () => {
    queue.mockResolvedValue({ ok: true, batchId: '00000000-0000-4000-8000-000000000001', queued: 1, overflow: 0, refused: [] });
    render(<EmailsClient screen={data(siblings)} day="Sunday, Nov 1" backHref="/planner" />);
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Select all not sent yet' }));
    await u.click(screen.getByRole('button', { name: /Review and send/ }));
    await u.click(screen.getByRole('button', { name: 'Send 1 now' }));
    expect(queue.mock.calls[0][0].emails).toEqual([{ kind: 'plan', recipientId: 50, scoutIds: [1, 2], override: null }]);
  });

  it('HowThisWorks_NamesTheEnforcedLimits', () => {
    render(<EmailsClient screen={data(siblings)} day="Sunday, Nov 1" backHref="/planner" />);
    expect(screen.getByText(/at most 150 emails/)).toBeTruthy();
  });

  it('Preview_UntickedParent_IsLeftOut', async () => {
    render(<EmailsClient screen={data([row({ recipients: [laura, { personId: 51, name: 'Tom P', email: 'tom@example.com', isScout: false }] })])} day="Sunday, Nov 1" backHref="/planner" />);
    const u = userEvent.setup();
    await u.click(screen.getByRole('checkbox', { name: 'Include the email about Lily P' }));
    await u.click(screen.getByRole('button', { name: 'Lily P' }));
    await u.click(within(screen.getByRole('complementary', { name: 'Email preview' })).getByRole('checkbox', { name: /Tom P/ }));
    expect(screen.getByRole('button', { name: /Review and send/ }).textContent).toBe('Review and send 1 email');
  });
});
