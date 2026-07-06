import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Children, isValidElement, type ComponentPropsWithoutRef } from 'react';
import Image from 'next/image';
import { remarkArticleBlocks } from './remark-article-blocks';
import { parseGalleryToken, parseGalleryLinkToken, parseVideoToken } from './tokens';
import styles from './article-body.module.css';

/**
 * Renders an article's markdown body — native markdown for prose/links/
 * lists/tables/images, plus the three custom {{gallery}}/{{gallerylink}}/
 * {{video}} blocks (see tokens.ts) for content markdown has no construct
 * for. No 'use client' here on purpose: this renders identically as a
 * Server Component on the public article page and inside a Client
 * Component (the editor's live preview pane) — same source, same output.
 */
export function ArticleBody({ body }: { body: string }) {
  return (
    <div className={styles.articleBody}>
      <Markdown
        remarkPlugins={[remarkGfm, remarkArticleBlocks]}
        components={{
          img: FigureImage,
          div: ArticleBlockDiv,
          table: TableWrap,
          p: ParagraphOrFigure
        }}
      >
        {body}
      </Markdown>
    </div>
  );
}

function FigureImage({ src, alt, title }: ComponentPropsWithoutRef<'img'>) {
  if (!src || typeof src !== 'string') return null;
  return (
    <figure className={styles.contentFigure}>
      <div className={styles.figImg}>
        <Image src={src} alt={alt ?? ''} fill sizes="760px" />
      </div>
      {title && <figcaption>{title}</figcaption>}
    </figure>
  );
}

/**
 * A markdown image is inline content — CommonMark always wraps a
 * paragraph-that-is-just-an-image in a `<p>`. FigureImage renders a
 * block-level `<figure>`, and `<figure>`/`<figcaption>`/`<div>` can't
 * legally nest inside a `<p>` (real hydration error, caught via browser
 * verification). When the sole child is our figure, render it unwrapped.
 */
function ParagraphOrFigure({ children }: ComponentPropsWithoutRef<'p'>) {
  const kids = Children.toArray(children);
  const onlyChild = kids.length === 1 ? kids[0] : null;
  if (isValidElement(onlyChild) && onlyChild.type === FigureImage) {
    return <>{children}</>;
  }
  return <p>{children}</p>;
}

function TableWrap({ children }: ComponentPropsWithoutRef<'table'>) {
  return (
    <div className={styles.contentTableWrap}>
      <table>{children}</table>
    </div>
  );
}

type ArticleBlockProps = ComponentPropsWithoutRef<'div'> & {
  'data-block-type'?: string;
  'data-raw'?: string;
};

/**
 * react-markdown's `Components` type only allows real JSX intrinsic tags, so
 * the custom {{...}} blocks are encoded as `<div data-block-type data-raw>`
 * (see remark-article-blocks.ts) rather than a made-up tag name — this
 * override dispatches on that marker and falls through to a plain `<div>`
 * for anything else markdown ever produces.
 */
function ArticleBlockDiv({ 'data-block-type': blockType, 'data-raw': raw, children, ...rest }: ArticleBlockProps) {
  if (!blockType || raw === undefined) return <div {...rest}>{children}</div>;
  switch (blockType) {
    case 'gallery':
      return <GalleryBlock raw={raw} />;
    case 'gallerylink':
      return <GalleryLinkBlock raw={raw} />;
    case 'video':
      return <VideoBlock raw={raw} />;
    default:
      return null;
  }
}

const MAX_GALLERY_TILES = 5;

function GalleryBlock({ raw }: { raw: string }) {
  const images = parseGalleryToken(raw);
  if (images.length === 0) return null;
  const shown = images.slice(0, MAX_GALLERY_TILES);
  const overflow = images.length - shown.length;

  return (
    <div>
      <div className={styles.contentGalleryLabel}>{images.length} photos</div>
      <div className={styles.galleryGrid}>
        {shown.map((img, i) => (
          <div key={i} className={styles.galleryTile}>
            <Image src={img.url} alt={img.alt} fill sizes="240px" />
          </div>
        ))}
        {overflow > 0 && (
          <div className={`${styles.galleryTile} ${styles.galleryMore}`}>+{overflow} more</div>
        )}
      </div>
    </div>
  );
}

function GalleryLinkBlock({ raw }: { raw: string }) {
  const { url, caption, coverUrl, source } = parseGalleryLinkToken(raw);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={styles.galleryLinkCard}>
      <div className={`${styles.glCover} ${coverUrl ? '' : styles.glCoverEmpty}`}>
        {coverUrl ? (
          <Image src={coverUrl} alt="" fill sizes="760px" />
        ) : (
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
          </svg>
        )}
        <span className={styles.glBadge}>{source}</span>
      </div>
      <div className={styles.glBody}>
        {caption && <p className={styles.glCaption}>{caption}</p>}
        <span className={styles.glCta}>
          View Full Album on {source}
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M5 12h13.17l-4.88-4.88a1 1 0 1 1 1.42-1.41l6.59 6.59a1 1 0 0 1 0 1.41l-6.59 6.59a1 1 0 0 1-1.42-1.41L18.17 14H5a1 1 0 0 1 0-2z" />
          </svg>
        </span>
      </div>
    </a>
  );
}

function VideoBlock({ raw }: { raw: string }) {
  const { url, caption, embedUrl } = parseVideoToken(raw);
  if (!url) return null;
  if (embedUrl) {
    return (
      <div className={styles.videoEmbed}>
        <iframe
          className={styles.videoFrame}
          src={embedUrl}
          title={caption ?? 'Embedded video'}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  return (
    <div className={styles.videoEmbed}>
      <a href={url} target="_blank" rel="noopener noreferrer" className={styles.videoFallback}>
        <span className={styles.playBtn} aria-hidden="true" />
        <span className={styles.vLabel}>{caption ?? 'Watch video'}</span>
      </a>
    </div>
  );
}
