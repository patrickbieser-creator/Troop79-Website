import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArticleBody } from '../src/lib/article-body/ArticleBody';

/**
 * The shared markdown renderer behind /news/[slug], /events/[id] and the
 * editor's live preview. First coverage it has ever had (2026-09-21,
 * Plans/Article-Image-Flexibility.md) — prompted by the rummage-sale flyer,
 * which the body figure was cropping to a 16:9.5 letterbox while the hero
 * above it showed the whole poster.
 */
const CDN = 'https://troop79.b-cdn.net/rummage-sale-flyer-2026.png';

describe('ArticleBody — a single markdown image', () => {
  it('Reader_SeesPlainImg_WhenBodyHasAnImage', () => {
    render(<ArticleBody body={`![Rummage Sale Flyer](${CDN} "Sat 9–3, church lot")`} />);
    const img = screen.getByRole('img', { name: 'Rummage Sale Flyer' });
    // Width-fixed, HEIGHT FREE — the hero's rule (article-detail.module.css,
    // 2026-08-14). A plain <img> at its own proportions, not next/image's
    // `fill` box, which needs a fixed aspect ratio to size against and
    // therefore crops a portrait poster.
    expect(img.getAttribute('src')).toBe(CDN);
    expect(img.hasAttribute('data-nimg')).toBe(false);
    expect(img.closest('figure')).not.toBeNull();
    expect(screen.getByText('Sat 9–3, church lot').tagName).toBe('FIGCAPTION');
  });

  it('Reader_SeesNoParagraphWrapper_WhenImageIsAlone', () => {
    const { container } = render(<ArticleBody body={`Intro.\n\n![Flyer](${CDN})\n\nOutro.`} />);
    // CommonMark wraps an image-only paragraph in <p>; a <figure> inside <p>
    // is invalid nesting and a real hydration error (found 2026-07-06).
    expect(container.querySelector('p figure')).toBeNull();
    expect(container.querySelectorAll('figure')).toHaveLength(1);
  });
});

/**
 * A linked image is native markdown — `[![alt](src "caption")](href)` — and
 * react-markdown emits <p><a><img/></a></p> for it. With the figure override
 * that would nest <a><figure> inside <p>: invalid, a hydration error. Three
 * link kinds (Plans/Article-Image-Flexibility.md, Jenna 2026-09-21): the
 * image's own file ("full size", new tab), an internal path (same tab), or
 * anything else (new tab + noopener). Hover does not exist on the troop's
 * phones, so the caption is the link text; with no caption a small label is
 * rendered so the click target is never invisible.
 */
describe('ArticleBody — a linked image', () => {
  it('Reader_SeesNoParagraphWrapper_WhenLinkedImageIsAlone', () => {
    const { container } = render(<ArticleBody body={`[![Flyer](${CDN})](${CDN})`} />);
    expect(container.querySelector('p figure')).toBeNull();
    expect(container.querySelector('p a')).toBeNull();
    expect(container.querySelectorAll('figure')).toHaveLength(1);
  });

  it('Reader_SeesImageInsideLink_WhenMarkdownLinksIt', () => {
    render(<ArticleBody body={`[![Flyer](${CDN})](https://example.org/sale)`} />);
    const img = screen.getByRole('img', { name: 'Flyer' });
    expect(img.closest('a')?.getAttribute('href')).toBe('https://example.org/sale');
  });

  it('Reader_OpensNewTab_WhenHrefEqualsSrc', () => {
    render(<ArticleBody body={`[![Flyer](${CDN})](${CDN})`} />);
    const link = screen.getByRole('img', { name: 'Flyer' }).closest('a')!;
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('Reader_StaysInTab_WhenHrefIsInternal', () => {
    render(<ArticleBody body={`[![Flyer](${CDN})](/events/23)`} />);
    const link = screen.getByRole('img', { name: 'Flyer' }).closest('a')!;
    expect(link.getAttribute('href')).toBe('/events/23');
    expect(link.hasAttribute('target')).toBe(false);
  });

  it('Reader_OpensNewTab_WhenHrefIsExternal', () => {
    render(<ArticleBody body={`[![Flyer](${CDN})](https://example.org/sale)`} />);
    const link = screen.getByRole('img', { name: 'Flyer' }).closest('a')!;
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('Reader_SeesCaptionAsLinkText_WhenCaptionPresent', () => {
    render(<ArticleBody body={`[![Flyer](${CDN} "Sale details")](https://example.org/sale)`} />);
    const captionLink = screen.getByRole('link', { name: 'Sale details' });
    expect(captionLink.closest('figcaption')).not.toBeNull();
    expect(captionLink.getAttribute('href')).toBe('https://example.org/sale');
  });

  it('Reader_SeesViewFullSizeLabel_WhenLinkedWithoutCaption', () => {
    render(<ArticleBody body={`[![Flyer](${CDN})](${CDN})`} />);
    const label = screen.getByRole('link', { name: /View full size/ });
    expect(label.closest('figcaption')).not.toBeNull();
  });

  it('Reader_SeesOpenLinkLabel_WhenExternalWithoutCaption', () => {
    render(<ArticleBody body={`[![Flyer](${CDN})](https://example.org/sale)`} />);
    expect(screen.getByRole('link', { name: /Open link/ }).closest('figcaption')).not.toBeNull();
  });

  it('Reader_SeesOpenLabel_WhenInternalWithoutCaption', () => {
    render(<ArticleBody body={`[![Flyer](${CDN})](/events/23)`} />);
    expect(screen.getByRole('link', { name: /^Open/ }).closest('figcaption')).not.toBeNull();
  });

  it('Reader_SeesPlainCaption_WhenImageIsNotLinked', () => {
    render(<ArticleBody body={`![Flyer](${CDN} "Just a caption")`} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Just a caption').tagName).toBe('FIGCAPTION');
  });

  it('Reader_SeesAnOrdinaryLink_WhenALinkHasNoImage', () => {
    render(<ArticleBody body={`See the [sale page](https://example.org/sale).`} />);
    const link = screen.getByRole('link', { name: 'sale page' });
    expect(link.closest('p')).not.toBeNull();
    expect(link.closest('figure')).toBeNull();
  });
});
