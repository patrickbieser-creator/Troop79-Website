/**
 * Shared site footer mirroring the prototype shell.
 */
import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer
      style={{
        background: 'var(--navy)',
        color: 'rgba(255,255,255,.85)',
        marginTop: 64,
        padding: '48px 0 24px'
      }}
    >
      <div
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          padding: '0 24px'
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.4fr) repeat(2, minmax(0, 1fr))',
            gap: 40,
            marginBottom: 32
          }}
        >
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/troop-79-logo.png"
              alt="Scout Troop 79"
              style={{
                height: 56,
                width: 'auto',
                marginBottom: 12,
                filter: 'brightness(0) invert(1)',
                opacity: 0.9
              }}
            />
            <p
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                lineHeight: 1.6,
                color: 'rgba(255,255,255,.7)'
              }}
            >
              Scout Troop 79 is a family troop serving scouts and families in
              Milwaukee, Wisconsin. We are chartered through Scouts America and
              welcome boys and girls of all backgrounds.
            </p>
          </div>
          <FooterCol title="Navigate">
            <FooterLink href="/">Home &amp; News</FooterLink>
            <FooterLink href="/events">Calendar</FooterLink>
            <FooterLink href="/advancement">Advancement Tracker</FooterLink>
            <FooterLink href="/merit-badges">Merit Badges</FooterLink>
            <FooterLink href="/meeting-plan">This Week&rsquo;s Meeting</FooterLink>
          </FooterCol>
          <FooterCol title="Contact">
            <FooterLink href="#">Scoutmaster Mindy Stollenwerk</FooterLink>
            <FooterLink href="#">Committee Chair</FooterLink>
            <FooterLink href="#">New Member Inquiry</FooterLink>
            <FooterLink href="/admin">Members Login</FooterLink>
          </FooterCol>
        </div>
        <div
          style={{
            borderTop: '1px solid rgba(255,255,255,.15)',
            paddingTop: 20,
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            fontFamily: 'var(--font-ui)',
            fontSize: 11,
            color: 'rgba(255,255,255,.55)',
            letterSpacing: '.04em'
          }}
        >
          <p>
            &copy; {new Date().getFullYear()} Scout Troop 79 &nbsp;&middot;&nbsp;
            Milwaukee, Wisconsin &nbsp;&middot;&nbsp; Scouts America
          </p>
          <p>
            <Link href="#">Privacy</Link> &nbsp;&middot;&nbsp;{' '}
            <Link href="#">Accessibility</Link> &nbsp;&middot;&nbsp;{' '}
            <Link href="#">Sitemap</Link>
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,.5)',
          marginBottom: 12
        }}
      >
        {title}
      </h4>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{children}</ul>
    </div>
  );
}

function FooterLink({
  href,
  children
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <li style={{ marginBottom: 8 }}>
      <Link
        href={href}
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 13,
          color: 'rgba(255,255,255,.85)'
        }}
      >
        {children}
      </Link>
    </li>
  );
}
