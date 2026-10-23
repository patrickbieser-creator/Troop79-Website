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
