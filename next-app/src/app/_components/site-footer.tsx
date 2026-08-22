/**
 * Shared site footer mirroring the prototype shell. Styles live in
 * site-footer.module.css (Phase B — was fully inline, which silently meant
 * no mobile layout; columns now stack at the 640px canon breakpoint).
 */
import Link from 'next/link';
import s from './site-footer.module.css';

export function SiteFooter() {
  return (
    <footer id="site-footer-root" className={s.footer}>
      <div className={s.inner}>
        <div className={s.grid}>
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/troop-79-logo.png" alt="Scout Troop 79" className={s.logo} />
            <p className={s.about}>
              Scout Troop 79 is a family troop serving scouts and families in
              Milwaukee, Wisconsin. We are chartered through Scouts America and
              welcome boys and girls of all backgrounds.
            </p>
          </div>
          <FooterCol title="Navigate">
            <FooterLink href="/">Home &amp; News</FooterLink>
            <FooterLink href="/events">Calendar</FooterLink>
            <FooterLink href="/photos">Photo Albums</FooterLink>
            <FooterLink href="/advancement">Advancement Tracker</FooterLink>
            {/* /merit-badges retired 2026-08-22 — the Library is the merit
                badge catalog now. This footer renders on every public page, so a
                stale href here would be a dead link site-wide. */}
            <FooterLink href="/library">Merit Badges</FooterLink>
            <FooterLink href="/about">About the Troop</FooterLink>
          </FooterCol>
          <FooterCol title="Contact">
            <FooterLink href="mailto:bsatroop79bg@gmail.com">
              Scoutmaster Mindy Stollenwerk
            </FooterLink>
            <FooterLink href="mailto:bsatroop79bg@gmail.com">
              Committee Chair Jack Kosmoski
            </FooterLink>
            <FooterLink href="/join">New Member Inquiry</FooterLink>
            <FooterLink href="/admin">Members Login</FooterLink>
          </FooterCol>
        </div>
        <div className={s.legal}>
          <p>
            &copy; {new Date().getFullYear()}{' '}Scout Troop 79 &nbsp;&middot;&nbsp;
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
      <h4 className={s.colTitle}>{title}</h4>
      <ul className={s.colList}>{children}</ul>
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
    <li className={s.linkItem}>
      <Link href={href} className={s.link}>
        {children}
      </Link>
    </li>
  );
}
