/**
 * Shared utility bar + masthead + primary nav for the public site.
 * Mirrors the prototype's `advancement.html` shell so visual continuity is
 * preserved. Nav active-state and the local date are Client islands.
 */
import Link from 'next/link';
import { NavLinks } from './nav-links';
import { UtilityDate } from './utility-date';

export function SiteNav() {
  return (
    <>
      {/* Utility bar */}
      <div
        style={{
          background: 'var(--newsprint)',
          borderBottom: '1px solid var(--border-light)',
          padding: '6px 0'
        }}
      >
        <div
          style={{
            maxWidth: 1180,
            margin: '0 auto',
            padding: '0 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <UtilityDate />
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <span
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 11,
                color: 'var(--text-meta)',
                letterSpacing: '.03em'
              }}
            >
              Milwaukee, WI
            </span>
            <Link
              href="/admin"
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--navy)',
                letterSpacing: '.03em',
                border: '1px solid var(--border-mid)',
                padding: '3px 10px',
                borderRadius: 2
              }}
            >
              Members Login
            </Link>
          </div>
        </div>
      </div>

      {/* Masthead */}
      <header
        style={{
          background: 'var(--cream)',
          borderBottom: '2px solid var(--border-mid)',
          padding: '18px 0 14px'
        }}
      >
        <div
          style={{
            maxWidth: 1180,
            margin: '0 auto',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 20
          }}
        >
          <Link href="/" aria-label="Troop 79 Home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/troop-79-logo.png"
              alt="Scout Troop 79 — Milwaukee, WI"
              style={{ height: 72, width: 'auto' }}
            />
          </Link>
          <div style={{ flex: 1 }}>
            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 38,
                fontWeight: 700,
                color: 'var(--navy)',
                letterSpacing: '-.01em',
                lineHeight: 1.1
              }}
            >
              <Link href="/">Scout Troop 79</Link>
            </h1>
            <p
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 12,
                color: 'var(--text-meta)',
                letterSpacing: '.12em',
                textTransform: 'uppercase',
                marginTop: 3
              }}
            >
              Milwaukee, Wisconsin &nbsp;·&nbsp; Est. 2022
            </p>
          </div>
          <div
            style={{
              width: 1,
              height: 52,
              background: 'var(--border-mid)',
              flexShrink: 0
            }}
          />
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontStyle: 'italic',
              fontSize: 13,
              color: 'var(--text-meta)',
              maxWidth: 180,
              lineHeight: 1.5
            }}
          >
            Prepared. Courageous.
            <br />
            Ready for anything.
          </p>
        </div>
      </header>

      {/* Main nav */}
      <nav
        aria-label="Main navigation"
        style={{
          background: 'var(--warm-white)',
          borderBottom: '1px solid var(--border-light)',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          boxShadow: '0 1px 6px rgba(0,0,0,.06)'
        }}
      >
        <div
          style={{
            maxWidth: 1180,
            margin: '0 auto',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap'
          }}
        >
          <NavLinks />
          <Link
            href="/join"
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              background: 'var(--forest)',
              color: '#fff',
              padding: '7px 16px',
              borderRadius: 2,
              margin: '7px 0',
              flexShrink: 0
            }}
          >
            Join Troop 79
          </Link>
        </div>
      </nav>
    </>
  );
}
