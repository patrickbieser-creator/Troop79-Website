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
