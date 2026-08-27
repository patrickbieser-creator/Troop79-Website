'use client';

/**
 * PasskeyOfferGate — mounts the one-time passkey offer on whatever public
 * page a person lands on after a code/link sign-in (lib/passkey-offer.ts).
 *
 * Client-side on purpose: the signal is the identity-free `t79_welcome`
 * cookie, read from document.cookie, so the public layout never touches
 * cookies() and every ISR page stays static.
 *
 * Re-checked on every pathname change, not only on mount (found live
 * 2026-08-27): a server-action redirect() after sign-in is a CLIENT-SIDE
 * navigation, so this gate is already mounted — from /signin/verify, before
 * the cookie existed — when the person lands on the next page. The server decides eligibility
 * (verified adult, no passkey yet) through one action; a scout, a passkey
 * holder, or an unconfigured server all answer "no" and nothing renders.
 */
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { WELCOME_COOKIE } from '@/lib/passkey-offer';
import { passkeyOfferEligibleAction } from '@/app/(public)/signin/actions';
import { PasskeyOffer } from './passkey-offer';
import styles from './passkey-offer.module.css';

function hasWelcomeCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((c) => c.trim().startsWith(`${WELCOME_COOKIE.name}=`));
}

/** The offer is once per sign-in: drop the cookie when it is answered. */
export function clearWelcomeCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${WELCOME_COOKIE.name}=; Max-Age=0; path=/`;
}

export function PasskeyOfferGate() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const [path, setPath] = useState('/');

  useEffect(() => {
    if (show || !hasWelcomeCookie()) return;
    let cancelled = false;
    passkeyOfferEligibleAction().then((eligible) => {
      if (cancelled) return;
      if (eligible) {
        setPath(pathname);
        setShow(true);
      } else {
        clearWelcomeCookie();
      }
    });
    return () => {
      cancelled = true;
    };
    // `show` is read but deliberately not a trigger: once shown, stay shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!show) return null;
  return (
    <div className={styles.gateWrap}>
      <PasskeyOffer next={path} onAnswered={clearWelcomeCookie} />
    </div>
  );
}
