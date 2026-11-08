import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import type { LogLine } from '../src/lib/meeting-email-screen';

/** The Sent log (Patrick, 2026-11-01): one compact line per email, the sender's initials beside the time, more about
 *  the recipient on hover, an Answer column, All · Not opened · No answer, and 100 lines a page. */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../src/app/(public)/planner/emails/actions', () => ({ emailsQueueAction: vi.fn(), emailsSendNextAction: vi.fn(), emailsRequeueAction: vi.fn() }));
const { SentLog } = await import('../src/app/(public)/planner/emails/emails-client');

afterEach(cleanup);
const line = (id: number, o: Partial<LogLine> = {}): LogLine => ({
  id,
  kind: 'plan',
  at: '2026-11-01T17:28:00Z',
  to: `p${id}@example.com`,
  toName: `Parent ${id}`,
  toHint: `Parent of Scout ${id} · p${id}@example.com`,
  email: `Scout ${id}’s plan`,
  by: 'Patrick B',
  byInitials: 'PB',
  status: 'sent',
  failure: null,
  sentAt: '2026-11-01T17:28:00Z',
  delivery: 'delivered',
  deliveredAt: '2026-11-01T17:28:30Z',
  openedAt: null,
  answer: 'No answer yet',
  answered: false,
  people: [id],
  ...o
});
const rows = () => screen.getAllByRole('row').slice(1);

describe('SentLog', () => {
  it('ALine_ReadsWhenAndWhoSent_To_Email_Result_Answer', () => {
    render(<SentLog log={[line(1, { openedAt: '2026-11-01T17:40:00Z', answer: 'Coming', answered: true })]} busy={false} onSendAgain={vi.fn()} />);
    expect(within(rows()[0]).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Sun 11:28 am · PB', 'Parent 1', 'Scout 1’s plan', 'Delivered 11:28 am · Opened 11:40 am', 'Coming']);
  });

  it('AYes_IsAGreenPill_NoAnswerStaysPlainText', () => {
    render(<SentLog log={[line(1, { answer: 'Plan looks good ✓', answered: true }), line(2)]} busy={false} onSendAgain={vi.fn()} />);
    const cls = (t: string) => screen.getByText(t).className;
    expect([/tone-ok/.test(cls('Plan looks good ✓')), /tone-/.test(cls('No answer yet'))]).toEqual([true, false]);
  });

  it('MixedAnswers_AreAYellowPill', () => {
    render(<SentLog log={[line(1, { answer: 'Fiona K: Coming · Jameson K: No answer yet', answered: true })]} busy={false} onSendAgain={vi.fn()} />);
    expect(screen.getByText('Fiona K: Coming · Jameson K: No answer yet').className).toMatch(/tone-warn/);
  });

  it('TheRecipient_HasTheRestOnHover', () => {
    render(<SentLog log={[line(1)]} busy={false} onSendAgain={vi.fn()} />);
    expect(screen.getByText('Parent 1').getAttribute('title')).toBe('Parent of Scout 1 · p1@example.com');
  });

  it('TheSender_IsNamedInFull_OnHover', () => {
    render(<SentLog log={[line(1)]} busy={false} onSendAgain={vi.fn()} />);
    expect(screen.getByText('PB').getAttribute('title')).toBe('Sent by Patrick B');
  });

  it('NotOpened_ShowsOnlyTheUnopened', () => {
    render(<SentLog log={[line(1, { openedAt: '2026-11-01T17:40:00Z' }), line(2)]} busy={false} onSendAgain={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Not opened/ }));
    expect(rows().map((r) => within(r).getAllByRole('cell')[1].textContent)).toEqual(['Parent 2']);
  });

  it('NoAnswer_ShowsOnlyThoseWhoHaventAnswered', () => {
    render(<SentLog log={[line(1, { answer: 'Coming', answered: true }), line(2)]} busy={false} onSendAgain={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /No answer/ }));
    expect(rows().map((r) => within(r).getAllByRole('cell')[1].textContent)).toEqual(['Parent 2']);
  });

  it('MoreThan100Lines_ArePaged', () => {
    render(<SentLog log={Array.from({ length: 130 }, (_, i) => line(i + 1))} busy={false} onSendAgain={vi.fn()} />);
    const first = rows().length;
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect([first, rows().length, screen.getByText('101–130 of 130') != null]).toEqual([100, 30, true]);
  });

  it('ABouncedEmail_CanBeSentAgain', () => {
    const again = vi.fn();
    render(<SentLog log={[line(8, { status: 'sent', delivery: 'bounced' })]} busy={false} onSendAgain={again} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send again to Parent 8' }));
    expect(again).toHaveBeenCalledWith([8]);
  });

  it('ADeliveredEmail_HasNoSendAgain', () => {
    render(<SentLog log={[line(9, { status: 'sent', delivery: 'delivered' })]} busy={false} onSendAgain={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Send again/ })).toBeNull();
  });

  it('AFailedEmail_CanBeSentAgain', () => {
    const again = vi.fn();
    render(<SentLog log={[line(7, { status: 'failed', failure: 'mailbox full', delivery: null, deliveredAt: null })]} busy={false} onSendAgain={again} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send again to Parent 7' }));
    expect(again).toHaveBeenCalledWith([7]);
  });
});

// Why it bounced (Patrick, 2026-11-08): the Resend reason on the line, in full on hover.
describe('a bounce with a reason', () => {
  const why = "Permanent · General: smtp; 550 5.7.1 Message rejected: Message lacks SPF/DKIM/DMARC Auth Records (AS9031519)";

  it('Bounced_ShowsWhy', () => {
    render(<SentLog log={[line(1, { delivery: 'bounced', bounceReason: why })]} busy={false} onSendAgain={vi.fn()} />);
    expect(screen.getByText(/Failed · bounced: .*lacks SPF\/DKIM\/DMARC/)).toBeTruthy();
  });

  it('Bounced_FullReasonOnHover', () => {
    render(<SentLog log={[line(1, { delivery: 'bounced', bounceReason: why })]} busy={false} onSendAgain={vi.fn()} />);
    expect(screen.getByTitle(why)).toBeTruthy();
  });

  it('Bounced_WithoutAReason_ReadsAsBefore', () => {
    render(<SentLog log={[line(1, { delivery: 'bounced' })]} busy={false} onSendAgain={vi.fn()} />);
    expect(screen.getByText('Failed · address bounced')).toBeTruthy();
  });
});
