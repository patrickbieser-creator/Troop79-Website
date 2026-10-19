import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import type { SessionStatus } from '../src/app/api/session-status/route';

/**
 * The account control at the right end of the public nav (2026-10-19): one
 * place to sign in, see who you are, reach your page or Admin, and sign out.
 * It replaced the nav's Members tab, the utility bar's "Signed in as", and
 * /member's own Sign Out button.
 */

const mocks = vi.hoisted(() => ({
  pathname: '/',
  search: '',
  status: null as SessionStatus | null
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.search)
}));
// The real action is 'use server' and needs next/headers; only the wiring is observable here.
vi.mock('../src/app/_components/site-nav-actions', () => ({ logOutEverywhereAction: vi.fn() }));

import { AccountControl } from '../src/app/_components/account-control';
import { accountInitials, accountShortName, currentPath, signInHref } from '../src/app/_components/account-control-format';
import { NavLinks } from '../src/app/_components/nav-links';

const SIGNED_OUT: SessionStatus = {
  loggedIn: false,
  level: null,
  label: null,
  canViewProfile: false,
  isVerifiedMember: false,
  canAdmin: false
};

function signedIn(over: Partial<SessionStatus> = {}): SessionStatus {
  return {
    loggedIn: true,
    level: 'Family',
    label: 'Patrick Bieser',
    canViewProfile: true,
    isVerifiedMember: true,
    canAdmin: false,
    ...over
  };
}

beforeEach(() => {
  mocks.pathname = '/';
  mocks.search = '';
  mocks.status = SIGNED_OUT;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => mocks.status }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openMenuFor(status: SessionStatus) {
  mocks.status = status;
  render(<AccountControl />);
  const button = await screen.findByRole('button', { name: status.label ?? '' });
  return button;
}

describe('AccountControl — signed out', () => {
  it('SignedOut_SeesSignIn_WithNextSetToTheCurrentPathAndQuery', async () => {
    mocks.pathname = '/events';
    mocks.search = 'month=2026-10';
    render(<AccountControl />);
    const link = await screen.findByRole('link', { name: 'Sign in' });
    expect(link.getAttribute('href')).toBe('/signin?next=%2Fevents%3Fmonth%3D2026-10');
  });

  it('SignedOut_OnHome_SignInCarriesNoNext', async () => {
    render(<AccountControl />);
    const link = await screen.findByRole('link', { name: 'Sign in' });
    expect(link.getAttribute('href')).toBe('/signin');
  });

  it('BeforeTheStatusArrives_ShowsSignIn', () => {
    // The fetch never resolves — the signed-out state is the placeholder.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    mocks.pathname = '/news';
    render(<AccountControl />);
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/signin?next=%2Fnews');
  });

  it.each(['/signin', '/signin/verify', '/signin/hint'])('SignInRoutes_HideTheControl_On %s', async (path) => {
    mocks.pathname = path;
    const { container } = render(<AccountControl />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.querySelector('a, button')).toBeNull();
  });
});

describe('AccountControl — signed in', () => {
  it('SignedIn_ShowsFirstNameAndLastInitial_AsADisclosureButton', async () => {
    const button = await openMenuFor(signedIn());
    expect(button.textContent).toContain('Patrick B');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });

  it('SignedIn_ShowsInitials_ForThePhoneCircle', async () => {
    const button = await openMenuFor(signedIn());
    expect(button.textContent).toContain('PB');
  });

  it('Clicking_OpensTheMenu_WithMyPageAndSignOut', async () => {
    const button = await openMenuFor(signedIn());
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeNull();
    expect(screen.getByRole('link', { name: 'My page' }).getAttribute('href')).toBe('/member');
    const signOut = screen.getByRole('button', { name: 'Sign out' });
    expect(signOut.closest('form')).not.toBeNull();
  });

  it('Menu_IsADisclosure_NotAnAriaMenu', async () => {
    const button = await openMenuFor(signedIn());
    fireEvent.click(button);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Escape_ClosesTheMenu_AndReturnsFocusToTheButton', async () => {
    const button = await openMenuFor(signedIn());
    fireEvent.click(button);
    const myPage = screen.getByRole('link', { name: 'My page' });
    myPage.focus();
    fireEvent.keyDown(myPage, { key: 'Escape' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('ClickingOutside_ClosesTheMenu', async () => {
    const button = await openMenuFor(signedIn());
    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('TabbingOut_ClosesTheMenu', async () => {
    const button = await openMenuFor(signedIn());
    fireEvent.click(button);
    const outside = document.createElement('a');
    outside.href = '#';
    document.body.appendChild(outside);
    fireEvent.blur(screen.getByRole('button', { name: 'Sign out' }), { relatedTarget: outside });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    outside.remove();
  });

  it('FocusMovingWithinTheMenu_KeepsItOpen', async () => {
    const button = await openMenuFor(signedIn());
    fireEvent.click(button);
    fireEvent.blur(button, { relatedTarget: screen.getByRole('link', { name: 'My page' }) });
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('Admin_AppearsOnlyWhenCanAdmin', async () => {
    const button = await openMenuFor(signedIn({ canAdmin: true }));
    fireEvent.click(button);
    expect(screen.getByRole('link', { name: 'Admin' }).getAttribute('href')).toBe('/admin');
  });

  it('Admin_IsAbsentWithoutCanAdmin', async () => {
    const button = await openMenuFor(signedIn({ canAdmin: false }));
    fireEvent.click(button);
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
  });

  it('SignOut_PostsTheCurrentPathAsNext', async () => {
    mocks.pathname = '/news';
    mocks.search = 'tag=campouts';
    const button = await openMenuFor(signedIn());
    fireEvent.click(button);
    const form = screen.getByRole('button', { name: 'Sign out' }).closest('form')!;
    const next = form.querySelector('input[name="next"]') as HTMLInputElement;
    expect(next.value).toBe('/news?tag=campouts');
  });

  it('SignOut_ShowsSignInStraightAway', async () => {
    const button = await openMenuFor(signedIn());
    fireEvent.click(button);
    const form = screen.getByRole('button', { name: 'Sign out' }).closest('form')!;
    // Submitting would run the action; the control must not wait for the next poll to stop naming you.
    fireEvent.submit(form);
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeTruthy();
  });
});

describe('account control — formatting', () => {
  it.each([
    ['Patrick Bieser', 'Patrick B'],
    ['Patrick B.', 'Patrick B'],
    ['Mary Ann Smith', 'Mary S'],
    ['Cher', 'Cher'],
    ['  Jack   Porter ', 'Jack P']
  ])('ShortName_%s_Is_%s', (label, expected) => {
    expect(accountShortName(label)).toBe(expected);
  });

  it.each([
    ['Patrick Bieser', 'PB'],
    ['Patrick B.', 'PB'],
    ['Cher', 'C'],
    ['jack porter', 'JP']
  ])('Initials_%s_Are_%s', (label, expected) => {
    expect(accountInitials(label)).toBe(expected);
  });

  it.each(['//evil.example', '/\\evil.example'])('SignInHref_RejectsTheOffSitePath_%s', (path) => {
    expect(signInHref(path, '')).toBe('/signin');
  });

  it.each(['/\\evil.example', '//evil.example'])('CurrentPath_FallsBackHome_For_%s', (path) => {
    expect(currentPath(path, '')).toBe('/');
  });

  it.each(['/%2F%2Fevil.example', '/%5Cevil.example'])('EncodedSlashes_StayAnOnSitePath_%s', (path) => {
    // Percent-encoded slashes are path characters, not a host: the value is kept as-is and stays on this site.
    expect(currentPath(path, '')).toBe(path);
    expect(signInHref(path, '')).toBe(`/signin?next=${encodeURIComponent(path)}`);
    expect(new URL(currentPath(path, ''), 'https://www.troop-79.com').host).toBe('www.troop-79.com');
  });
});

describe('NavLinks', () => {
  it('MembersTab_IsGone', () => {
    render(<NavLinks />);
    expect(screen.queryByRole('link', { name: 'Members' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy();
  });
});
