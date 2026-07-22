/**
 * One published resource as a card — used by requirement pages, badge pages,
 * topic shelves, and search results. Server Component.
 *
 * Video/link/document cards LINK OUT (no embedded iframes on a kids' site —
 * same call as the news CMS); post-kind resources render their markdown body
 * inline via ArticleBody.
 */
import { ArticleBody } from '@/lib/article-body/ArticleBody';
import type { PlacedResource } from '@/lib/library-data';
import type { LibraryResource } from '@/lib/supabase/types';
import { detectHost, resourceThumbnail, RESOURCE_KIND_ICON, RESOURCE_KIND_LABEL } from '@/lib/library';
import styles from '../library.module.css';

export interface AlsoOnLink {
  href: string;
  label: string;
}

export function ResourceCard({
  resource,
  pinned = false,
  alsoOn = []
}: {
  resource: LibraryResource | PlacedResource;
  pinned?: boolean;
  alsoOn?: AlsoOnLink[];
}) {
  const host = resource.host ?? detectHost(resource.url) ?? RESOURCE_KIND_LABEL[resource.kind];

  if (resource.kind === 'post') {
    return (
      <li className={`${styles.postCard} ${pinned ? styles.postCardPinned : ''}`}>
        <p className={styles.postDate}>
          {pinned ? '★ ' : ''}
          {new Date(resource.created_at).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
          })}
        </p>
        <h3 className={styles.postTitle}>{resource.title}</h3>
        {resource.body_md && <ArticleBody body={resource.body_md} />}
        {(resource.attribution_label || alsoOn.length > 0) && (
          <div className={styles.resMetaRow}>
            {resource.attribution_label && (
              <span className={styles.resCredit}>{resource.attribution_label}</span>
            )}
            <AlsoOn links={alsoOn} />
          </div>
        )}
      </li>
    );
  }

  // Render-side guard on top of the write-path check: only http(s) URLs
  // become clickable — anything else displays as a plain title.
  const safeUrl = resource.url && /^https?:\/\//i.test(resource.url) ? resource.url : null;
  const title = safeUrl ? (
    <a
      className={styles.resTitleLink}
      href={safeUrl}
      target="_blank"
      rel="noopener noreferrer"
    >
      <h3 className={styles.resTitle}>{resource.title} ↗</h3>
    </a>
  ) : (
    <h3 className={styles.resTitle}>{resource.title}</h3>
  );

  // YouTube (and any explicitly-set) thumbnails replace the kind icon — a
  // static <img>, never an embed (news-CMS no-iframe decision).
  const thumb = resourceThumbnail(resource);

  return (
    <li className={`${styles.resourceCard} ${pinned ? styles.resourceCardPinned : ''}`}>
      {pinned && <span className={styles.pinFlag}>★ Pinned</span>}
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.resThumb} src={thumb} alt="" aria-hidden="true" loading="lazy" />
      ) : (
        <span className={styles.resIcon} aria-hidden="true">
          {RESOURCE_KIND_ICON[resource.kind]}
        </span>
      )}
      <div className={styles.resBody}>
        {title}
        {resource.blurb && <p className={styles.resBlurb}>{resource.blurb}</p>}
        <div className={styles.resMetaRow}>
          <span className={styles.hostChip}>{host}</span>
          {resource.attribution_label && (
            <span className={styles.resCredit}>{resource.attribution_label}</span>
          )}
          <AlsoOn links={alsoOn} />
        </div>
      </div>
    </li>
  );
}

function AlsoOn({ links }: { links: AlsoOnLink[] }) {
  if (links.length === 0) return null;
  return (
    <span className={styles.alsoOn}>
      Also on:{' '}
      {links.map((l, i) => (
        <span key={l.href}>
          {i > 0 && ', '}
          <a href={l.href}>{l.label}</a>
        </span>
      ))}
    </span>
  );
}
