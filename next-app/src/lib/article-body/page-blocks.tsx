import Link from 'next/link';
import { parseCtaToken, parseStatsToken } from './tokens';
import styles from './page-body.module.css';

/**
 * The two page blocks (`{{cta: …}}`, `{{stats: …}}`) — dispatched from ArticleBody's ArticleBlockDiv beside
 * gallery/gallerylink/video. No 'use client': like ArticleBody they render as Server Components on the public
 * page and inside the editor's live preview.
 */

function CtaButton({ href, label, className }: { href: string; label: string; className: string }) {
  // A site path is ordinary navigation; mailto stays a plain link; anything else leaves the site in a new tab.
  if (href.startsWith('/') && !href.startsWith('//')) {
    return (
      <Link href={href} className={className}>
        {label}
      </Link>
    );
  }
  const external = /^https?:\/\//i.test(href);
  return (
    <a href={href} className={className} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {label}
    </a>
  );
}

export function CtaBlock({ raw }: { raw: string }) {
  const { headline, sub, buttons } = parseCtaToken(raw);
  if (!headline && !sub && buttons.length === 0) return null;
  return (
    <div className={styles.ctaBanner}>
      {headline && <p className={styles.ctaHeadline}>{headline}</p>}
      {sub && <p className={styles.ctaSub}>{sub}</p>}
      {buttons.length > 0 && (
        <div className={styles.ctaButtons}>
          {buttons.map((b, i) => (
            <CtaButton
              key={`${b.label}-${b.href}`}
              href={b.href}
              label={b.label}
              className={i === 0 ? styles.btnPrimary : styles.btnGhost}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function StatsBlock({ raw }: { raw: string }) {
  const stats = parseStatsToken(raw);
  if (stats.length === 0) return null;
  return (
    <div className={styles.statStrip}>
      {stats.map((s) => (
        <div key={`${s.value}-${s.label}`} className={styles.statCell}>
          <div className={styles.statNum}>{s.value}</div>
          <div className={styles.statLabel}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}
