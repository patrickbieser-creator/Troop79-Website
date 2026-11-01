import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { EmailScreen, ScreenRow } from '../src/lib/meeting-email-screen';

/** The Emails screen (Patrick, 2026-11-01: "I click different names and the preview doesn't switch"): clicking a name
 *  shows THAT person's email on the right, on every tab. */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../src/app/(public)/planner/emails/actions', () => ({ emailsQueueAction: vi.fn(), emailsSendNextAction: vi.fn(), emailsRequeueAction: vi.fn() }));
const { EmailsClient } = await import('../src/app/(public)/planner/emails/emails-client');

afterEach(cleanup);
const teacher = (personId: number, name: string, group: string): ScreenRow => ({
  id: `teacher:${group}:${personId}`,
  kind: 'teacher',
  personId,
  name,
  rank: null,
  isScout: false,
  about: `Planned to teach ${group}`,
  group,
  recipients: [{ personId, name, email: `${personId}@example.com`, isScout: false }],
  blocked: null,
  state: 'new',
  sentAt: null,
  openedAt: null,
  delivery: null,
  failure: null,
  answer: null,
  changed: false,
  planned: true
});
const T = { subject: 'Troop meeting on [day]', body: 'Hi [name].' };
const data: EmailScreen = {
  entryId: 9,
  focus: 'First aid',
  scouts: [],
  teachers: [teacher(80, 'Mindy S', 'fr:scout'), teacher(2, 'Dan B', 'fr:scout~2')],
  reminders: [],
  log: [],
  unfinished: [],
  plans: {},
  templates: { plan: T, reminder: T, teacher: T, teacherPlanned: { subject: 'Can you teach?', body: 'Planned for you, [name].' } },
  firstNames: { 80: 'Mindy', 2: 'Dan' },
  groupWords: {
    'fr:scout': { title: 'Scout Group 1', codes: '1a', minutes: '', scouts: ['Eloise Lowery'], teacherIds: [80] },
    'fr:scout~2': { title: 'Scout Group 2', codes: '5', minutes: '', scouts: ['Aubrey Reinelt'], teacherIds: [2] }
  },
  cap: 150
};

describe('the preview follows the name clicked', () => {
  it('ClickingDan_ShowsDansEmail', () => {
    render(<EmailsClient screen={data} day="Sunday, Nov 1" />);
    fireEvent.click(screen.getByRole('tab', { name: /Teachers/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mindy S' }));
    const first = screen.getByLabelText('Email preview').textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Dan B' }));
    const second = screen.getByLabelText('Email preview').textContent;
    expect([first?.includes('Scout Group 1'), second?.includes('Scout Group 2'), second?.includes('Dan.')]).toEqual([true, true, true]);
  });

  it('APlannedTeacher_GetsThePlannedWording_AndTheirNameEvenWithNobodyTicked', () => {
    render(<EmailsClient screen={data} day="Sunday, Nov 1" />);
    fireEvent.click(screen.getByRole('tab', { name: /Teachers/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mindy S' }));
    // Nobody ticked in the preview's To: the greeting still names her.
    fireEvent.click(screen.getByRole('checkbox', { name: /Mindy Stollenwerk|Mindy S/, checked: true }));
    const text = screen.getByLabelText('Email preview').textContent ?? '';
    expect([text.includes('Planned for you, Mindy.'), text.includes('Answer yes or no')]).toEqual([true, true]);
  });
});

