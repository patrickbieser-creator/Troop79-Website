import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { HintedSignInPanel } from '../src/app/(public)/events/[id]/hinted-signin-panel';
import type { SignInHint } from '../src/lib/signin-hint';

/**
 * The Bugle "Register Now" landing panel (Plans/Bugle-Register-Now-Links.md
 * decisions B3–B6, B9). Pure presentational: the page resolves the hint
 * cookie and hands the result in, so this renders without a request context.
 */

const send = vi.fn(async () => {});
const NEXT = '/events/123/signup';

function hint(over: Partial<SignInHint> = {}): SignInHint {
  return {
    role: 'hint',
    candidates: [{ personId: 82, displayName: 'Dana Rivera', subjectKind: 'adult', maskedEmail: 'd•••@example.com' }],
    parents: [],
    iat: Date.now(),
    ...over
  };
}

describe('HintedSignInPanel', () => {
  it('HintedPanel_RendersContinueAs_ForSingleAdult', () => {
    render(<HintedSignInPanel hint={hint()} next={NEXT} sendAction={send} passkey={null} />);
    expect(screen.getByText(/Continue as/)).toBeTruthy();
    expect(screen.getByText('Dana Rivera')).toBeTruthy();
    expect(screen.getByRole('button', { name: /email me a code/i })).toBeTruthy();
  });

  it('HintedPanel_PostsThePersonAndNext_ForSingleAdult', () => {
    render(<HintedSignInPanel hint={hint()} next={NEXT} sendAction={send} passkey={null} />);
    const form = screen.getByRole('button', { name: /email me a code/i }).closest('form') as HTMLFormElement;
    expect((form.querySelector('input[name="personId"]') as HTMLInputElement).value).toBe('82');
    expect((form.querySelector('input[name="next"]') as HTMLInputElement).value).toBe(NEXT);
  });

  it('HintedPanel_RendersNamedChoices_ForSeveralPeople_InTheOrderGiven', () => {
    const h = hint({
      candidates: [
        { personId: 82, displayName: 'Dana Rivera', subjectKind: 'adult', maskedEmail: 'd•••@example.com' },
        { personId: 83, displayName: 'Sam Rivera', subjectKind: 'adult', maskedEmail: 'd•••@example.com' },
        { personId: 90, displayName: 'Kai Rivera', subjectKind: 'scout', maskedEmail: 'd•••@example.com' }
      ]
    });
    render(<HintedSignInPanel hint={h} next={NEXT} sendAction={send} passkey={null} />);
    const buttons = screen.getAllByRole('button', { name: /email .* a code/i });
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Email Dana Rivera a code',
      'Email Sam Rivera a code',
      'Email Kai Rivera a code'
    ]);
    expect(screen.queryByText(/Continue as/)).toBeNull();
  });

  it('HintedPanel_RendersParentHandoff_ForScoutOnly', () => {
    const h = hint({
      candidates: [{ personId: 90, displayName: 'Kai Rivera', subjectKind: 'scout', maskedEmail: 'k•••@example.com' }],
      parents: [
        { personId: 82, displayName: 'Dana Rivera', subjectKind: 'adult', maskedEmail: 'd•••@example.com' },
        { personId: 83, displayName: 'Sam Rivera', subjectKind: 'adult', maskedEmail: 's•••@example.com' }
      ]
    });
    render(<HintedSignInPanel hint={h} next={NEXT} sendAction={send} passkey={null} />);
    // The scout is named so the parent understands why they are being asked,
    // but the only buttons email the ADULTS (D-246).
    expect(screen.getByText(/Kai Rivera/)).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: /email .* a code/i });
    expect(buttons.map((b) => b.textContent)).toEqual(['Email Dana Rivera a code', 'Email Sam Rivera a code']);
    expect(screen.queryByRole('button', { name: /email me a code/i })).toBeNull();
  });

  it('HintedPanel_ExplainsAskALeader_ForScoutOnlyWithNoReachableParent', () => {
    const h = hint({
      candidates: [{ personId: 90, displayName: 'Kai Rivera', subjectKind: 'scout', maskedEmail: 'k•••@example.com' }],
      parents: []
    });
    render(<HintedSignInPanel hint={h} next={NEXT} sendAction={send} passkey={null} />);
    expect(screen.queryAllByRole('button', { name: /a code/i })).toHaveLength(0);
    expect(screen.getByText(/ask a leader/i)).toBeTruthy();
  });

  it('HintedPanel_PlacesThePasskeyControlFirst_WhenProvided', () => {
    render(
      <HintedSignInPanel
        hint={hint()}
        next={NEXT}
        sendAction={send}
        passkey={<button type="button">Use your passkey</button>}
      />
    );
    const panel = screen.getByRole('region', { name: /continue as/i });
    const buttons = within(panel).getAllByRole('button');
    expect(buttons[0].textContent).toBe('Use your passkey');
    expect(buttons[1].textContent).toMatch(/email me a code/i);
  });

  it('HintedPanel_AlwaysOffersNotYou_ToTheOrdinarySignIn', () => {
    render(<HintedSignInPanel hint={hint()} next={NEXT} sendAction={send} passkey={null} />);
    const link = screen.getByRole('link', { name: /not you/i }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(`/signin?next=${encodeURIComponent(NEXT)}`);
  });
});
