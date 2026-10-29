import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TeachPageLine } from '../src/lib/meeting-teach-pages';

/** Build a Plan B10b: the teacher's answer page, as it renders (states, who it's for, the lines). */
vi.mock('../src/app/(public)/i/teach/actions', () => ({ answerTeachPageAction: vi.fn() }));
const { TeachPageCard } = await import('../src/app/(public)/i/teach/[token]/teach-page-card');

const line = (o: Partial<TeachPageLine> = {}): TeachPageLine => ({
  inviteId: 1,
  key: 'tenderfoot-3a',
  code: 'Tenderfoot 3a',
  topic: 'Square Knot use',
  minutes: 20,
  helped: { count: 2, names: ['Finn P', 'Leo K'], more: 0 },
  answer: null,
  note: null,
  available: true,
  ...o
});
const card = (o: Partial<Parameters<typeof TeachPageCard>[0]> = {}) =>
  render(<TeachPageCard state="open" token={'a'.repeat(64)} recipientName="Dan Bieser" day="Sunday, March 14, 2094" lines={[line()]} err={null} saved={false} failed={[]} {...o} />);

describe('the teach page card', () => {
  it('TeachPageCard_SaysWhoItIsFor', () => {
    card();
    expect(screen.getByText(/^For Dan Bieser/).textContent).toBe('For Dan Bieser; if that isn’t you, don’t answer.');
  });

  it('TeachPageCard_ShowsTheSnapshotLine', () => {
    card();
    expect(screen.getByText(/about 20 min/).textContent).toBe('about 20 min · 2 scouts (Finn P, Leo K)');
  });

  it('TeachPageCard_DefaultsToTheCurrentAnswer', () => {
    card({ lines: [line({ answer: 'yes' })] });
    expect((screen.getByRole('radio', { name: 'Yes, I’ll teach it' }) as HTMLInputElement).checked).toBe(true);
  });

  it('TeachPageCard_RemovedLine_ReadsNoLongerAvailable', () => {
    card({ lines: [line({ available: false })] });
    expect(screen.getByText('No longer available')).toBeTruthy();
  });

  it('TeachPageCard_Expired_OffersSignIn', () => {
    card({ state: 'expired' });
    expect(screen.getByRole('link', { name: 'sign in to your Sunday page' }).getAttribute('href')).toBe('/signin?next=%2Fmember%2Fmeeting');
  });
});

/** qa-lead B10b #4 / #5: where focus lands after a submit, and what a failed line announces. */
describe('the teach page card, accessibly', () => {
  it('TeachPageCard_AfterSave_FocusesTheResult', () => {
    card({ saved: true, lines: [line({ answer: 'yes' })] });
    expect([document.activeElement?.getAttribute('role'), document.activeElement?.textContent?.startsWith('Saved. Thank you!')]).toEqual(['status', true]);
  });

  it('TeachPageCard_AfterAFailedLine_FocusesThatLine', () => {
    card({ failed: [1] });
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Yes, I’ll teach it' }));
  });

  it('TeachPageCard_FailedLine_MarksTheGroupAndDescribesWhy', () => {
    card({ failed: [1] });
    const group = screen.getByRole('radiogroup');
    const note = document.getElementById(group.getAttribute('aria-describedby') ?? '');
    expect([group.getAttribute('aria-invalid'), note?.textContent]).toEqual(['true', 'Couldn’t save this one. Please try again.']);
  });

  it('TeachPageCard_OneRadiogroupPerClass_NamedByItsLegend', () => {
    card();
    expect(screen.getAllByRole('radiogroup').map((g) => g.textContent?.startsWith('Ten 3a Square Knot use'))).toEqual([true]);
  });
});

describe('Not this week note (Emails E2)', () => {
  it('Teacher_NotThisWeek_OffersAnOptionalNote', () => {
    card({ lines: [line({ answer: 'no', note: 'Try me in December' })] });
    expect((screen.getByLabelText(/Anything you’d like us to know/) as HTMLTextAreaElement).value).toBe('Try me in December');
  });

  it('Teacher_Yes_ShowsNoNoteBox', () => {
    card({ lines: [line({ answer: 'yes' })] });
    expect(screen.queryByLabelText(/Anything you’d like us to know/)).toBeNull();
  });
});
