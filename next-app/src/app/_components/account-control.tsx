'use client';

/**
 * The account control at the right end of the public nav (2026-10-19,
 * Jenna's design, approved by Patrick). One place to sign in, see who the
 * site thinks you are, reach your page (and Admin, when you may), and sign
 * out. It replaced the nav's Members tab, the utility bar's "Signed in as",
 * and /member's own Sign Out button.
 *
 *   Signed out — a quiet "Sign in" link to /signin?next=<this page>. Never
 *     the navy primary: "Join Troop 79" stays the louder call to action.
 *   Signed in — a disclosure button (aria-expanded / aria-controls, not an
 *     ARIA menu): "Patrick B" on desktop, initials in a 44px circle on a
 *     phone, the full name as its accessible name. It opens My page, Meeting
 *     Planner (only with a planner right), Admin (only when the person may
 *     enter /admin) and Sign out, which stays a <form> POST to
 *     logOutEverywhereAction.
 *
 * Session state comes from /api/session-status after hydration, so the
 * public layout stays static (see site-nav.tsx). Until it arrives the
 * signed-out state shows, inside a min-width box, so nothing shifts.
 *
 * Mounted in the layout, it survives the client-side navigation a sign-in
 * redirect does — useSessionStatus re-checks on every pathname change, and a
 * sign-out on the same page is shown at once (see AccountControlLive).
 */

import { Suspense, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { SessionStatus } from '@/app/api/session-status/route';
import { logOutEverywhereAction } from './site-nav-actions';
import { useSessionStatus } from './use-session-status';
import { accountInitials, accountShortName, currentPath, isSignInRoute, signInHref } from './account-control-format';
import styles from './site-nav.module.css';

export function AccountControl() {
  // useSearchParams() opts a static page out of prerendering up to the
  // nearest Suspense boundary; the fallback is the same signed-out link,
  // built from the pathname alone, so the static HTML already has it.
  return (
    <Suspense fallback={<AccountControlFallback />}>
      <AccountControlLive />
    </Suspense>
  );
}

function AccountControlFallback() {
  const pathname = usePathname();
  if (isSignInRoute(pathname)) return null;
  return <AccountControlView status={null} pathname={pathname} search="" />;
}

function AccountControlLive() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const status = useSessionStatus();
  // Signing out redirects back to this same page, so the pathname does not
  // change and the hook would not re-check until the next poll. Remember the
  // status object we signed out of and stop trusting it; any newer answer
  // from the server is trusted again.
  const [signedOutOf, setSignedOutOf] = useState<SessionStatus | null>(null);
  const shown = signedOutOf != null && signedOutOf === status ? null : status;

  if (isSignInRoute(pathname)) return null;
  return (
    <AccountControlView
      status={shown}
      pathname={pathname}
      search={search}
      onSignOut={() => setSignedOutOf(status)}
    />
  );
}

/** The control itself, state passed in — the styleguide renders it directly. */
export function AccountControlView({
  status,
  pathname,
  search,
  onSignOut,
  signOutAction = logOutEverywhereAction,
  defaultOpen = false
}: {
  status: SessionStatus | null;
  pathname: string;
  search: string;
  onSignOut?: () => void;
  signOutAction?: (formData: FormData) => void | Promise<void>;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: Event) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  if (!status?.loggedIn || !status.label) {
    return (
      <div className={styles.account}>
        <Link href={signInHref(pathname, search)} className={styles.accountSignIn}>
          Sign in
        </Link>
      </div>
    );
  }

  const label = status.label;
  const close = () => setOpen(false);

  return (
    <div
      ref={rootRef}
      className={styles.account}
      onBlur={(e) => {
        // Focus moving out of the control (tabbing past it) closes the menu.
        if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={styles.accountButton}
        aria-label={label}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.accountName} aria-hidden="true">
          {accountShortName(label)}
        </span>
        <span className={styles.accountInitials} aria-hidden="true">
          {accountInitials(label)}
        </span>
      </button>
      <div id={menuId} className={styles.accountPanel} hidden={!open}>
        <ul className={styles.accountList}>
          <li>
            <Link href="/member" className={styles.accountItem} onClick={close}>
              My page
            </Link>
          </li>
          {status.canPlanner ? (
            <li>
              <Link href="/planner" className={styles.accountItem} onClick={close}>
                Meeting Planner
              </Link>
            </li>
          ) : null}
          {status.canAdmin ? (
            <li>
              <Link href="/admin" className={styles.accountItem} onClick={close}>
                Admin
              </Link>
            </li>
          ) : null}
          <li className={styles.accountSignOutRow}>
            <form
              action={signOutAction}
              onSubmit={() => {
                close();
                onSignOut?.();
              }}
            >
              <input type="hidden" name="next" value={currentPath(pathname, search)} />
              <button type="submit" className={styles.accountItem}>
                Sign out
              </button>
            </form>
          </li>
        </ul>
      </div>
    </div>
  );
}
