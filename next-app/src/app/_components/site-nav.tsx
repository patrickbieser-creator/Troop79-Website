/**
 * Shared utility bar + masthead + primary nav for the public site.
 * Mirrors the prototype's `advancement.html` shell so visual continuity is
 * preserved. Nav active-state and the local date are Client islands.
 */
import Link from 'next/link';
import { NavLinks } from './nav-links';
import { UtilityDate } from './utility-date';
import { SignedInAs } from './signed-in-as';
import styles from './site-nav.module.css';

// Deliberately NOT async and does not read cookies()/headers() — this layout
// wraps every public page, and doing either here would bail every one of
// them out of static/ISR generation (caught in build output, 2026-08-06).
//
// Sign in / sign out used to live in the utility bar; both moved to /member,
// the single front door for authentication (Patrick, 2026-08-16). What stays
// is SignedInAs — display only — because "whose information am I looking at"
// is still worth answering at the top of every page. It checks session state
// itself, client-side, via /api/session-status.
export function SiteNav() {
  return (
    <div id="site-nav-root">
      {/* Utility bar */}
      <div className={styles.utilityBar}>
        <div className={styles.utilityInner}>
          <UtilityDate />
          <div className={styles.utilityRight}>
            <SignedInAs />
          </div>
        </div>
      </div>

      {/* Masthead */}
      <header className={styles.masthead}>
        <div className={styles.mastheadInner}>
          <Link href="/" aria-label="Troop 79 Home" className={styles.mastheadLogo}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/troop-79-logo.png"
              alt="Scout Troop 79 — Milwaukee, WI"
              className={styles.mastheadLogoImg}
            />
          </Link>
          <div className={styles.mastheadTitleBlock}>
            <h1 className={styles.mastheadTitle}>
              <Link href="/">Scout Troop 79</Link>
            </h1>
            <p className={styles.mastheadPlace}>
              Milwaukee, Wisconsin &nbsp;·&nbsp; Est. 2022
            </p>
          </div>
          {/* Moved out of the nav strip (Patrick, 2026-08-16) so the nav is
              purely navigation and the recruiting call to action sits with the
              masthead's identity block, left of the tagline. */}
          <Link href="/join" className={styles.mastheadJoin}>
            Join Troop 79
          </Link>
          <div className={styles.mastheadRule} />
          <p className={styles.mastheadTagline}>
            Prepared. Courageous.
            <br />
            Ready for anything.
          </p>
        </div>
      </header>

      {/* Main nav */}
      <nav aria-label="Main navigation" className={styles.mainNav}>
        <div className={styles.navInner}>
          <NavLinks />
        </div>
      </nav>
    </div>
  );
}
